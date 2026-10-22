/**
 * Debug logging with four intensity levels.
 *
 * 1 = lifecycle: requests, provider fan-out, final stream count
 * 2 = decisions: mapping hits/misses, searches, cache hits, gate results
 * 3 = details: candidates, filters, episode alignment
 * 4 = trace: HTTP/proxy traffic and raw candidate dumps
 *
 * Set DEBUG_LEVEL=0..4. DEBUG_LOG is still accepted for compatibility
 * (true/on/yes = 2, false/off/no = 0, a number = that level).
 */

export type DebugLevel = 1 | 2 | 3 | 4;

function parseLevel(value: string | undefined): number | null {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'false' || raw === 'off' || raw === 'no' || raw === '0') return 0;
  if (raw === 'true' || raw === 'on' || raw === 'yes') return 2;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(4, Math.max(0, parsed));
}

/** Pure parser so tests can validate every supported env form. */
export function resolveDebugLevel(env: NodeJS.ProcessEnv = process.env): number {
  const explicit = parseLevel(env.DEBUG_LEVEL);
  if (explicit !== null) return explicit;
  return parseLevel(env.DEBUG_LOG) ?? 0;
}

export const DEBUG_LEVEL = resolveDebugLevel();

export function debugEnabled(level: DebugLevel): boolean {
  return DEBUG_LEVEL >= level;
}

export function debug(level: DebugLevel, scope: string, ...args: unknown[]): void {
  if (!debugEnabled(level)) return;
  try {
    console.log(`[DEBUG:${level}][${scope}]`, ...args);
  } catch {
    // Logging must never break a request.
  }
}

/** Removes query strings and credentials before a URL reaches the logs. */
export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return String(value).replace(/([?&](?:api_key|apikey|token|password|pin)=)[^&]*/gi, '$1***');
  }
}
