/**
 * Attesa dei provider e assemblaggio della lista.
 *
 * Sta in un file suo perché è il punto dove è già passato un bug: la 1.1.6
 * aggiunse un budget di risposta (`Promise.race`) e su una serie mai vista
 * nessun provider finiva in tempo, quindi la lista usciva con 0-2 provider su 3.
 * I test di allora non lo videro perché asserivano il corpo di `runProvider`,
 * non questa attesa.
 *
 * Qui si aspetta **tutti**: un provider lento non è un optional, e sulla prima
 * apertura di una serie sono 7-10 secondi.
 */
import type { Stream } from 'stremio-addon-sdk';

export async function collectProviderStreams(runs: Array<Promise<Stream[]>>): Promise<Stream[]> {
  const groups = await Promise.all(runs);
  const all: Stream[] = [];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const stream of group) all.push(stream);
  }
  return all;
}
