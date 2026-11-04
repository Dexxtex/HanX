import { normalizeHomoglyphs } from '../utils/anime-title-normalization.js';

/**
 * Chiave di ricerca compatta: minuscole, senza accenti né separatori.
 * "Mission-E" e "MissionE" danno la stessa chiave, come il confronto sulla
 * forma grezza già usato dal filtro dei provider.
 */
export function compactKey(title: string): string {
  return normalizeHomoglyphs(String(title || ''))
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}
