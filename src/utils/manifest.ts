// Forma del manifest in base al percorso richiesto.

/** "/manifest.json" -> false, "/<config>/manifest.json" -> true. */
export function hasConfigSegment(pathname: string): boolean {
  const segments = String(pathname || '').split('/').filter(Boolean);
  return segments.length > 1 && segments[segments.length - 1] === 'manifest.json';
}

/**
 * Protocollo Stremio: quando la config è già nel percorso, il manifest non deve
 * più dichiararsi configurabile. Se resta `configurable: true` l'app propone la
 * configurazione invece di installare l'addon, e l'installazione non va a buon
 * fine (Stremio Web la accetta lo stesso, l'app desktop no).
 */
export function withoutConfigHints<T extends Record<string, any>>(manifest: T): T {
  if (!manifest.behaviorHints) return manifest;
  const hints = { ...manifest.behaviorHints } as Record<string, any>;
  delete hints.configurable;
  delete hints.configurationRequired;
  return { ...manifest, behaviorHints: hints };
}
