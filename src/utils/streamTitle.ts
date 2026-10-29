/**
 * Fixing/unification of titles for streams: pure logic, extracted from the
 * stream handler so that you can test the regexes on the titles of providers.
 */
import type { Stream } from 'stremio-addon-sdk';
import { providerLabel } from './unifiedNames.js';

export function reverseProviderKey(label: string): string {
    const l = label.toLowerCase();
    if (l.includes('anime unity')) return 'animeunity';
    if (l.includes('anime saturn')) return 'animesaturn';
    if (l.includes('anime world')) return 'animeworld';
    return 'generic';
}

export function unifyStreams(original: Stream[], providerLabelName: string): Stream[] {
    const providerKey = reverseProviderKey(providerLabelName);
    return original.map(st => {
        const url = (st as any).url || '';
        const rawTitle: string = (st.title || '').toString();
        const lines = rawTitle.split('\n');
        let baseLine = lines[0] || '';
        // Remove duplicated leading icons / tags
        baseLine = baseLine.replace(/^\s*🎬\s*/, '');
        for (let i = 0; i < 3; i++) baseLine = baseLine.replace(/^\s*\[[^\]]+\]\s*/, '').trim();
        // Strip language markers or bullet language artifacts from base line
        baseLine = baseLine
            .replace(/\s*[•▪]\s*\[?(ITA|SUB)\]?/ig, '')
            .replace(/\s*\b(ITA|SUB)\b/ig, '')
            .replace(/\s*•\s*\[SUB ITA\]/ig, '')
            .replace(/\s{2,}/g, ' ') // collapse spaces
            .trim();
        // Cleanup universale aggiuntivo: rimuovi eventuali [ITA]/[SUB] residui attaccati senza spazio e lock icon per qualsiasi provider
        baseLine = baseLine
            .replace(/\[ITA\]/ig, '')
            .replace(/\[SUB\]/ig, '')
            .replace(/🔒|🔓FHD?|🔓/g, '')
            .replace(/\s{2,}/g, ' ')
            .replace(/\s+$/, '')
            .trim();
        // Language detection (from whole raw title)
        const isSub = /\bsub\b|\[sub\]/i.test(rawTitle);
        // Proxy detection (broadened):
        //  - /proxy/ path segment
        //  - presence of api_password= (EasyProxy wrapper)
        //  - behaviorHints.proxyHeaders flag
        const proxyOn = /\/proxy\//i.test(url)
            || /api_password=/i.test(url);
        let sizeHuman: string | undefined; // already formatted (e.g. 1.58Gb / 850MB)
        let resHuman: string | undefined;  // e.g. 1080p
        // Try to parse existing size/res lines produced by extractors (line starting with 💾)
        // Patterns we expect from extractors: "💾 <SIZE> • <RES>", "💾 <SIZE>", "💾 <SIZE> • <somethingp>", or combined tokens separated by spaces or bullets.
        for (const l of lines) {
            if (/^\s*💾/i.test(l)) {
                // Remove leading icon
                let rest = l.replace(/^\s*💾\s*/, '').trim();
                // Split by separators (bullet • or whitespace)
                const parts = rest.split(/\s*[•|]\s*|\s+/).filter(Boolean);
                // Heuristics: first part maybe size (contains MB/GB), any part matching \d{3,4}p is resolution
                for (const p of parts) {
                    if (!sizeHuman && /([0-9]+(?:\.[0-9]+)?\s*(?:GB|MB))/i.test(p)) sizeHuman = p.replace(/gb$/i, 'GB').replace(/mb$/i, 'MB');
                    if (!resHuman && /^(\d{3,4})p$/i.test(p)) resHuman = p.toLowerCase();
                }
            }
        }
        // If resolution appears split like "1080p" inside raw title second line without 💾, catch it
        if (!resHuman) {
            const m = rawTitle.match(/\b(\d{3,4})p\b/);
            if (m) resHuman = m[1] + 'p';
        }
        // Assemble lines manually per new spec:
        // 1 Title (🎞️)
        // 2 Language line 🎧 ITA|SUB
        // 3 Size/Res line (📦 <SIZE> 🖥️ <RES> | only if at least one present)
        // 4 Proxy line 🛡️ Proxy (ON|OFF)
        // (Provider label removed from multiline)
        const outLines: string[] = [];
        outLines.push(`🎞️ ${baseLine}`);
        // Language line: logica legacy [ITA]/[SUB].
        outLines.push(`🎧 ${isSub ? 'SUB' : 'ITA'}`);
        // Build size/res combined line before proxy if present
        let sizeResLine = '';
        if (sizeHuman && resHuman) {
            sizeResLine = `📦 ${sizeHuman} 🖥️ ${resHuman}`;
        } else if (sizeHuman) {
            sizeResLine = `📦 ${sizeHuman}`;
        } else if (resHuman) {
            sizeResLine = `🖥️ ${resHuman}`; // resolution only
        }
        if (sizeResLine) outLines.push(sizeResLine);
        outLines.push(`🛡️ Proxy (${proxyOn ? 'ON' : 'OFF'})`);
        const unifiedTitle = outLines.join('\n');
        // ---------------- BINGE GROUP LOGIC (CUSTOM MAP) ----------------
        // animeunity/animeworld/animesaturn: std-ita | std-sub
        // Altri provider (fallback): providerKey-std
        let bingeGroup: string;
        switch (providerKey) {
            case 'animeunity':
            case 'animeworld':
            case 'animesaturn':
                bingeGroup = `${providerKey}-std-${isSub ? 'sub' : 'ita'}`;
                break;
            default:
                bingeGroup = `${providerKey}-std`;
        }
        const existingHints = (st as any).behaviorHints || {};
        const mergedHints = { ...existingHints, bingeGroup };
        return { ...st, title: unifiedTitle, name: (st as any).name || providerLabel(providerKey), behaviorHints: mergedHints } as Stream;
    });
}

/** Ordine storico dei provider nel sort dello stream handler. */
export function providerRank(n: string): number {
    const l = n.toLowerCase();
    if (l.includes('anime unity')) return 1;
    if (l.includes('anime saturn')) return 2;
    if (l.includes('anime world')) return 3;
    return 50;
}
