# HopoFiscalBridge

Microserviciu local pentru trimiterea bonurilor fiscale și rapoartelor Z către casa de marcat Datecs DP-25 MX prin intermediul driverului ECR Bridge.

## Descriere și funcționalități

HopoFiscalBridge rulează ca **Windows Service** pe stațiile clienților și expune un API HTTP REST pentru generarea bonurilor fiscale și rapoartelor Z. Serviciul comunică cu casa de marcat prin **ECR Bridge** — un driver care folosește un sistem de fișiere pentru comunicare (Bon/, BonOK/, BonErr/).

**Funcționalități principale:**

- **Emitere bon fiscal** — generează fișierul bon în formatul Datecs, îl scrie în folderul `Bon/`, așteaptă confirmarea ECR Bridge din `BonOK/` sau eroarea din `BonErr/`
- **Raport Z** — generează fișierul de raport Z, așteaptă 30 de secunde pentru răspunsul casei de marcat
- **Mod test / mod live** — `BRIDGE_MODE=live` emite bonuri fiscale reale; `BRIDGE_MODE=test` emite chitanțe de test (non-fiscale), util pentru verificare fără imprimare reală
- **AgentService** — se conectează la cloud (API configurat în `.env`) și trimite heartbeat-uri periodice cu statusul stației, loghează evenimentele și primește comenzi de la distanță
- **Comenzi remote** — `restart`, `set_config`, `update` — pot fi trimise de pe cloud fără acces fizic la stație
- **Auto-update** — descarcă o versiune nouă de pe GitHub Releases, înlocuiește fișierele și repornește serviciul automat

---

## Instalare client nou (ghid complet)

### Pas 1 — Instalează Node.js pe stație

Deschide PowerShell ca Administrator și rulează:

```powershell
winget install OpenJS.NodeJS.LTS
```

Dacă `winget` nu e disponibil (Windows mai vechi):

```powershell
Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.19.0/node-v20.19.0-x64.msi" -OutFile "C:\node-install.msi"
Start-Process msiexec.exe -Wait -ArgumentList '/I C:\node-install.msi /quiet'
```

**Închide și redeschide PowerShell ca Administrator** după instalare (PATH-ul nu se actualizează în sesiunea curentă). Verifică:

```powershell
node --version
```

Trebuie să apară `v20.x.x` sau mai recent.

---

### Pas 2 — Descarcă și extrage ZIP-ul

```powershell
Invoke-WebRequest -Uri "https://github.com/crkandrei/HopoFiscalBridge/releases/latest/download/HopoFiscalBridge-latest.zip" -OutFile "C:\HopoFiscalBridge.zip"
Expand-Archive -Path "C:\HopoFiscalBridge.zip" -DestinationPath "C:\HopoFiscalBridge" -Force
```

> ZIP-ul include `nssm.exe` — nu trebuie instalat separat.

---

### Pas 3 — Generează `.env` cu CLIENT_ID unic

Dacă există deja un `.env` gol (de la o instalare anterioară eșuată), șterge-l mai întâi:

```powershell
if (Test-Path C:\HopoFiscalBridge\.env) { Remove-Item C:\HopoFiscalBridge\.env }
node C:\HopoFiscalBridge\install\generate-env.js
```

Asta creează un `.env` complet cu un `CLIENT_ID` UUID unic generat automat.

---

### Pas 4 — Generează API Key în aplicația web

1. Intră în aplicația web → **Locații** → selectează locația clientului → **Editează**
2. Secțiunea **Configurare Bridge** → apasă **Generează API Key**
3. Copiază key-ul afișat (ex: `0abb536fe5cf561d...`)

---

### Pas 5 — Completează `.env`

```powershell
notepad C:\HopoFiscalBridge\.env
```

Completează câmpurile goale:

```env
ECR_BRIDGE_FISCAL_CODE=RO12345678      # CUI-ul clientului (opțional)
CLOUD_API_URL=https://app.hopo.ro/api
CLOUD_API_KEY=<key-ul copiat la pasul 4>
UPDATE_GITHUB_REPO=crkandrei/HopoFiscalBridge
```

Restul valorilor (PORT, căile ECR, RESPONSE_TIMEOUT etc.) sunt deja corecte din generare.

---

### Pas 6 — Rulează installerul

```powershell
cd C:\HopoFiscalBridge
powershell.exe -ExecutionPolicy Bypass -File install\install.ps1
```

Installerul face automat:
1. Verifică că rulează ca Administrator
2. Verifică Node.js v18+
3. Dacă serviciul există deja — îl oprește și îl dezinstalează (reinstalare curată)
4. Înregistrează serviciul `HopoFiscalBridge` via NSSM cu pornire automată la boot
5. Pornește serviciul

---

### Pas 7 — Verifică instalarea

```cmd
sc query HopoFiscalBridge
```

Trebuie să apară `STATE : 4  RUNNING`.

```cmd
curl http://localhost:9000/health
```

Trebuie să returneze `{"status":"ok",...}`.

---

### Pas 8 — Verifică conexiunea cu cloud-ul

În aplicația web → **Locații** → coloana **Bridge** trebuie să afișeze **Online** în maxim 30-60 de secunde după pornirea serviciului.

Dacă după 60 de secunde tot apare „Niciodată conectat", verifică log-urile:

