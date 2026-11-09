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

// ✅ AGGIUNTO: Export mancante
export interface StreamForStremio {
  title: string;
  url: string;
  name?: string;
  /**
   * I campi sono quelli che il codice scrive e rilegge davvero. L'index
   * signature nascondeva un'assunzione: `headers` era scritto in
   * animesaturn-provider e riletto come `any` per costruire l'URL del proxy.
   */
  behaviorHints: {
    notWebReady?: boolean;
    headers?: Record<string, string>;
    bingeGroup?: string;
    /** Marcatore interno: viene tolto prima di consegnare lo stream. */
    proxyHeaders?: Record<string, unknown>;
  };
  isSyntheticFhd?: boolean; // align with VixSrc synthetic FHD flag for provider label badge
}

/** Lingue che i siti dichiarano. `ORIGINAL` è interna di AnimeWorld. */
export type StreamLanguage = 'ITA' | 'CR ITA' | 'SUB ITA' | 'ORIGINAL';

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
  language_type?: StreamLanguage; // inferita dal sito o dal catalogo
  // Titolo mostrato nei risultati di ricerca (<a class="name">), es.
  // "That Time I Got Reincarnated as a Slime 2 Part 2 (ITA)". Tenuto separato da `name`:
  // quest'ultimo resta com'e' perche' un name vuoto e' il segnale su cui si regge
  // AdjustEmptyName nella classificazione di lingua.
  searchTitle?: string;
  // Badge DUB nell'anchor "poster" della scheda di ricerca: presente solo sulle
  // versioni ITA, serve a dedurre la lingua senza scaricare la pagina /play/<slug>.
  dubBadge?: boolean;
  // Coppie `[numero, token]` dal catalogo: con queste la pagina /play/<slug> non
  // serve più, né per la lista episodi né per il token dell'API.
  ep?: [number, number | string][];
}

export interface AnimeWorldEpisode {
  id: string; // episode identifier
  number: number;
  name?: string;
}
