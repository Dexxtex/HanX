// Resolver unico per la stagione 0: decide fascia, episodio e range di una
// scheda OVA/Special a partire dal dump TVDB. Lo usano `map-s0.mjs` (che scrive
// nel mapping) e il report dei casi da verificare: due implementazioni delle
// stesse regole sono un secondo bug che aspetta di succedere.
//
// `legacy: true` riproduce la versione precedente (primo match per nome,
// `from` che parte dall'episodio trovato): serve solo al diff, non al mapping.

const STOP = new Set(['ita', 'sub', 'the', 'and', 'of', 'a', 'to', 'in', 'wa', 'ga', 'no', 'ni', 'wo', 'de', 'x', 'on', 'is', 'it']);
const LANGS = ['eng', 'ita', 'jpn'];

export const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/\(ita\)|\(sub ita\)|\bova\b|\bona\b|\bspecial\b|\bspecials\b|\bmovie\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const toks = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w)));

export const ov = (a, b) => {
  const A = toks(a);
  const B = toks(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n += 1;
  return n / Math.min(A.size, B.size);
};

export const anno = (x) => String(x || '').match(/(\d{4})/)?.[1] || null;

/** Episodi S0 uniti sulle tre lingue, uno per numero. */
export function episodiS0(s0) {
  if (!s0) return [];
  const per = new Map();
  for (const lang of LANGS) {
    for (const e of s0[lang] || []) {
      if (!per.has(e.n)) per.set(e.n, { ...e, lang });
    }
  }
  return [...per.values()].sort((a, b) => a.n - b.n);
}

/**
 * Classifica una scheda contro la sua S0 TVDB.
 * Ritorna `{ fascia, ep, from, episodeCount, segnale, candidati }` oppure
 * `{ fascia: 'none' }` se non c'e' niente da proporre.
 *
 * Fasce: A nome, B data esatta, C stesso anno con un solo candidato,
 * D stesso anno con piu' candidati, E madre con titolo tradotto, F nessun
 * segnale, G nome con anno incompatibile (falso positivo probabile).
 */
export function classificaS0(c, scheda, { legacy = false } = {}) {
  const lista = episodiS0(c.s0);
  if (!lista.length) return { fascia: 'none', lista };
  const nS0 = lista.length;
  const nScheda = Math.max(1, Number(scheda?.episodes) || 1);
  const y = anno(c.startDate) || anno(c.year);

  const punteggio = (e) => Math.max(ov(e.name, c.title), ...(c.titles || []).map((t) => ov(e.name, t)));
  const perNome = lista.filter((e) => punteggio(e) >= 0.5);
  if (!legacy) perNome.sort((a, b) => punteggio(b) - punteggio(a));

  const perNomeAnno = perNome.filter((e) => {
    const ey = anno(e.air);
    return !y || !ey || Math.abs(Number(ey) - Number(y)) <= 1;
  });
  const perData = lista.filter((e) => c.startDate && e.air === c.startDate);
  const stessoAnno = lista.filter((e) => e.air && anno(e.air) === y);
  const madreOk = ov(c.tmdbTitle, c.title) > 0 || (c.titles || []).some((t) => ov(c.tmdbTitle, t) > 0);

  const scegli = (ep, fascia, segnale) => {
    const k = ep.n;
    // `legacy` riproduce il bug: `from` era l'episodio trovato, non l'inizio
    // del blocco. Con Freezing (scheda 6, match su S0E6) copriva 6-11.

    // Da "episodio plausibile" a "intero range": l'ancora e' un episodio, il
    // blocco e' un'assunzione. Va detto quale delle due cose e'.
    // `anchorSourcePosition` resta null: nessuno dei tre siti espone i titoli
    // per episodio, quindi la posizione dell'ancora nella scheda e' ignota.
    // L'ancora NON dice dove sta nel blocco. Se il blocco e' consecutivo e
    // mantiene l'ordine, from = anchorEpisode - anchorSourcePosition + 1: senza
    // la posizione, ogni posizione possibile produce un range diverso.
    // Non si sceglie con Math.max(1, ...): sarebbe una seconda assunzione
    // ("il blocco parte da S0E1") che nessun dato sostiene.
    const alternativeRanges = [];
    for (let pos = 1; pos <= nScheda; pos += 1) {
      const start = k - pos + 1;
      if (start < 1) continue;
      if (start + nScheda - 1 > nS0) continue;
      const blocco = lista.filter((e) => e.n >= start && e.n < start + nScheda);
      const anni = blocco.map((e) => Number(anno(e.air))).filter(Number.isFinite);
      const dateSupport = Boolean(y) && anni.length > 0 && anni.every((a) => Math.abs(a - Number(y)) <= 1);
      alternativeRanges.push({ from: start, episodeCount: nScheda, dateSupport });
    }
    const conData = alternativeRanges.filter((x) => x.dateSupport);

    let from = null;
    let episodeCount = nScheda;
    let proposalReason;
    let rangeDetermined = false;
    if (legacy) {
      // Versione precedente, solo per il diff: il range partiva dall'episodio
      // trovato e copriva un episodio solo.
      from = nScheda === nS0 ? 1 : k;
      episodeCount = 1;
      proposalReason = 'legacy';
    } else if (nScheda === 1) {
      from = k;
      episodeCount = 1;
      proposalReason = 'single_episode';
      rangeDetermined = true;
    } else if (alternativeRanges.length === 1) {
      from = alternativeRanges[0].from;
      proposalReason = 'only_valid_range';
      rangeDetermined = true;
    } else if (conData.length === 1) {
      from = conData[0].from;
      proposalReason = 'unique_date_consistent';
    } else if (alternativeRanges.length === 0) {
      proposalReason = 'no_valid_range';
    } else {
      proposalReason = 'ambiguous';
    }
    const dateSupport = Boolean(from) && alternativeRanges.some((x) => x.from === from && x.dateSupport);

    // S0 con episodi in anni diversi contiene piu' blocchi (Freezing: 2011 e
    // 2013-14, speciali e OVA di Vibration): un range a cavallo e' sospetto.
    const anni = [...new Set(lista.map((e) => anno(e.air)).filter(Boolean))].map(Number).sort((a, b) => a - b);
    const multiBlocco = anni.length > 1 && anni[anni.length - 1] - anni[0] >= 1;

    return {
      fascia,
      ep,
      anchorEpisode: k,
      anchorSourcePosition: null,
      from,
      episodeCount,
      rangeReason: proposalReason,
      proposalReason,
      rangeProposed: from !== null,
      rangeDetermined,
      rangeVerified: false,
      dateSupport,
      alternativeRanges,
      multiBlocco,
      segnale,
      lista,
      nS0,
      nScheda,
      candidati: perNome,
    };
  };

  if (perNomeAnno.length) return scegli(perNomeAnno[0], 'A', 'nome');
  if (perNome.length) return scegli(perNome[0], 'G', 'nome, anno incompatibile');
  if (!madreOk) return { fascia: 'E', ep: null, lista, nS0, nScheda, candidati: perNome };
  if (perData.length === 1) return scegli(perData[0], 'B', 'data esatta');
  if (stessoAnno.length === 1) return scegli(stessoAnno[0], 'C', 'stesso anno, un candidato');
  if (stessoAnno.length > 1) return { fascia: 'D', ep: null, lista, nS0, nScheda, candidati: perNome, stessoAnno };
  return { fascia: 'F', ep: null, lista, nS0, nScheda, candidati: perNome };
}

/** Fasce che il mapping puo' promuovere. Le ONA restano fuori per scelta. */
export const FASCE_PROMUOVIBILI = new Set(['A', 'B', 'C']);
export const TIPI_PROMUOVIBILI = new Set(['OVA', 'Special']);
