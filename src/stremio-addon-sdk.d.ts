/*  src/stremio-addon-sdk.d.ts
    Dichiarazioni minime per soddisfare il compilatore TS                 */

declare module 'stremio-addon-sdk' {
  /* ────────── CLASSI/FUNZIONI ESPORTATE ────────── */

  /** Costruttore usato con `new addonBuilder(...)` */
  export class addonBuilder {
    constructor(manifest: Manifest);
    defineStreamHandler(handler: (args: { type: string; id: string; config?: any; extra?: any }) => Promise<{ streams: Stream[]; cacheMaxAge?: number }>): void;
    defineMetaHandler(handler: (args: { type: string; id: string; config?: any; extra?: any }) => Promise<{ meta: any; cacheMaxAge?: number }>): void;
    defineCatalogHandler(handler: (args: any) => Promise<any>): void;
    defineSubtitlesHandler(handler: (args: any) => Promise<any>): void;
    getInterface(): any;
  }

  /** Funzioni helper usate nel codice */
  export function getRouter(addonInterface: any): any;
  export function serveHTTP(addonInterface: any, options?: any): void;

  /* ────────── TIPI USATI NEL PROGETTO ────────── */

  /** Manifest dell’addon (versione ridotta: aggiungi campi se servono) */
  export interface Manifest {
    id: string;
    version: string;
    name: string;
    description?: string;
    icon?: string;
    logo?: string;
    favicon?: string;
    background?: string;

    resources: string[];
    types: string[];
    idPrefixes?: string[];
    catalogs?: any[];
    config?: any[];
    behaviorHints?: any;

    [k: string]: any;           // per campi aggiuntivi
  }

  /** Oggetto stream restituito dagli handler */
  export interface Stream {
    title?: string;
    name?: string;
    url: string;
    behaviorHints?: any;
    headers?: Record<string, string>;
    [k: string]: any;
  }

}
