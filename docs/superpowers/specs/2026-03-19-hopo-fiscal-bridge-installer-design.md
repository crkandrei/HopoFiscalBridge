# HopoFiscalBridge — Installer & Auto-Update Design

**Date:** 2026-03-19
**Branch:** hopo-fiscal-version → new repo: HopoFiscalBridge
**Scope:** Distribution system for 50+ client stations, installed remotely by developer

---

## Context

HopoFiscalBridge is the generalized multi-client version of BongoFiscalBridge, extracted into its own repository. The original `BongoFiscalBridge` main branch remains untouched (single client). This design covers initial installation and remote auto-update for HopoFiscalBridge.

**Constraints:**
- Developer installs on all stations via remote (RDP/TeamViewer)
- 50+ stations in the future
- Cloud backend (with AgentService) already exists
- Node.js is present on client stations
- Updates must cover both `dist/` and `node_modules/`

---

## Architecture Overview

```
GitHub Releases
  └── HopoFiscalBridge-v{x.x.x}.zip
        ├── dist/
        ├── node_modules/
        ├── package.json
        ├── .env.example
        ├── nssm.exe
        └── install/
              ├── install.ps1
              ├── uninstall.ps1
              ├── update.ps1
              └── generate-env.js

Developer machine
  └── npm run release -- --version 1.x.x
        → build + zip + gh release create

Client station (Windows)
  └── Windows Service: HopoFiscalBridge
        → managed by NSSM
        → auto-start on boot
        → connects to cloud AgentService

Cloud → CommandExecutor
  └── command: "update" { version: "1.x.x" }
        → download ZIP → spawn update.ps1 detached → exit
        → update.ps1: stop service → replace files → start service
```

---

## Component 1: ZIP Structure & Release Pipeline

### ZIP Contents
| Path | Description |
|------|-------------|
| `dist/` | Compiled JavaScript (TypeScript build output) |
| `node_modules/` | npm dependencies |
| `package.json` | Package manifest |
| `.env.example` | Environment variable template |
| `nssm.exe` | Non-Sucking Service Manager (~300KB, open source) |
| `install/install.ps1` | PowerShell installer |
| `install/uninstall.ps1` | PowerShell uninstaller |
| `install/update.ps1` | Auto-update script (spawned by CommandExecutor) |
| `install/generate-env.js` | Generates .env with unique CLIENT_ID |

**Excluded from ZIP:** `src/`, `.env`, `logs/`, test files, `*.ts`

### Release Script: `scripts/create-release.js`

Run with: `npm run release -- --version 1.2.0`

Steps:
1. `npm install`
2. `npm run build`
3. Create `HopoFiscalBridge-v{version}.zip` with the structure above
4. Also create `HopoFiscalBridge-latest.zip` (same content, stable filename)
5. `gh release create v{version} HopoFiscalBridge-v{version}.zip HopoFiscalBridge-latest.zip`

**URL-uri de download:**
- Versioned (recomandat în comanda `update`): `releases/download/v{version}/HopoFiscalBridge-v{version}.zip`
- Latest (fallback): `releases/latest/download/HopoFiscalBridge-latest.zip`

**Notă:** URL-ul `/latest/` poate crea o fereastră de race condition dacă o stație primește comanda `update` exact în timpul upload-ului pe GitHub. De aceea, comanda `update` trimisă de cloud **trebuie să specifice întotdeauna o versiune explicită** în payload. URL-ul `/latest/` este rezervat pentru uz manual de către developer.

---

## Component 2: PowerShell Installer

### Notă despre ExecutionPolicy

Pe Windows, politica de execuție PowerShell este `Restricted` by default. Toate scripturile `.ps1` (inclusiv `update.ps1` spawnat programatic) trebuie invocate cu:
```
powershell.exe -ExecutionPolicy Bypass -File script.ps1
```
Aceasta nu schimbă politica persistentă a stației — se aplică doar procesului curent.

### install.ps1

Installation directory: `C:\HopoFiscalBridge\` (sau oriunde a fost extras ZIP-ul)

`install.ps1` trebuie rulat din rădăcina directorului de instalare (nu din subdirectorul `install\`), pentru că `generate-env.js` folosește `__dirname` relativ la a scrie `.env` în directorul părinte.

Steps:
1. Verifică că PowerShell rulează ca Administrator; abort dacă nu
2. Verifică Node.js ≥ v18 instalat; abort cu mesaj clar dacă nu
3. Dacă serviciul `HopoFiscalBridge` există deja: `nssm stop` + `nssm remove confirm` (re-instalare curată)
4. Rulează `node install\generate-env.js` (din rădăcina instalării) → creează `.env` cu UUID `CLIENT_ID` unic
5. Înregistrează serviciul via NSSM:
   ```
   .\install\nssm.exe install HopoFiscalBridge node "$installDir\dist\app.js"
   .\install\nssm.exe set HopoFiscalBridge AppDirectory "$installDir"
   .\install\nssm.exe set HopoFiscalBridge AppEnvironmentExtra NODE_ENV=production
   .\install\nssm.exe set HopoFiscalBridge Start SERVICE_AUTO_START
   .\install\nssm.exe start HopoFiscalBridge
   ```
6. Afișează mesaj de succes cu comanda de verificare: `sc query HopoFiscalBridge`

### uninstall.ps1

Steps:
1. `nssm stop HopoFiscalBridge`
2. `nssm remove HopoFiscalBridge confirm`
3. Prompt opțional pentru ștergerea directorului de instalare

---

## Component 3: Auto-Update via AgentService

### New CommandExecutor Command: `update`

Added to the existing `switch` in `CommandExecutor.execute()`:
```typescript
case 'update':
  await this.handleUpdate(cmd, ack);
  break;
