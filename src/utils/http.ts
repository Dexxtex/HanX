import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { Request, Response } from 'express';

const gzipAsync = promisify(gzip);

/** Sotto questa soglia comprimere costa più di quanto risparmia. */
const GZIP_MIN_BYTES = 1024;

/**
 * Invia una pagina HTML comprimendola con gzip quando il client lo accetta.
 * La landing contiene chiavi env, quindi resta `no-store` anche da compressa.
 */
export async function sendHtmlResponse(req: Request, res: Response, html: string): Promise<void> {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Accept-Encoding');

    const acceptsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
    if (!acceptsGzip || Buffer.byteLength(html) < GZIP_MIN_BYTES) {
        res.send(html);
        return;
    }

    try {
        const compressed = await gzipAsync(Buffer.from(html));
        res.setHeader('Content-Encoding', 'gzip');
        res.send(compressed);
    } catch {
        // Meglio la pagina in chiaro di un 500: nessun header impostato finora.
        res.send(html);
    }
}
