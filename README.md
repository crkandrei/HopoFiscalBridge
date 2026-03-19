# Bongo Fiscal Bridge

Microserviciu local pentru trimiterea bonurilor fiscale către casa de marcat Datecs DP-25 MX prin intermediul driverului ECR Bridge.

## 📋 Descriere

Acest microserviciu oferă un endpoint HTTP REST pentru generarea și trimiterea bonurilor fiscale către casa de marcat Datecs DP-25 MX. Aplicația comunică cu casa de marcat prin intermediul driverului ECR Bridge, care folosește un sistem de fișiere pentru comunicare.

## 🚀 Instalare

### Instalare pe stația clientului (Windows Service)

#### Cerințe

- Windows 10 / 11
- [Node.js v18 sau mai recent](https://nodejs.org/) instalat
- Driverul ECR Bridge instalat și folderele `C:/ECRBridge/Bon/`, `C:/ECRBridge/BonOK/`, `C:/ECRBridge/BonErr/` create

#### Pași de instalare

**1. Descarcă ZIP-ul de pe GitHub Releases**

Descarcă cel mai recent `HopoFiscalBridge-vX.X.X.zip` și extrage-l pe stație (ex: `C:\HopoFiscalBridge\`).

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
1. Verifică Node.js v18+
2. Generează `.env` cu `CLIENT_ID` unic (dacă nu există)
3. Înregistrează serviciul Windows `HopoFiscalBridge` via NSSM
4. Pornește serviciul

**4. Verifică că serviciul rulează**

```cmd
sc query HopoFiscalBridge
```

Răspuns așteptat: `STATE : 4  RUNNING`

**5. Testează endpoint-ul**

```cmd
curl http://localhost:9000/health
```

#### Dezinstalare

```powershell
powershell.exe -ExecutionPolicy Bypass -File install\uninstall.ps1
```

---

### Instalare pentru dezvoltare (fără serviciu Windows)

#### Cerințe

- Node.js v18 sau mai recent
- npm sau yarn

#### Pași de instalare

1. Clonează sau descarcă proiectul
2. Instalează dependențele:

```bash
npm install
```

3. Configurează variabilele de mediu:

```bash
cp .env.example .env
```

Editează fișierul `.env` și configurează căile către folderele ECR Bridge:

```env
PORT=9000
ECR_BRIDGE_BON_PATH=C:/ECRBridge/Bon/
ECR_BRIDGE_BON_OK_PATH=C:/ECRBridge/BonOK/
ECR_BRIDGE_BON_ERR_PATH=C:/ECRBridge/BonErr/
ECR_BRIDGE_FISCAL_CODE=
RESPONSE_TIMEOUT=15000
LOG_LEVEL=info
```

**Notă:** `ECR_BRIDGE_FISCAL_CODE` este opțional. Dacă este setat, va fi inclus în header-ul bonului fiscal (`FISCAL;{fiscalCode}`). Dacă nu este setat, se folosește doar `FISCAL`.

**Notă:** Pentru testare pe Mac/Linux, poți folosi căi relative:
```env
ECR_BRIDGE_BON_PATH=./ecrBridge/Bon/
ECR_BRIDGE_BON_OK_PATH=./ecrBridge/BonOK/
ECR_BRIDGE_BON_ERR_PATH=./ecrBridge/BonErr/
```

## 🏃 Rulare

### Mod Development

Pentru dezvoltare cu auto-reload:

```bash
npm run dev
```

### Mod Production

1. Compilează TypeScript:

```bash
npm run build
```

2. Pornește serverul:

```bash
npm start
```

## 🚀 Lansare versiune nouă (pentru developer)

### Cerințe

- `gh` CLI instalat și autentificat (`gh auth login`)
- `install/nssm.exe` prezent local (descarcă de pe https://nssm.cc/download)

### Pași

```bash
npm run release -- --version 1.2.0
```

Scriptul face automat:
1. `npm install` + `npm run build`
2. Creează ZIP cu `dist/`, `node_modules/`, scripturi instalare
3. Publică pe GitHub Releases

## 🔄 Auto-update pe stații existente

Trimite comanda `update` de la cloud cu payload:

```json
{ "version": "1.2.0" }
```

Stația descarcă ZIP-ul, înlocuiește fișierele și repornește serviciul automat. `.env` (configurația clientului) nu este suprascris.

---

## 📡 API Endpoints

### POST /print

Endpoint principal pentru generarea și trimiterea bonurilor fiscale.

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
- `paymentType` (string, obligatoriu): Tipul de plată - `"CASH"` sau `"CARD"`

**Răspuns Success (200):**

```json
{
  "status": "success",
  "message": "Bon fiscal emis",
  "file": "bon_20231215143022.txt"
}
```

**Răspuns Error (400/500/504):**

```json
{
  "status": "error",
  "message": "Eroare la imprimare",
  "details": "Detalii despre eroare..."
}
```

**Exemplu cu curl:**

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

### GET /health

Endpoint pentru verificarea stării serverului.

**Răspuns:**

```json
{
  "status": "ok",
  "service": "bongo-fiscal-bridge",
  "timestamp": "2023-12-15T14:30:22.000Z"
}
```

## 📁 Structura Fișierelor ECR Bridge

Aplicația generează fișiere în formatul specificat de ECR Bridge:

### Format Fișier Bon

Fișierul generat respectă formatul oficial Datecs și are următoarea structură:

```
FISCAL
I;{productName} ({duration});1;{price};1
P;{pay_code};0
```

Sau, dacă `ECR_BRIDGE_FISCAL_CODE` este setat:

```
FISCAL;{fiscalCode}
I;{productName} ({duration});1;{price};1
P;{pay_code};0
```

**Exemple:**

Pentru plată cash (numerar):
```
FISCAL
I;Ora de joacă (1h 15m);1;22.50;1
P;0;0
```

Pentru plată card:
```
FISCAL
I;Ora de joacă (1h 15m);1;22.50;1
P;1;0
```

**Structura:**
- **Linia 1:** `FISCAL` sau `FISCAL;{fiscalCode}` - Header obligatoriu pentru bon fiscal
- **Linia 2:** `I;name;qty;price;vat` - Linie de articol
  - `I;` - Comandă de imprimare articol
  - `{productName} ({duration})` - Nume produs și durată
  - `1` - Cantitate
  - `{price}` - Preț unitar (cu punct ca separator zecimal)
  - `1` - Cod cota TVA
- **Linia 3:** `P;pay_code;value` - Linie de plată obligatorie
  - `pay_code`: `0` = CASH (Numerar), `1` = CARD (Card) - conform documentației Datecs
  - `value`: `0` = achită suma totală

### Nume Fișiere

- **Bon generat:** `bon_{timestamp}.txt` (ex: `bon_20231215143022.txt`)
- **Răspuns OK:** `bon_{timestamp}.OK` (în folderul BonOK)
- **Răspuns ERR:** `bon_{timestamp}.ERR` (în folderul BonErr)

Timestamp-ul este în format `YYYYMMDDHHmmss`.

## 📝 Loguri

Aplicația generează loguri în folderul `logs/`:

- **`app.log`**: Toate logurile (info, warn, error)
- **`error.log`**: Doar erorile
- **`pm2-out.log`**: Output PM2 (dacă folosești PM2)
- **`pm2-error.log`**: Erori PM2 (dacă folosești PM2)

Logurile sunt în format JSON cu timestamp și informații detaliate.

## 🔧 Configurare

Toate configurațiile se fac prin fișierul `.env`:

| Variabilă | Descriere | Default |
|-----------|-----------|---------|
| `PORT` | Portul serverului HTTP | `9000` |
| `ECR_BRIDGE_BON_PATH` | Calea către folderul Bon | `C:/ECRBridge/Bon/` |
| `ECR_BRIDGE_BON_OK_PATH` | Calea către folderul BonOK | `C:/ECRBridge/BonOK/` |
| `ECR_BRIDGE_BON_ERR_PATH` | Calea către folderul BonErr | `C:/ECRBridge/BonErr/` |
| `ECR_BRIDGE_FISCAL_CODE` | Cod fiscal (opțional) - dacă este setat, va fi inclus în header | - |
| `RESPONSE_TIMEOUT` | Timeout pentru așteptare răspuns (ms) | `15000` |
| `LOG_LEVEL` | Nivelul de logare (info, warn, error) | `info` |

## 🐛 Troubleshooting

### Problema: Timeout la așteptarea răspunsului

**Cauze posibile:**
- ECR Bridge nu este pornit
- Căile către foldere sunt incorecte
- Casa de marcat nu este conectată sau nu răspunde

**Soluții:**
1. Verifică că ECR Bridge este pornit și funcționează
2. Verifică că căile din `.env` sunt corecte
3. Verifică că folderele există și sunt accesibile
4. Verifică logurile pentru detalii: `logs/app.log` sau `logs/error.log`

### Problema: Eroare la generarea fișierului

**Cauze posibile:**
- Permisiuni insuficiente pentru scrierea în folder
- Folderul nu există și nu poate fi creat
- Calea este incorectă

**Soluții:**
1. Verifică permisiunile folderului
2. Rulează aplicația cu permisiuni de administrator (pe Windows)
3. Verifică că calea este corectă în `.env`

### Problema: Validare eșuată

**Cauze posibile:**
- Datele trimise nu respectă formatul cerut
- `paymentType` nu este "CASH" sau "CARD"
- `price` nu este un număr pozitiv

**Soluții:**
1. Verifică formatul JSON trimis
2. Asigură-te că `paymentType` este exact "CASH" sau "CARD"
3. Verifică că `price` este un număr pozitiv

## 🔗 Integrare cu Laravel

Pentru a integra acest microserviciu într-o aplicație Laravel, poți folosi HTTP Client:

```php
use Illuminate\Support\Facades\Http;

$response = Http::post('http://localhost:9000/print', [
    'productName' => 'Ora de joacă',
    'duration' => '1h 15m',
    'price' => 22.50,
    'paymentType' => 'CASH'
]);

if ($response->successful()) {
    $data = $response->json();
    if ($data['status'] === 'success') {
        // Bon emis cu succes
        logger()->info('Bon fiscal emis', ['file' => $data['file']]);
    } else {
        // Eroare la imprimare
        logger()->error('Eroare la imprimare', ['details' => $data['details']]);
    }
}
```

## 📄 Licență

ISC

## 👤 Autor

Proiect creat pentru integrarea cu casa de marcat Datecs DP-25 MX.