```

### handleUpdate flow

**Payload:** `{ version: string }` — versiunea este **obligatorie** (nu se folosește `/latest/` în producție)

1. Construiește URL: `releases/download/v{version}/HopoFiscalBridge-v{version}.zip`
2. Descarcă ZIP în `os.tmpdir()\hopo-update-{timestamp}.zip` (folosește `os.tmpdir()`, nu `C:\temp\`)
3. Extrage ZIP în `os.tmpdir()\hopo-update-{timestamp}\`
4. Rezolvă directorul de instalare din `path.dirname(path.dirname(__filename))` (directorul părinte al `dist/`) — mai robust decât `process.cwd()` în context de Windows Service
5. Spawn `update.ps1` **complet detașat**:
   ```typescript
   const child = spawn('powershell.exe', [
     '-ExecutionPolicy', 'Bypass',
     '-File', path.join(installDir, 'install', 'update.ps1'),
     tempDir, installDir
   ], { detached: true, stdio: 'ignore' });
   child.unref(); // obligatoriu — eliberează referința pentru ca procesul părinte să poată ieși
   ```
6. ACK `{ success: true, message: "Update initiated, service restarting..." }`
7. `process.exit(0)`

**De ce detached + unref?** Serviciul nu poate înlocui propriile fișiere în timp ce rulează. `child.unref()` este obligatoriu pe Windows: fără el, procesul Node.js nu iese cu adevărat atât timp cât există referințe la procese copil, chiar dacă `detached: true`.

### update.ps1

Parameters: `$TempDir`, `$InstallDir`

Steps:
1. `nssm stop HopoFiscalBridge` (oprire imediată, nu așteptare)
2. Polling: verifică starea serviciului la fiecare 1s, max 15s, până ajunge la `Stopped`
3. Dacă timeout → forțează oprire și continuă
4. Copiază `$TempDir\dist\` → `$InstallDir\dist\` (overwrite)
5. Copiază `$TempDir\node_modules\` → `$InstallDir\node_modules\` (overwrite)
6. Copiază `$TempDir\package.json` → `$InstallDir\package.json`
7. `nssm start HopoFiscalBridge`
8. Creează `$InstallDir\logs\` dacă nu există (`New-Item -ItemType Directory -Force`)
9. Scrie rezultatul în `$InstallDir\logs\update.log`
10. Șterge `$TempDir` (cleanup)

**Notă:** `.env` nu este suprascris la update — configurația clientului este păstrată.

**Notă de securitate:** ZIP-ul este descărcat de pe un repo privat GitHub via HTTPS. Nu se face verificare de checksum în această versiune — risc acceptabil pentru un repo privat. Dacă repo-ul devine public în viitor, se adaugă verificare SHA256.

---

## Component 4: README Updates

README-ul pentru HopoFiscalBridge va documenta:
1. Secțiunea de instalare actualizată cu `install.ps1` (înlocuiește `install.bat`)
2. Secțiune nouă "Releasing a new version" pentru developer
3. Secțiune nouă "Auto-update" care explică comanda `update` din cloud
4. Eliminarea referințelor PM2 (Windows Service este singurul mod de producție suportat)

---

## Repository Migration

- Sursă: branch `hopo-fiscal-version` din `BongoFiscalBridge`
- Destinație: repo nou `HopoFiscalBridge`
- Branch-ul `main` al `BongoFiscalBridge` **nu este afectat** — rămâne neschimbat pentru clientul dedicat

---

## Error Handling

| Scenariu | Comportament |
|----------|-------------|
| Node.js nu este instalat | `install.ps1` abort cu mesaj clar |
| Serviciul există deja la instalare | `install.ps1` oprește și dezinstalează serviciul existent, apoi reinstalează |
| Download eșuat la update | ACK cu failure, niciun fișier nu este modificat |
| Timeout la așteptarea opririi serviciului | Forțează oprire, continuă cu înlocuirea fișierelor |
| Copiere fișiere eșuată în `update.ps1` | Loghează eroarea în `update.log`, încearcă `nssm start` indiferent |
| `logs/` nu există la scriere log | `New-Item -Force` creează directorul înainte de scriere |

---

## Out of Scope

- Rollback automat la update eșuat (considerație viitoare)
- Delta updates (doar înlocuire completă ZIP)
- Windows installer wizard (nu e necesar pentru instalare remote)
- Bundling Node.js runtime (Node.js este prezent pe toate stațiile)
- Verificare SHA256 a ZIP-ului (adăugată dacă repo-ul devine public)
