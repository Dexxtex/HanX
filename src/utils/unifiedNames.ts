// Centralized provider labels for anime streams.

// Badge FHD: solo le lettere in cerchi. Niente ANSI (Stremio lo stampa alla
// lettera) e niente emoji di colore: il badge deve restare un glifo unico.
const FHD_BADGE = '🅕🅗🅓';

export function providerLabel(provider: string, isFhd?: boolean): string {
  switch (provider) {
    case 'animeunity': return `🎴 Anime Unity${isFhd ? ` ${FHD_BADGE}` : ''}`;
    case 'animesaturn': return '🪐 Anime Saturn';
    case 'animeworld': return '🌍 Anime World';
    default: return provider;
  }
}
