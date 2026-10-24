// Centralized provider labels for anime streams.

export function providerLabel(provider: string, isFhd?: boolean): string {
  switch (provider) {
    case 'animeunity': return `🤌 Anime Unity ⛩️${isFhd ? ' 🅵🅷🅳' : ''}`;
    case 'animesaturn': return '🤌 Anime Saturn 🪐';
    case 'animeworld': return '🤌 Anime World 🌍';
    default: return provider;
  }
}
