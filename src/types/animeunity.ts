export interface AnimeUnityConfig {
  proxyUrl: string;
  proxyPassword: string;
  enabled: boolean;
  tmdbApiKey?: string;
  tvdbApiKey?: string;
  tvdbPin?: string;
  animeunityDirect?: boolean;    // Direct master playlist (solo locale, IP-bound)
  animeunityProxy?: boolean;     // Proxy (cross-IP, tutto via EasyProxy)
}

export interface AnimeUnityResult {
  id: number;
  slug: string;
  name: string;
  episodes_count: number;
  language_type: 'Original' | 'Italian Dub' | 'Italian Sub';
}

export interface AnimeUnityEpisode {
  id: number;
  number: number;
  name: string;
}

export interface StreamData {
  embed_url?: string;
  mp4_url?: string;
  episode_page?: string;
}

// ✅ AGGIUNTO: Export mancante
export interface StreamForStremio {
  title: string;
  url: string;
  behaviorHints: {
    notWebReady?: boolean;
    [key: string]: any;
  };
  isSyntheticFhd?: boolean; // align with VixSrc synthetic FHD flag for provider label badge
}

export interface AnimeSaturnConfig {
  proxyUrl: string;
  proxyPassword: string;
  enabled: boolean;
  tmdbApiKey?: string;
  tvdbApiKey?: string;
  tvdbPin?: string;
}

export interface AnimeSaturnResult {
  title: string;
  url: string;
}

export interface AnimeSaturnEpisode {
  title: string;
  url: string;
}

// === AnimeWorld ===
export interface AnimeWorldConfig {
  proxyUrl: string;
  proxyPassword: string;
  enabled: boolean;
  tmdbApiKey?: string;
  tvdbApiKey?: string;
  tvdbPin?: string;
}

export interface AnimeWorldResult {
  id: string; // could be slug or numeric id
  slug: string;
  name: string;
  episodes_count: number;
  language_type?: string; // inferred (ITA, SUB ITA, CR ITA, ORIGINAL)
  // Titolo mostrato nei risultati di ricerca (<a class="name">), es.
  // "That Time I Got Reincarnated as a Slime 2 Part 2 (ITA)". Tenuto separato da `name`:
  // quest'ultimo resta com'e' perche' un name vuoto e' il segnale su cui si regge
  // AdjustEmptyName nella classificazione di lingua.
  searchTitle?: string;
  // Badge DUB nell'anchor "poster" della scheda di ricerca: presente solo sulle
  // versioni ITA, serve a dedurre la lingua senza scaricare la pagina /play/<slug>.
  dubBadge?: boolean;
}

export interface AnimeWorldEpisode {
  id: string; // episode identifier
  number: number;
  name?: string;
}
