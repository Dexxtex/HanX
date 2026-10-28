// Setup dei test: il pacing di fetch-resource mette 2 s tra due richieste allo
// stesso host (in produzione serve), e qui renderebbe la suite lentissima.
process.env.ANIME_HOST_MIN_INTERVAL_MS = '0';
