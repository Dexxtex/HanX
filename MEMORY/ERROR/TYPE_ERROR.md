# ⚠️ Errori Comuni Terminal — PowerShell/Windows

> **Scopo**: Documentare gli errori ricorrenti che posso fare con il terminale su Windows, per evitarli in futuro.
> **Ultimo aggiornamento**: 11/10/2026

---

## 🔴 Errori da Evitare

### 0. Override Dipendenze in pnpm v11+

```bash
# ❌ NON USARE pnpm.overrides in package.json:
{
  "pnpm": {
    "overrides": {
      "path-to-regexp": "^0.1.13"
    }
  }
}

# Perché fallisce:
# In pnpm v11+, il campo "pnpm" in package.json è ignorato

# ✅ USARE pnpm-workspace.yaml:
# pnpm-workspace.yaml
overrides:
  path-to-regexp: ^0.1.13
  tmp: ^0.2.6
```

**Lezione**: Leggere sempre la documentazione pnpm v11+ prima di configurare le overrides.

---

### 1. Override Globali Rompono Dipendenze Differenti

```bash
# ❌ NON USARE override globale per path-to-regexp:
# pnpm-workspace.yaml
overrides:
  path-to-regexp: ^0.1.13  # ROMPE express@5 che usa router@2.x > path-to-regexp@8.x

# Perché fallisce:
# express@5 usa router@2.2.0 che richiede path-to-regexp@^8.0.0
# Override globale forza 0.1.13 su TUTTE le istanze
# Errore: TypeError: pathRegexp.match is not a function

# ✅ SOLUZIONE: Accettare rischio o patchare selettivamente
# Le vulnerabilità in stremio-addon-sdk sono in dipendenze CLI non esposte
```

**Lezione**: Verificare compatibilità delle override con TUTTE le dipendenze prima di applicarle.

### 1. Redirezione Output con `2>/dev/null`

```bash
# ❌ NON USARE su Windows PowerShell:
git rm somefile 2>/dev/null

# Perché fallisce:
# PowerShell tratta "2>/dev/null" come argomento del comando, non come redirezione
# Può creare file fantasma come "nul" o "dev/null"

# ✅ USARE invece:
git rm somefile 2>$null
# O semplicemente omettere la redirezione
```

### 2. Shell Substitution nei Comandi

```bash
# ❌ NON USARE variabili shell:
cd $HOME/HanX
ls $VAR/file.txt
git push origin $BRANCH

# Perché fallisce:
# Il terminale non supporta $VAR, ${VAR}, $(...)

# ✅ USARE percorsi letterali:
cd C:\Users\Ardit\Desktop\HanX
```

### 3. Backtick e Comandi PowerShell

```bash
# ❌ NON USARE backtick:
Get-ChildItem `
  -Path "C:\Users\Ardit\AppData\Local\zed"

# ❌ NON USARE $env:VAR:
ls "$env:LOCALAPPDATA\zed"

# ✅ USARE comandi su una singola riga:
Get-ChildItem -Path "C:\Users\Ardit\AppData\Local\zed" -ErrorAction SilentlyContinue
```

### 4. Comandi `dir` vs `ls`

```bash
# ❌ NON USARE "dir" (comando Windows) in bash:
dir C:\Users\Ardit\file.txt

# ✅ USARE "ls" o "Get-ChildItem" (a seconda del shell):
ls C:\Users\Ardit\file.txt
```

### 5. Escape Characters in `git commit -m`

```bash
# ❌ Rischio di errori con escape in PowerShell:
git commit -m "fix: esempio con \"virgolette\""

# ✅ USARE apici singoli per i messaggi:
git commit -m 'fix: esempio con virgolette'
```

### 6. Path con Backslash vs Forward Slash

```bash
# ❌ I backslash possono causare problemi in bash:
git add MEMORY\MIGRATION\file.md

# ✅ USARE forward slash (funziona sia su bash che PowerShell):
git add MEMORY/MIGRATION/file.md
```

---

## ✅ Regole Generali

1. **Mai usare `2>/dev/null`** — su Windows crea file fantasma
2. **Mai usare `$VAR`, `${VAR}`, `$(...)`** — il terminale non li supporta
3. **Usare sempre forward slash `/`** nei path
4. **Usare `ls` invece di `dir`** in bash
5. **Mantenere i comandi su una riga** quando possibile
6. **Verificare il working directory** con `pwd` prima di eseguire comandi

---

## 📋 Checklist Prima di Eseguire un Comando

- [ ] Nessun `$VAR` o `$(...)` nel comando?
- [ ] Nessun `2>/dev/null`?
- [ ] Path con forward slash `/`?
- [ ] Working directory corretto?
- [ ] Comando su una singola riga?

---

**HanX** — Il tuo addon anime per Stremio/NUVIO.
