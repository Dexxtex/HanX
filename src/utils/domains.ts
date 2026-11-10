import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import fs from 'fs';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let domainCache: Record<string, string> | null = null;
let lastLoad = 0; // epoch ms
const TTL_MS = 12 * 60 * 60 * 1000; // 12 ore

/** `null` = lettura fallita, `{}` = file valido ma vuoto. Non sono la stessa cosa. */
function _readDomainsFile(): Record<string, string> | null {
  try {
    const p = path.join(__dirname, '..', '..', 'config', 'domains.json');
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, string>;
  } catch {
    /* ignore */
  }
  return null;
}

function loadDomains(): Record<string, string> {
  const now = Date.now();
  if (!domainCache || (now - lastLoad) > TTL_MS) {
    const loaded = _readDomainsFile();
    if (loaded) {
      domainCache = loaded;
      lastLoad = now;
    } else if (!domainCache) {
      // Una lettura fallita non è un file vuoto: cacharla 12 h lasciava i
      // provider sui domini hardcoded senza un secondo tentativo. Ma nemmeno
      // rileggere a ogni chiamata: si ritenta fra un minuto.
      lastLoad = now - TTL_MS + 60_000;
      return {};
    }
  }
  return domainCache;
}

export function getDomain(key: string): string | undefined {
  const map = loadDomains();
  return map[key];
}