```powershell
type C:\HopoFiscalBridge\logs\app.log
```

Caută `AgentService starting` — dacă apare `AgentService disabled or CLOUD_API_URL not set`, înseamnă că `.env`-ul nu a fost citit (repornește serviciul):

```powershell
Restart-Service HopoFiscalBridge
```

---

## Lansare versiune nouă (pentru developer)

### Cerințe (o singură dată pe mașina de dev)

- `gh` CLI instalat (`brew install gh`) și autentificat (`gh auth login`)
- `install/nssm.exe` prezent local — dacă lipsește:

```bash
curl -L https://nssm.cc/release/nssm-2.24.zip -o /tmp/nssm.zip
unzip -p /tmp/nssm.zip nssm-2.24/win64/nssm.exe > install/nssm.exe
```

### Creare release

```bash
cd /path/to/HopoFiscalBridge
npm install  # dacă e prima dată după clone
npm run release -- --version 1.2.0
```

Scriptul face automat: build → ZIP → publică pe GitHub Releases.

---

## Auto-update pe stații existente

Trimite comanda `update` din aplicația web (Edit locație → Configurare Bridge → câmpul de versiune) sau direct:

```json
{ "command": "update", "payload": { "version": "1.2.0" } }
```

### Ce se întâmplă pas cu pas

1. AgentService primește comanda la polling (max 10 secunde)
2. Descarcă `HopoFiscalBridge-v1.2.0.zip` de pe GitHub Releases în `%TEMP%`
3. Extrage ZIP-ul în `%TEMP%`
4. Lansează `install\update.ps1` complet detașat și iese din proces
5. `update.ps1` oprește serviciul, așteaptă max 15s
6. Copiază `dist\`, `node_modules\`, `package.json` (`.env` nu e atins)
7. Pornește serviciul
8. Scrie rezultatul în `logs\update.log`
9. Șterge fișierele temporare

---

## Comenzi remote (cloud → stație)

### restart

```json
{ "command": "restart", "payload": {} }
```

Serviciul iese cu `exit(0)`, NSSM îl repornește automat.

---

### set_config

Actualizează `.env` și repornește serviciul. Chei permise:

| Cheie | Valori acceptate |
|-------|-----------------|
| `BRIDGE_MODE` | `live` sau `test` |
| `RESPONSE_TIMEOUT` | număr între `5000` și `60000` |
| `LOG_LEVEL` | `info`, `warn`, `error` |
| `HEARTBEAT_INTERVAL` | număr ≥ `5000` |
| `LOG_BATCH_INTERVAL` | număr ≥ `10000` |
| `COMMAND_POLL_INTERVAL` | număr ≥ `5000` |

Exemple:
```json
{ "command": "set_config", "payload": { "BRIDGE_MODE": "test" } }
{ "command": "set_config", "payload": { "BRIDGE_MODE": "live" } }
```

---

### update

Descris în secțiunea [Auto-update pe stații existente](#auto-update-pe-stații-existente).

---

## API Endpoints

### POST /print

```json
{
  "productName": "Ora de joacă",
  "duration": "1h 15m",
  "price": 22.50,
  "paymentType": "CASH"
}
```

- `paymentType`: `"CASH"` sau `"CARD"`
- Răspuns success `200`: `{ "status": "success", "file": "bon_20231215143022.txt" }`
- Răspuns eroare `400/500/504`: `{ "status": "error", "message": "...", "details": "..." }`

---

### POST /z-report

Body gol. Timeout 30 secunde. Răspuns success: `{ "status": "success", "message": "Z;1" }`.

---

### GET /health

```json
{ "status": "ok", "service": "bongo-fiscal-bridge", "timestamp": "..." }
```

---

## Configurare `.env`

| Variabilă | Descriere | Default |
|-----------|-----------|---------|
| `PORT` | Portul HTTP | `9000` |
| `ECR_BRIDGE_BON_PATH` | Folder Bon | `C:/ECRBridge/Bon/` |
| `ECR_BRIDGE_BON_OK_PATH` | Folder BonOK | `C:/ECRBridge/BonOK/` |
| `ECR_BRIDGE_BON_ERR_PATH` | Folder BonErr | `C:/ECRBridge/BonErr/` |
| `ECR_BRIDGE_FISCAL_CODE` | CUI client (opțional) | - |
| `RESPONSE_TIMEOUT` | Timeout bon (ms) | `15000` |
| `BRIDGE_MODE` | `live` sau `test` | `live` |
| `LOG_LEVEL` | `info`, `warn`, `error` | `info` |
| `CLIENT_ID` | UUID unic — generat automat | - |
| `CLOUD_API_URL` | URL API cloud | - |
| `CLOUD_API_KEY` | Cheie autentificare cloud | - |
| `UPDATE_GITHUB_REPO` | `crkandrei/HopoFiscalBridge` | - |
| `HEARTBEAT_INTERVAL` | Interval heartbeat (ms) | `30000` |
| `LOG_BATCH_INTERVAL` | Interval trimitere loguri (ms) | `60000` |
| `COMMAND_POLL_INTERVAL` | Interval polling comenzi (ms) | `10000` |

---

## Dezinstalare

```powershell
powershell.exe -ExecutionPolicy Bypass -File install\uninstall.ps1
```

---

## Licență

ISC
