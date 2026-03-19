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

## Instalare pe stația clientului (Windows Service)

### Cerințe

- Windows 10 / 11
- [Node.js v18 sau mai recent](https://nodejs.org/) instalat
- Driverul ECR Bridge instalat și folderele `C:/ECRBridge/Bon/`, `C:/ECRBridge/BonOK/`, `C:/ECRBridge/BonErr/` create

### Pași de instalare

**1. Descarcă ZIP-ul de pe GitHub Releases**

Descarcă cel mai recent `HopoFiscalBridge-vX.X.X.zip` și extrage-l pe stație (ex: `C:\HopoFiscalBridge\`).

> ZIP-ul include `nssm.exe` (service manager) — nu trebuie instalat separat.

**2. Configurează `.env`**

Dacă vrei să precompletezi configurația înainte de instalare, creează `.env` în folderul extras:

```env
PORT=9000
ECR_BRIDGE_BON_PATH=C:/ECRBridge/Bon/
ECR_BRIDGE_BON_OK_PATH=C:/ECRBridge/BonOK/
ECR_BRIDGE_BON_ERR_PATH=C:/ECRBridge/BonErr/
ECR_BRIDGE_FISCAL_CODE=
RESPONSE_TIMEOUT=15000
BRIDGE_MODE=live
LOG_LEVEL=info
CLOUD_API_URL=https://adresa-aplicatiei-tale.com/api
CLOUD_API_KEY=cheia-secreta
UPDATE_GITHUB_REPO=owner/HopoFiscalBridge
```

> Dacă `.env` nu există, installerul îl creează automat cu un `CLIENT_ID` UUID unic.

**3. Rulează installerul**

Deschide PowerShell **ca Administrator**, navighează în folderul extras și rulează:

```powershell
powershell.exe -ExecutionPolicy Bypass -File install\install.ps1
```

Installerul face automat:
1. Verifică că rulează ca Administrator; oprește dacă nu
2. Verifică Node.js v18+; oprește cu mesaj clar dacă nu e instalat
3. Dacă serviciul `HopoFiscalBridge` există deja: îl oprește și îl dezinstalează (reinstalare curată)
4. Rulează `install\generate-env.js` → creează `.env` cu `CLIENT_ID` UUID unic (dacă nu există)
5. Înregistrează serviciul Windows `HopoFiscalBridge` via NSSM cu pornire automată la boot
6. Pornește serviciul
7. Afișează comanda de verificare

**4. Verifică că serviciul rulează**

```cmd
sc query HopoFiscalBridge
```

Răspuns așteptat: `STATE : 4  RUNNING`

**5. Testează endpoint-ul**

```cmd
curl http://localhost:9000/health
```

### Dezinstalare

```powershell
powershell.exe -ExecutionPolicy Bypass -File install\uninstall.ps1
```

---

## Lansare versiune nouă (pentru developer)

### Cerințe

- `gh` CLI instalat și autentificat (`gh auth login`)
- `install/nssm.exe` prezent local (descarcă de pe https://nssm.cc/download)

### Pași

```bash
npm run release -- --version 1.2.0
```

Scriptul face automat:
1. `npm install` + `npm run build`
2. Creează `HopoFiscalBridge-v1.2.0.zip` cu: `dist/`, `node_modules/`, `package.json`, `.env.example`, `nssm.exe`, `install/`
3. Creează și `HopoFiscalBridge-latest.zip` (același conținut, filename stabil)
4. Publică pe GitHub Releases: `gh release create v1.2.0 ...`

> **Notă:** Comanda `update` trimisă de cloud trebuie să specifice întotdeauna o versiune explicită (`{ "version": "1.2.0" }`). URL-ul `latest` este rezervat pentru uz manual de developer.

---

## Auto-update pe stații existente

Trimite comanda `update` de la cloud cu payload:

```json
{ "version": "1.2.0" }
```

### Ce se întâmplă pas cu pas

1. **Cloud → stație**: AgentService primește comanda `update` la polling-ul de comenzi
2. **Validare**: se verifică că `version` este prezent și în format semver (`X.Y.Z`); altfel ACK cu eroare
3. **Download ZIP**: serviciul descarcă `HopoFiscalBridge-v1.2.0.zip` de pe GitHub Releases în `%TEMP%\hopo-update-{timestamp}.zip`
4. **Extragere**: ZIP-ul se extrage în `%TEMP%\hopo-update-{timestamp}\`
5. **Spawn detașat**: serviciul lansează `install\update.ps1` complet detașat (`detached: true, stdio: 'ignore'`) cu parametrii `$TempDir` și `$InstallDir`; apelează `child.unref()` ca procesul Node.js să poată ieși
6. **ACK + exit**: serviciul trimite ACK `{ success: true, message: "Update initiated, service restarting..." }` și apelează `process.exit(0)`
7. **update.ps1 preia controlul** (rulează independent după ce Node.js a ieșit):
   - Oprește serviciul `HopoFiscalBridge` via NSSM
   - Polling: verifică la fiecare 1 secundă dacă serviciul s-a oprit, max 15 secunde
   - Dacă timeout: forțează oprire și continuă
   - Copiază `dist\` → `$InstallDir\dist\` (overwrite)
   - Copiază `node_modules\` → `$InstallDir\node_modules\` (overwrite)
   - Copiază `package.json` → `$InstallDir\package.json`
   - Pornește serviciul `HopoFiscalBridge` via NSSM
   - Scrie rezultatul în `$InstallDir\logs\update.log`
   - Șterge fișierele temporare din `%TEMP%`

> **`.env` nu este suprascris la update** — configurația clientului (CLIENT_ID, căi ECR, credențiale cloud) este păstrată intactă.

Progresul update-ului poate fi urmărit în `logs\update.log` pe stație.

---

## Comenzi remote (cloud → stație)

AgentService face polling periodic la cloud (`GET /bridges/commands/{clientId}`) și execută comenzile primite. Fiecare comandă este confirmată (ACK) la `POST /bridges/commands/{clientId}/ack`.

### restart

**Payload:** `{}` (gol)

**Ce face:**
1. Trimite ACK `{ success: true, message: "Restarting..." }`
2. Apelează `process.exit(0)`
3. NSSM detectează că serviciul s-a oprit și îl repornește automat

**Utilizare:** repornire rapidă după o configurare manuală sau pentru a aplica modificări la `.env` făcute direct pe stație.

```json
{ "command": "restart", "payload": {} }
```

---

### set_config

**Payload:** obiect cu una sau mai multe chei de configurare

**Ce face:**
1. Validează că fiecare cheie trimisă este permisă și că valoarea respectă constrângerile
2. Citește `.env`-ul existent, actualizează sau adaugă fiecare cheie
3. Scrie `.env`-ul modificat pe disc
4. Trimite ACK `{ success: true, message: "Config updated, restarting..." }`
5. Apelează `process.exit(0)` → NSSM repornește serviciul cu noua configurație

**Chei permise:**

| Cheie | Valori acceptate | Descriere |
|-------|-----------------|-----------|
| `BRIDGE_MODE` | `live` sau `test` | `live` = bonuri fiscale reale; `test` = chitanțe de test non-fiscale |
| `RESPONSE_TIMEOUT` | număr între `5000` și `60000` | Timeout (ms) pentru așteptarea răspunsului ECR Bridge la `/print` |
| `LOG_LEVEL` | `info`, `warn`, `error` | Nivelul minim de logare |
| `HEARTBEAT_INTERVAL` | număr ≥ `5000` | Interval (ms) între heartbeat-uri către cloud |
| `LOG_BATCH_INTERVAL` | număr ≥ `10000` | Interval (ms) între trimiterea batch-urilor de loguri |
| `COMMAND_POLL_INTERVAL` | număr ≥ `5000` | Interval (ms) între polling-ul de comenzi |

Dacă o cheie nu este în lista permisă sau valoarea nu respectă constrângerile, se returnează ACK cu `success: false` fără a modifica `.env`.

**Exemple:**

Activare mod test:
```json
{ "command": "set_config", "payload": { "BRIDGE_MODE": "test" } }
```

Revenire la mod live:
```json
{ "command": "set_config", "payload": { "BRIDGE_MODE": "live" } }
```

Modificare timeout și nivel logare:
```json
{ "command": "set_config", "payload": { "RESPONSE_TIMEOUT": "20000", "LOG_LEVEL": "warn" } }
```

---

### update

**Payload:** `{ "version": "X.Y.Z" }` — versiunea este obligatorie în format semver

**Ce face:** descris detaliat în secțiunea [Auto-update pe stații existente](#auto-update-pe-stații-existente).

```json
{ "command": "update", "payload": { "version": "1.2.0" } }
```

---

## API Endpoints

### POST /print

Emite un bon fiscal.

**Request Body:**

```json
{
  "productName": "Ora de joacă",
  "duration": "1h 15m",
  "price": 22.50,
  "paymentType": "CASH"
}
```

**Câmpuri:**
- `productName` (string, obligatoriu): Numele produsului/serviciului
- `duration` (string, obligatoriu): Durata serviciului
- `price` (number, obligatoriu): Prețul (trebuie să fie pozitiv)
- `paymentType` (string, obligatoriu): `"CASH"` sau `"CARD"`

**Răspuns success (200):**

```json
{
  "status": "success",
  "message": "Bon fiscal emis",
  "file": "bon_20231215143022.txt"
}
```

**Răspuns eroare (400/500/504):**

```json
{
  "status": "error",
  "message": "Eroare la imprimare",
  "details": "Detalii despre eroare..."
}
```

**Exemplu curl:**

```bash
curl -X POST http://localhost:9000/print \
  -H "Content-Type: application/json" \
  -d '{
    "productName": "Ora de joacă",
    "duration": "1h 15m",
    "price": 22.50,
    "paymentType": "CASH"
  }'
```

---

### POST /z-report

Declanșează un raport Z (raport zilnic de închidere).

**Request Body:** gol `{}`

**Răspuns success (200):**

```json
{
  "status": "success",
  "message": "Z;1",
  "file": "zreport_20231215143022.txt"
}
```

**Răspuns eroare (500/504):**

```json
{
  "status": "error",
  "message": "Eroare la generarea raportului Z",
  "details": "Detalii despre eroare..."
}
```

> **Notă:** Raportul Z are un timeout de 30 de secunde (față de `RESPONSE_TIMEOUT` pentru bonuri), deoarece procesarea poate dura mai mult.

**Exemplu curl:**

```bash
curl -X POST http://localhost:9000/z-report \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

### GET /health

Verificarea stării serverului.

**Răspuns:**

```json
{
  "status": "ok",
  "service": "bongo-fiscal-bridge",
  "timestamp": "2023-12-15T14:30:22.000Z"
}
```

---

## Structura fișierelor ECR Bridge

### Format bon fiscal

```
FISCAL
I;{productName} ({duration});1;{price};1
P;{pay_code};0
```

Dacă `ECR_BRIDGE_FISCAL_CODE` este setat:

```
FISCAL;{fiscalCode}
I;{productName} ({duration});1;{price};1
P;{pay_code};0
```

- `pay_code`: `0` = CASH, `1` = CARD
- Prețul folosește punct ca separator zecimal

### Nume fișiere

- **Bon generat:** `bon_{timestamp}.txt` — scris în `ECR_BRIDGE_BON_PATH`
- **Raport Z generat:** `zreport_{timestamp}.txt` — scris în `ECR_BRIDGE_BON_PATH`
- **Răspuns OK:** `bon_{timestamp}.OK` sau `zreport_{timestamp}.OK` — apare în `ECR_BRIDGE_BON_OK_PATH`
- **Răspuns ERR:** `bon_{timestamp}.ERR` sau `zreport_{timestamp}.ERR` — apare în `ECR_BRIDGE_BON_ERR_PATH`

Timestamp în format `YYYYMMDDHHmmss`.

---

## Configurare

Toate configurațiile se fac prin fișierul `.env`:

| Variabilă | Descriere | Default |
|-----------|-----------|---------|
| `PORT` | Portul serverului HTTP | `9000` |
| `ECR_BRIDGE_BON_PATH` | Calea către folderul Bon | `C:/ECRBridge/Bon/` |
| `ECR_BRIDGE_BON_OK_PATH` | Calea către folderul BonOK | `C:/ECRBridge/BonOK/` |
| `ECR_BRIDGE_BON_ERR_PATH` | Calea către folderul BonErr | `C:/ECRBridge/BonErr/` |
| `ECR_BRIDGE_FISCAL_CODE` | Cod fiscal (opțional) — inclus în header dacă setat | - |
| `RESPONSE_TIMEOUT` | Timeout pentru bon (ms) | `15000` |
| `BRIDGE_MODE` | `live` (bonuri fiscale) sau `test` (chitanțe de test) | `live` |
| `LOG_LEVEL` | Nivelul de logare: `info`, `warn`, `error` | `info` |
| `CLIENT_ID` | UUID unic al stației — generat automat la instalare | - |
| `CLOUD_API_URL` | URL-ul API-ului cloud pentru AgentService | - |
| `CLOUD_API_KEY` | Cheia de autentificare pentru cloud API | - |
| `UPDATE_GITHUB_REPO` | Repo GitHub pentru auto-update (format: `owner/repo`) | - |
| `HEARTBEAT_INTERVAL` | Interval heartbeat (ms) | `60000` |
| `LOG_BATCH_INTERVAL` | Interval trimitere loguri (ms) | `30000` |
| `COMMAND_POLL_INTERVAL` | Interval polling comenzi (ms) | `15000` |

---

## Loguri

Aplicația generează loguri în folderul `logs/`:

- **`app.log`**: Toate logurile (info, warn, error)
- **`error.log`**: Doar erorile
- **`update.log`**: Rezultatul ultimei operațiuni de auto-update

Logurile sunt în format JSON cu timestamp și informații detaliate.

---

## Instalare pentru dezvoltare (fără serviciu Windows)

### Cerințe

- Node.js v18 sau mai recent
- npm

### Pași

1. Clonează proiectul
2. Instalează dependențele:

```bash
npm install
```

3. Configurează variabilele de mediu:

```bash
cp .env.example .env
```

Editează `.env` și configurează căile ECR Bridge.

**Pentru testare pe Mac/Linux:**
```env
ECR_BRIDGE_BON_PATH=./ecrBridge/Bon/
ECR_BRIDGE_BON_OK_PATH=./ecrBridge/BonOK/
ECR_BRIDGE_BON_ERR_PATH=./ecrBridge/BonErr/
```

### Rulare development

```bash
npm run dev
```

### Rulare production

```bash
npm run build
npm start
```

---

## Troubleshooting

### Timeout la așteptarea răspunsului

**Cauze posibile:** ECR Bridge nu rulează, căi incorecte, casa de marcat deconectată.

1. Verifică că ECR Bridge este pornit
2. Verifică căile din `.env`
3. Verifică că folderele există și sunt accesibile
4. Verifică logurile: `logs/app.log`

### Eroare la generarea fișierului

**Cauze posibile:** permisiuni insuficiente, folderul nu există, calea incorectă.

1. Verifică permisiunile folderului
2. Rulează serviciul cu permisiuni de administrator
3. Verifică că calea este corectă în `.env`

### Validare eșuată

- `paymentType` trebuie să fie exact `"CASH"` sau `"CARD"`
- `price` trebuie să fie un număr pozitiv

---

## Licență

ISC
