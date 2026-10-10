// Centralized unified naming utilities for anime streams only
// Provides functions to build multi-line descriptive stream names.

export interface UnifiedNameOptions {
  baseTitle: string; // Raw title already including season/episode markers if needed
  isSub: boolean; // true => [SUB], false => [ITA]
  sizeBytes?: number; // Optional size indicator
  playerName?: string; // Optional player name (host or extractor)
  proxyOn: boolean; // Whether the delivered stream goes through proxy
  provider: string; // Provider key (animeunity, animesaturn, animeworld)
  isFhdOrDual?: boolean; // Tag provider with HD marker
  hideProviderInTitle?: boolean; // If true, do not include provider label in the title/desc
  langFlag?: string; // Optional: override language display (e.g. '🇮🇹' or '🇬🇧'). If absent falls back to isSub logic.
}

export function formatBytesHuman(b?: number): string {
  if (!b || b <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = b;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  const num = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
  return `${num} ${units[i]}`;
}

export function providerLabel(provider: string, isFhd?: boolean): string {
  switch (provider) {
    case 'animeunity': return `🤌 Anime Unity ⛩️${isFhd ? ' 🅵🅷🅳' : ''}`;
    case 'animesaturn': return '🤌 Anime Saturn 🪐';
    case 'animeworld': return '🤌 Anime World 🌍';
    default: return provider;
  }
}

export function buildUnifiedStreamName(opts: UnifiedNameOptions): string {
  const lines: string[] = [];
  lines.push(`🎬 ${opts.baseTitle}`);
  // Language line: use explicit langFlag if provided, otherwise legacy isSub logic
  if (opts.langFlag) {
    lines.push(`🗣 ${opts.langFlag}`);
  } else {
    lines.push(`🗣 ${opts.isSub ? '[SUB]' : '[ITA]'}`);
  }
  if (opts.sizeBytes) {
    const sz = formatBytesHuman(opts.sizeBytes);
    if (sz) lines.push(`💾 ${sz}`);
  }
  if (opts.playerName) lines.push(`▶️ ${opts.playerName}`);
  lines.push(`🌐 Proxy (${opts.proxyOn ? 'ON' : 'OFF'})`);
  if (!opts.hideProviderInTitle) {
    lines.push(providerLabel(opts.provider, opts.isFhdOrDual));
  }
  return lines.join('\n');
}

/** Maps detected audio language codes to display flag string */
export function langToFlag(langs: string[]): string {
  const hasIt = langs.some(l => l === 'it' || l === 'ita' || l.startsWith('it'));
  const hasEn = langs.some(l => l === 'en' || l === 'eng' || l.startsWith('en'));
  if (hasIt && hasEn) return '🇮🇹 🇬🇧';
  if (hasIt) return '🇮🇹';
  if (hasEn) return '🇬🇧';
  if (langs.length > 0) return `🌐 ${langs[0].toUpperCase()}`;
  return '🇮🇹'; // fallback default
}

// Simple legacy name mapping helper for anime-only transitional phase
// Converts legacy addon.ts provider name strings (e.g. 'HanX AU') into new label.
export function mapLegacyProviderName(legacy: string): string {
  const lower = legacy.toLowerCase();
  if (lower.includes('hanx au')) return providerLabel('animeunity');
  if (lower.includes('hanx as')) return providerLabel('animesaturn');
  if (lower.includes('hanx aw')) return providerLabel('animeworld');
  return legacy;
}
