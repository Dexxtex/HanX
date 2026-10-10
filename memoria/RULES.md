# REGOLE DI SVILUPPO

## REGOLE FONDAMENTALI
1: MAI INIZIARE UN AZIONE SENZA CHIEDERE PRIMA SPECIFICANDO COSA VUOI FARE
2: SE RIFIUTO LA TUA AZIONE DOPO AVERLA SPECIFICATA, INTERROMPI TUTTO.
3: LEGGI SEMPRE QUESTO FILE PRIMA DI OGNI AZIONE

## INFORMAZIONI
- Questa cartella (`memoria/`) contiene la documentazione del progetto
- Il codice originale è nella cartella `src/`
- È un addon Stremio per streaming anime, collegabile a NUVIO

## OBIETTIVI
0: RIMUOVERE FILE NON NECESSARI AGLI ANIME SENZA CREARNE DI NUOVI (CHIEDI CONFERMA)
1: PULIRE IL CODICE DA TUTTO CIO CHE NON E' COLLEGATO AGLI ANIME
2: RICOSTRUIRE IL CODICE RENDENDOLO ESCLUSIVO PER GLI ANIME

## LIBERTA CONCESSE
1: CREARE FILE .MD nella cartella `memoria/MEMORY/` (max 3 file: 01_STRUTTURA_E_ARCHITETTURA, 02_PROVIDERS_ANIME, 03_OBIETTIVI_E_TODO)
2: Lasciare un file per obiettivi raggiunti e to-do list
3: Creare cartella `memoria/BACKUP_STORICO/` per storico cambiamenti (dimensione infinita)
4: Creare cartella `memoria/ERROR_TRACKING/` per registro errori

## FILE DA NON MODIFICARE
1: `src/utils/easyproxyDvr.ts` — **SOLO MODULO DVR** (NON usato da anime), PUÒ ESSERE RIMOSSO in FASE 8
2: **EasyProxy SERVIZIO** (proxy alternativo a MediaFlow) — **DA MANTENERE** (infrastruttura anime)
3: Normalizzazioni anime — NON MODIFICARE
4: Dipendenze necessarie — NON RIMUOVERE (`mediaFlowProxyUrl`, `mediaFlowProxyPassword`, `useMediaFlow`, `tmdbApiKey`)
5: UI helper — NON TOCCARE (`personalTmdbKey`, `mediaflowMaster` usati in landingPage.ts)

## REGOLA PRIMA DI MODIFICARE addon.ts
1: FAI TUTTO CIO CHE QUI SI RICHIEDE PRIMA SU landingPage.ts
2: FAI TUTTO CIO CHE QUI SI RICHIEDE PRIMA SU extractor.ts
3: addon.ts → ULTIMO, prima del test di compilazione

## REGOLA IMPORTANTE
- AD OGNI SESSIONE AGGIORNARE la documentazione in `memoria/`
- NON CREARE file o directory non necessari agli anime
- RIMUOVERE correlazioni, dipendenze, import non necessari (se non riguardano anime)

## REGOLA NUMERI DI RIGA (VALIDA PER TUTTI I FILE)
- Usare SEMPRE il conteggio righe dell'**editor** per TUTTI i file del progetto, non solo `addon.ts`.
- Il terminale (`wc -l` / `Measure-Object`) conta le righe in modo diverso dall'editor (probabilmente ignora righe vuote o gestisce diversamente i newline).
- Tutti i riferimenti a numeri di riga nella documentazione devono essere basati sull'editor.
- Questo evita di cercare codice nella posizione sbagliata quando si fa riferimento a numeri di riga.
- **Esempio**: `addon.ts` = ~10574 righe (editor), 9775 (terminale) → usare SEMPRE ~10574.
- **NON usare mai `grep` per verificare numeri di riga esatti**: grep mostra intervalli di contesto (es. `L480-484`), non la riga precisa. Per verifiche esatte usa sempre `read_file` con `start_line`/`end_line`.
