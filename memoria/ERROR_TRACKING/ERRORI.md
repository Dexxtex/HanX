# Error Tracking — StreamVix

Registro degli errori commessi e delle discrepanze incontrate durante lo sviluppo.
Obiettivo: non ripetere gli stessi errori in futuro.

---

## ERRORI CRITICI

### 1. PowerShell ha corrotto addon.ts (06/10/2026)
- **Cosa è successo**: Comando PowerShell per rimuovere righe 6353-6358 ha sovrascritto il file con contenuto vuoto (2 bytes)
- **Causa**: Syntax error nella pipeline — `[System.IO.File]::WriteAllText()` seguito da `|`
- **Impatto**: File principale dell'addon (>590KB) perso, necessario recupero da GitHub
- **Lezione**: NON usare mai PowerShell per modificare file TypeScript di grandi dimensioni (>100KB)
- **Prevenzione**: Usare sempre gli editor tool per modifiche precise su file grandi; fare backup prima di operazioni bulk

### 2. PowerShell pipeline syntax error
- **Cosa è successo**: `Le espressioni sono consentite solo come primo elemento di una pipeline`
- **Causa**: Il pipe operator `|` è stato usato dopo una chiamata a `[System.IO.File]::WriteAllText()` invece che come primo elemento
- **Soluzione**: Assegnare il risultato a una variabile prima di scrivere sul file
- **Prevenzione**: Verificare la sintassi PowerShell prima di eseguire comandi su file critici

---

## DISCREPANZE RILEVATE

### 3. Documentazione sovrastimava lo stato di pulizia
- **Cosa è successo**: La documentazione affermava che il progetto era più pulito di quanto non fosse realmente
- **Causa**: Assunzioni non verificate sul codice presente nel repository
- **Correzione**: Verificata la struttura reale del codice e corretta tutta la documentazione

---

## NOTE SESSIONE SF8a/SF9 (09/10/2026)

### Discrepanze righe rispetto alla pianificazione
- **Cosa è successo**: Le righe indicate nella PIANIFICAZIONE_COMPLETA.md non corrispondono più alla realtà
- **Causa**: Il file addon.ts è cambiato tra la scrittura della pianificazione e l'esecuzione
- **Gestione**: Verificato ogni elemento con grep prima della rimozione; le righe esatte lette con read_file
- **Lezione**: Le righe nella documentazione sono indicative — verificare sempre con grep prima di modificare
- **Lezione**: Verificare sempre il codice reale prima di documentare cambiamenti

### 4. Import non-anime presenti in addon.ts
- **Cosa è successo**: addon.ts (591KB) contiene ~30+ import non-anime attivi (updater sport/live TV)
- **Causa**: File updater per sport e live TV ancora presenti nel codice e importati
- **Impatto**: Il progetto non è esclusivamente anime come dovrebbe essere
- **Prevenzione**: Usare `grep` per verificare import attivi prima di dichiarare file eliminati

### 5. File Python eliminati senza verifica dipendenze
- **Cosa è successo**: Rischi di eliminare script Python necessari al workflow
- **Correzione**: Verificati `update_domains.py` (GitHub workflow), `auto_normalize*.py` (normalizzatori anime) come necessari
- **Prevenzione**: Controllare sempre le dipendenze e l'uso degli script Python prima di eliminarli

### 6. Import dinamici verso file eliminati rimasti in addon.ts
- **Cosa è successo**: addon.ts contiene import dinamici (`await import()`) verso file eliminati:
  - `./providers/toon-provider` — file eliminato ma import presente
  - `./providers/toonitalia-provider` — file eliminato ma import presente
  - `ppv_streams.py` — file eliminato ma referenziato in codice (L1161, L8801)
- **Impatto**: Codice che fallirà a runtime quando raggiunto; **RISOLTO** per import statici (SF1 ✅), restano solo 2 import dinamici (`toon-provider`, `toonitalia-provider`) che non bloccano la compilazione TypeScript
- **Prevenzione**: Prima di eliminare un file, cercare TUTTI i riferimenti (statici E dinamici) nel codice

### 7. Riferimenti a script Python eliminato in shortenerResolver.ts
- **Cosa è successo**: `src/utils/shortenerResolver.ts` conteneva riferimenti a `scripts/uprot_resolver.py` (eliminato)
- **Correzione**: `scriptPath()` ora restituisce `null` se lo script non esiste; `runResolverArgs()` fallisce graceful; `startWarmupLoop()` verifica esistenza prima di avviare
- **Funzioni ancora operative**: `getWhitelistStatus`, `prepareManualSolve`, `submitManualSolve`, `egressProbe`, `setActiveSlot`, `invalidateEgressCache` (non dipendono da Python)

---

### 8. Meta handler SF13 — `tvChannels` non definito
- **Cosa è successo**: In SF13 i meta handler sport/live sono stati rimossi, ma la chiamata a `getMergedTvChannelsCached()` è stata sostituita con `tvChannels.find()` diretto. Tuttavia `tvChannels` era già stato rimosso in SF9.
- **Impatto**: Errore di compilazione temporaneo previsto
- **Gestione**: Accettato come temporaneo — si risolverà quando il codice che usa `tvChannels` sarà rimosso nelle fasi successive
- **Lezione**: Verificare che le variabili usate da una sostituzione siano ancora definite dopo le modifiche precedenti

### 9. Stream handler SF14 — Simboli orfani non causano errori
- **Cosa è successo**: Dopo la rimozione degli stream handler, diversi simboli risultano non definiti (`IS_SS_DISABLED`, `IS_MH_DISABLED`, `cleanIdForSportzx`, ecc.) ma non causano errori perché il codice che li usa è stato rimosso
- **Impatto**: Nessuno — errori temporanei previsti e accettati
- **Lezione**: Simboli non definiti che non hanno call site attivi non generano errori di compilazione

---

## SESSIONE SF19d (10/10/2026)

### 10. Verifica import prima di rimozione
- **Cosa è successo**: In SF19d sono stati rimossi import non usati (child_process, crypto, util) ma prima ho verificato che non fossero referenziati
- **Correzione**: Usato `grep` per verificare ogni import prima della rimozione
- **Lezione**: Anche se un import sembra non usato, verificare con grep prima di rimuovere

---

## REGOLE DI PREVENZIONE

| # | Regola | Motivazione |
|---|--------|-------------|
| 1 | NON usare PowerShell per modificare file >100KB | Corruzione accidentale del file |
| 2 | SEMPRE fare backup prima di operazioni bulk | Recupero possibile in caso di errori |
| 3 | Usare tool editor per modifiche precise su file grandi | PowerShell è troppo rischioso per file complessi |
| 4 | Verificare sempre il file dopo operazioni PowerShell | Rilevare errori immediatamente |
| 5 | Verificare il codice reale prima di documentare cambiamenti | Evitare documentazione fuorviante |
| 6 | Usare `grep` per verificare import attivi prima di eliminare file | File possono essere ancora referenziati |
| 7 | Controllare dipendenze Python prima di eliminare script | Evitare di rompere workflow esistenti |
| 8 | Cercare riferimenti dinamici (`await import()`, `path.join`, `fs.existsSync`) prima di eliminare file | Import dinamici e riferimenti runtime sfuggono alle ricerche semplici |
| 9 | Verificare wrapper/utility che referenziano script eliminati | File come shortenerResolver.ts possono contenere riferimenti nascosti |
| 10 | Verificare ogni import/funzione con grep prima di rimuovere | Evitare rimozioni accidentali di codice usato |
