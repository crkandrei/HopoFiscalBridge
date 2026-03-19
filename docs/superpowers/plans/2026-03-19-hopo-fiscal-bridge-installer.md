# HopoFiscalBridge Installer & Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the node-windows–based installer with NSSM + PowerShell scripts, add a self-contained ZIP release pipeline, and implement remote auto-update via a new `update` command in CommandExecutor.

**Architecture:** A ZIP published to GitHub Releases contains the pre-built app (`dist/`, `node_modules/`) plus NSSM and PowerShell scripts. Initial installation runs `install.ps1` which registers the service via NSSM. Remote updates are triggered by the cloud sending an `update` command; the Node.js service downloads the new ZIP, spawns `update.ps1` detached, and exits. `update.ps1` waits for the service to stop, replaces files, and restarts.

**Tech Stack:** Node.js 18+, TypeScript, NSSM (Windows service manager), PowerShell, `adm-zip` (ZIP extraction), GitHub Releases (`gh` CLI), Jest

**Spec:** `docs/superpowers/specs/2026-03-19-hopo-fiscal-bridge-installer-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `package.json` | add `adm-zip` dep, remove `node-windows`, add `release` script |
| Modify | `src/config/config.ts` | add `update.githubRepo` config key |
| Modify | `.env.example` | add `UPDATE_GITHUB_REPO` variable |
| Modify | `src/services/commandExecutor.service.ts` | add `update` command handler |
| Modify | `src/services/__tests__/commandExecutor.service.test.ts` | tests for `update` command |
| Create | `install/install.ps1` | PowerShell installer (replaces install.bat + setup.js) |
| Create | `install/uninstall.ps1` | PowerShell uninstaller (replaces uninstall.bat + uninstall.js) |
| Create | `install/update.ps1` | auto-update file replacement script |
| Create | `scripts/create-release.js` | builds ZIP and creates GitHub Release |
| Modify | `README.md` | update installation + add release/auto-update sections |
| Delete | `install/install.bat` | replaced by install.ps1 |
| Delete | `install/setup.js` | replaced by install.ps1 |
| Delete | `install/uninstall.bat` | replaced by uninstall.ps1 |
| Delete | `install/uninstall.js` | replaced by uninstall.ps1 |

---

## Task 1: Dependencies & Config

**Files:**
- Modify: `package.json`
- Modify: `src/config/config.ts`
- Modify: `.env.example`

- [ ] **Step 1: Install adm-zip types and remove node-windows**

> Note: `adm-zip` is already in `dependencies`. Only install types and remove `node-windows`.

```bash
npm install --save-dev @types/adm-zip
npm uninstall node-windows
```

- [ ] **Step 2: Verify package.json is correct**

Run: `cat package.json | grep -E "adm-zip|node-windows"`
Expected: `adm-zip` present in dependencies, `node-windows` absent.

- [ ] **Step 3: Add `update.githubRepo` to config.ts**

In `src/config/config.ts`, add to the `export const config` object (after the `agent` block):

```typescript
  // Auto-update
  update: {
    // Format: "owner/repo" — used to build GitHub Releases download URL
    githubRepo: process.env.UPDATE_GITHUB_REPO || '',
  },
```

- [ ] **Step 4: Add UPDATE_GITHUB_REPO to .env.example**

Append to `.env.example`:

```env

# Auto-update — GitHub repo for release downloads (format: owner/repo)
UPDATE_GITHUB_REPO=your-github-org/HopoFiscalBridge
```

- [ ] **Step 5: Run tests to make sure nothing broke**

```bash
npm test
```

Expected: all existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/config/config.ts .env.example
git commit -m "feat: add adm-zip, remove node-windows, add update config key"
```

---

## Task 2: `update` Command in CommandExecutor (TDD)

**Files:**
- Modify: `src/services/__tests__/commandExecutor.service.test.ts`
- Modify: `src/services/commandExecutor.service.ts`

### Step 2a: Write failing tests

- [ ] **Step 1: Add update tests to the test file**

In `src/services/__tests__/commandExecutor.service.test.ts`, add these mocks at the top of the file (after existing imports):

```typescript
import * as childProcess from 'child_process';
import AdmZip from 'adm-zip';

jest.mock('child_process');
jest.mock('adm-zip');
```

Then add a new `describe('update', ...)` block after the existing `describe('unknown command', ...)`:

```typescript
describe('update', () => {
  const mockFetch = jest.fn();
  const mockSpawn = childProcess.spawn as jest.Mock;
  const MockAdmZip = AdmZip as jest.MockedClass<typeof AdmZip>;

  beforeEach(() => {
    global.fetch = mockFetch;
    mockSpawn.mockReturnValue({ unref: jest.fn() });
    MockAdmZip.mockImplementation(() => ({
      extractAllTo: jest.fn(),
    }) as any);
  });

  afterEach(() => {
    jest.resetAllMocks(); // resets mockImplementation on jest.mock mocks; restoreAllMocks only works for spyOn
  });

  it('sends failure ACK if version is missing', async () => {
    await executor.execute(
      { commandId: 'upd1', command: 'update', payload: null },
      mockAck
    );
    expect(mockAck).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: expect.stringContaining('version') })
    );
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('sends failure ACK if githubRepo is not configured', async () => {
    const executorNoRepo = new CommandExecutor(
      { ...mockConfig, update: { githubRepo: '' } },
      mockExit
    );
    await executorNoRepo.execute(
      { commandId: 'upd2', command: 'update', payload: { version: '1.0.0' } },
      mockAck
    );
    expect(mockAck).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: expect.stringContaining('UPDATE_GITHUB_REPO') })
    );
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('sends failure ACK if download fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });
    const executorWithRepo = new CommandExecutor(
      { ...mockConfig, update: { githubRepo: 'owner/HopoFiscalBridge' } },
      mockExit
    );
    await executorWithRepo.execute(
      { commandId: 'upd3', command: 'update', payload: { version: '1.0.0' } },
      mockAck
    );
    expect(mockAck).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('spawns update.ps1 detached and exits on success', async () => {
    const fakeBuffer = Buffer.from('fake zip');
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: jest.fn().mockResolvedValue(fakeBuffer.buffer),
    });
    (fs.writeFileSync as jest.Mock).mockImplementation(() => {});

    const executorWithRepo = new CommandExecutor(
      { ...mockConfig, update: { githubRepo: 'owner/HopoFiscalBridge' } },
      mockExit
    );
    await executorWithRepo.execute(
      { commandId: 'upd4', command: 'update', payload: { version: '1.0.0' } },
      mockAck
    );

    expect(mockSpawn).toHaveBeenCalledWith(
      'powershell.exe',
      expect.arrayContaining(['-ExecutionPolicy', 'Bypass', '-File']),
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    );
    expect(mockAck).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: expect.stringContaining('Update initiated') })
    );
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it('exits even if ACK throws after successful spawn', async () => {
    const fakeBuffer = Buffer.from('fake zip');
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: jest.fn().mockResolvedValue(fakeBuffer.buffer),
    });
    (fs.writeFileSync as jest.Mock).mockImplementation(() => {});
    mockAck.mockRejectedValue(new Error('network'));

    const executorWithRepo = new CommandExecutor(
      { ...mockConfig, update: { githubRepo: 'owner/HopoFiscalBridge' } },
      mockExit
    );
    await executorWithRepo.execute(
      { commandId: 'upd5', command: 'update', payload: { version: '1.0.0' } },
      mockAck
    );
    expect(mockExit).toHaveBeenCalledWith(0);
  });
});
```

- [ ] **Step 2: Also update mockConfig to include the update field**

In the existing `mockConfig` at the top of the test file, add:

```typescript
  update: {
    githubRepo: '',
  },
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm test -- --testPathPattern=commandExecutor
```

Expected: FAIL — `update` case not implemented yet.

### Step 2b: Implement handleUpdate

- [ ] **Step 4: Add imports to commandExecutor.service.ts**

At the top of `src/services/commandExecutor.service.ts`, add:

```typescript
import * as os from 'os';
import * as childProcess from 'child_process';
import AdmZip from 'adm-zip';
```

- [ ] **Step 5: Add the update case to the switch in execute()**

In the `switch (cmd.command)` block, add before `default`:

```typescript
      case 'update':
        await this.handleUpdate(cmd, ack);
        break;
```

- [ ] **Step 6: Add handleUpdate method to the class**

After the `handleSetConfig` method, add:

```typescript
  private async handleUpdate(cmd: Command, ack: AckFn): Promise<void> {
    const version = cmd.payload?.version;
    if (!version) {
      await ack({ commandId: cmd.commandId, success: false, message: 'version is required in payload' });
      return;
    }

    const githubRepo = this.cfg.update?.githubRepo;
    if (!githubRepo) {
      await ack({
        commandId: cmd.commandId,
        success: false,
        message: 'UPDATE_GITHUB_REPO is not configured on this station',
      });
      return;
    }

    const url = `https://github.com/${githubRepo}/releases/download/v${version}/HopoFiscalBridge-v${version}.zip`;
    const timestamp = Date.now();
    const zipPath = path.join(os.tmpdir(), `hopo-update-${timestamp}.zip`);
    const extractDir = path.join(os.tmpdir(), `hopo-update-${timestamp}`);

    try {
      logger.info('Downloading update', { version, url });
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${url}`);
      }
      const buffer = await response.arrayBuffer();
      fs.writeFileSync(zipPath, Buffer.from(buffer));

      const zip = new AdmZip(zipPath);
      zip.extractAllTo(extractDir, true);
    } catch (err) {
      logger.error('Update download/extract failed', { error: (err as Error).message });
      await ack({ commandId: cmd.commandId, success: false, message: `Update failed: ${(err as Error).message}` });
      return;
    }

    // Resolve install root: dist/services/ → ../../
    const installDir = path.resolve(__dirname, '..', '..');
    const updateScript = path.join(installDir, 'install', 'update.ps1');

    const child = childProcess.spawn(
      'powershell.exe',
      ['-ExecutionPolicy', 'Bypass', '-File', updateScript, extractDir, installDir],
      { detached: true, stdio: 'ignore' }
    );
    child.unref();

    logger.info('Update script spawned, exiting', { version, installDir });

    try {
      await ack({ commandId: cmd.commandId, success: true, message: 'Update initiated, service restarting...' });
    } catch (err) {
      logger.warn('ACK failed before update exit (best-effort)', { error: (err as Error).message });
    }
    this.exitFn(0);
  }
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=commandExecutor
```

Expected: all tests pass including the new `update` describe block.

- [ ] **Step 8: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/services/commandExecutor.service.ts src/services/__tests__/commandExecutor.service.test.ts
git commit -m "feat: add update command to CommandExecutor with detached spawn"
```

---

## Task 3: install/update.ps1

**Files:**
- Create: `install/update.ps1`

This script is spawned detached by `handleUpdate`. It replaces files after the service stops.

- [ ] **Step 1: Create install/update.ps1**

```powershell
param(
    [Parameter(Mandatory=$true)] [string]$TempDir,
    [Parameter(Mandatory=$true)] [string]$InstallDir
)

$logDir = Join-Path $InstallDir "logs"
$logFile = Join-Path $logDir "update.log"

function Write-Log {
    param([string]$msg)
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Write-Host $line
    if (!(Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
    Add-Content -Path $logFile -Value $line
}

Write-Log "=== Update started. TempDir=$TempDir InstallDir=$InstallDir ==="

# 1. Stop the service immediately
Write-Log "Stopping HopoFiscalBridge service..."
& nssm stop HopoFiscalBridge 2>&1 | Out-Null

# 2. Wait for service to reach Stopped state (max 15s)
$timeout = 15
$elapsed = 0
while ($elapsed -lt $timeout) {
    $status = (Get-Service -Name HopoFiscalBridge -ErrorAction SilentlyContinue).Status
    if ($status -eq 'Stopped') { break }
    Start-Sleep -Seconds 1
    $elapsed++
}
if ($elapsed -ge $timeout) {
    Write-Log "WARNING: Service did not stop within ${timeout}s. Forcing stop."
    & nssm stop HopoFiscalBridge confirm 2>&1 | Out-Null
}
Write-Log "Service stopped."

# 3. Replace dist\ and node_modules\
try {
    Write-Log "Copying dist\..."
    Copy-Item -Path "$TempDir\dist" -Destination "$InstallDir\dist" -Recurse -Force
    Write-Log "Copying node_modules\..."
    Copy-Item -Path "$TempDir\node_modules" -Destination "$InstallDir\node_modules" -Recurse -Force
    Write-Log "Copying package.json..."
    Copy-Item -Path "$TempDir\package.json" -Destination "$InstallDir\package.json" -Force
    Write-Log "Files replaced successfully."
} catch {
    Write-Log "ERROR during file copy: $_"
}

# 4. Start the service
Write-Log "Starting HopoFiscalBridge service..."
& nssm start HopoFiscalBridge 2>&1 | Out-Null
Write-Log "Service start issued."

# 5. Cleanup temp dir
try {
    Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
    $zipPath = "$TempDir.zip"
    Remove-Item -Path $zipPath -Force -ErrorAction SilentlyContinue
    Write-Log "Temp files cleaned up."
} catch {
    Write-Log "WARNING: cleanup failed: $_"
}

Write-Log "=== Update complete ==="
```

- [ ] **Step 2: Commit**

```bash
git add install/update.ps1
git commit -m "feat: add update.ps1 for detached file replacement during auto-update"
```

---

## Task 4: Replace Installer Scripts

**Files:**
- Create: `install/install.ps1`
- Create: `install/uninstall.ps1`
- Delete: `install/install.bat`, `install/setup.js`, `install/uninstall.bat`, `install/uninstall.js`

> Note: `install/nssm.exe` must be downloaded manually from https://nssm.cc/download and placed at `install/nssm.exe` before creating a release. It is not committed to git (add to `.gitignore`).

- [ ] **Step 1: Create install/install.ps1**

```powershell
#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"
$InstallDir = Split-Path -Parent $PSScriptRoot

Write-Host "==================================="
Write-Host " HopoFiscalBridge Installer"
Write-Host "==================================="
Write-Host ""

# 1. Check Node.js
try {
    $nodeVersion = node --version 2>&1
    if ($LASTEXITCODE -ne 0) { throw "not found" }
    $major = [int]($nodeVersion -replace 'v(\d+)\..*','$1')
    if ($major -lt 18) {
        Write-Host "ERROR: Node.js v18+ required. Found: $nodeVersion"
        exit 1
    }
    Write-Host "Node.js found: $nodeVersion"
} catch {
    Write-Host "ERROR: Node.js is not installed. Install from https://nodejs.org (v18+)"
    exit 1
}

# 2. If service already exists, remove it cleanly
$existing = Get-Service -Name HopoFiscalBridge -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Existing service found. Removing..."
    & "$PSScriptRoot\nssm.exe" stop HopoFiscalBridge 2>&1 | Out-Null
    & "$PSScriptRoot\nssm.exe" remove HopoFiscalBridge confirm 2>&1 | Out-Null
    Write-Host "Existing service removed."
}

# 3. Generate .env (only if it doesn't exist yet)
Write-Host "Generating configuration..."
Push-Location $InstallDir
node install\generate-env.js
Pop-Location

# 4. Register service via NSSM
$nssmExe = "$PSScriptRoot\nssm.exe"
$nodeExe = (Get-Command node).Source
$appScript = Join-Path $InstallDir "dist\app.js"

Write-Host "Registering Windows service..."
& $nssmExe install HopoFiscalBridge $nodeExe $appScript
& $nssmExe set HopoFiscalBridge AppDirectory $InstallDir
& $nssmExe set HopoFiscalBridge AppEnvironmentExtra "NODE_ENV=production"
& $nssmExe set HopoFiscalBridge Start SERVICE_AUTO_START

# 5. Start the service
Write-Host "Starting service..."
& $nssmExe start HopoFiscalBridge

Write-Host ""
Write-Host "==================================="
Write-Host " Installation complete!"
Write-Host " Verify: sc query HopoFiscalBridge"
Write-Host "==================================="
```

- [ ] **Step 2: Create install/uninstall.ps1**

```powershell
#Requires -RunAsAdministrator

$nssmExe = "$PSScriptRoot\nssm.exe"

Write-Host "Stopping HopoFiscalBridge service..."
& $nssmExe stop HopoFiscalBridge 2>&1 | Out-Null

Write-Host "Removing HopoFiscalBridge service..."
& $nssmExe remove HopoFiscalBridge confirm

Write-Host "Service removed."
Write-Host ""
$confirm = Read-Host "Delete installation directory? (y/N)"
if ($confirm -eq 'y' -or $confirm -eq 'Y') {
    $InstallDir = Split-Path -Parent $PSScriptRoot
    Remove-Item -Path $InstallDir -Recurse -Force
    Write-Host "Installation directory deleted."
}
```

- [ ] **Step 3: Add nssm.exe to .gitignore**

Open `.gitignore` (create it if it doesn't exist) and add:

```
install/nssm.exe
```

- [ ] **Step 4: Delete the old installer files**

```bash
git rm install/install.bat install/setup.js install/uninstall.bat install/uninstall.js
```

- [ ] **Step 5: Commit**

```bash
git add install/install.ps1 install/uninstall.ps1 .gitignore
git commit -m "feat: replace node-windows installer with PowerShell + NSSM"
```

---

## Task 5: Release Pipeline Script

**Files:**
- Create: `scripts/create-release.js`
- Modify: `package.json`

This script runs on the **developer's machine** (Mac/Linux/Windows). It builds the ZIP and creates the GitHub Release.

Prerequisites: `gh` CLI installed and authenticated (`gh auth login`).

- [ ] **Step 1: Create scripts/ directory and create-release.js**

```javascript
#!/usr/bin/env node
// scripts/create-release.js
// Usage: node scripts/create-release.js --version 1.2.0

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const args = process.argv.slice(2);
const versionIdx = args.indexOf('--version');
if (versionIdx === -1 || !args[versionIdx + 1]) {
  console.error('Usage: node scripts/create-release.js --version <version>');
  process.exit(1);
}
const version = args[versionIdx + 1];
const root = path.resolve(__dirname, '..');
const tag = `v${version}`;
const zipName = `HopoFiscalBridge-${tag}.zip`;
const zipNameLatest = `HopoFiscalBridge-latest.zip`;
const zipPath = path.join(root, zipName);
const zipPathLatest = path.join(root, zipNameLatest);

console.log(`Building HopoFiscalBridge ${tag}...`);

// 1. Install & build
execSync('npm install', { cwd: root, stdio: 'inherit' });
execSync('npm run build', { cwd: root, stdio: 'inherit' });

// 2. Verify nssm.exe exists
const nssmPath = path.join(root, 'install', 'nssm.exe');
if (!fs.existsSync(nssmPath)) {
  console.error('ERROR: install/nssm.exe not found.');
  console.error('Download from https://nssm.cc/download and place at install/nssm.exe');
  process.exit(1);
}

// 3. Create ZIP
console.log(`Creating ${zipName}...`);
const zip = new AdmZip();

const addDir = (fsPath, zipPath) => {
  if (!fs.existsSync(fsPath)) return;
  zip.addLocalFolder(fsPath, zipPath);
};

addDir(path.join(root, 'dist'), 'dist');
addDir(path.join(root, 'node_modules'), 'node_modules');
zip.addLocalFile(path.join(root, 'package.json'), '');
zip.addLocalFile(path.join(root, '.env.example'), '');
zip.addLocalFile(nssmPath, 'install');
zip.addLocalFile(path.join(root, 'install', 'install.ps1'), 'install');
zip.addLocalFile(path.join(root, 'install', 'uninstall.ps1'), 'install');
zip.addLocalFile(path.join(root, 'install', 'update.ps1'), 'install');
zip.addLocalFile(path.join(root, 'install', 'generate-env.js'), 'install');

zip.writeZip(zipPath);
// Also write a "latest" copy for stable download URL (developer convenience only)
fs.copyFileSync(zipPath, zipPathLatest);
console.log(`Created: ${zipName} + ${zipNameLatest}`);

// 4. Create GitHub Release — upload both versioned and latest ZIPs
console.log(`Creating GitHub Release ${tag}...`);
execSync(
  `gh release create ${tag} "${zipPath}" "${zipPathLatest}" --title "${tag}" --notes "HopoFiscalBridge ${tag}"`,
  { cwd: root, stdio: 'inherit' }
);

// 5. Cleanup local ZIPs
fs.unlinkSync(zipPath);
fs.unlinkSync(zipPathLatest);

console.log(`\nRelease ${tag} published successfully.`);
console.log(`Download URL: https://github.com/{owner}/HopoFiscalBridge/releases/download/${tag}/${zipName}`);
```

- [ ] **Step 2: Add release script to package.json**

In `package.json`, in the `"scripts"` block, add:

```json
"release": "node scripts/create-release.js"
```

And remove the PM2 scripts (no longer needed):
```json
// Remove: pm2:start, pm2:stop, pm2:restart, pm2:logs
```

- [ ] **Step 3: Verify the script syntax is valid**

```bash
node --check scripts/create-release.js
```

Expected: no output, exit code 0 (syntax check only — does not run the script).

- [ ] **Step 4: Commit**

```bash
git add scripts/create-release.js package.json
git commit -m "feat: add release pipeline script for GitHub Releases distribution"
```

---

## Task 6: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite README**

Replace the entire "🚀 Instalare" section with the following content (keep everything else — API docs, ECR format, config table, troubleshooting, Laravel integration):

```markdown
## 🚀 Instalare pe stația clientului (Windows Service)

### Cerințe

- Windows 10 / 11
- [Node.js v18 sau mai recent](https://nodejs.org/) instalat
- Driverul ECR Bridge instalat și folderele `C:/ECRBridge/Bon/`, `C:/ECRBridge/BonOK/`, `C:/ECRBridge/BonErr/` create

### Pași de instalare

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

### Dezinstalare

```powershell
powershell.exe -ExecutionPolicy Bypass -File install\uninstall.ps1
```

---

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

### Auto-update pe stații existente

Trimite comanda `update` de la cloud cu payload:

```json
{ "version": "1.2.0" }
```

Stația descarcă ZIP-ul, înlocuiește fișierele și repornește serviciul automat. `.env` (configurația clientului) nu este suprascris.
```

- [ ] **Step 2: Remove PM2 section from README**

Delete the "### Rulare cu PM2" subsection entirely from README.

- [ ] **Step 3: Verify README renders correctly**

```bash
node -e "const fs = require('fs'); const c = fs.readFileSync('README.md','utf-8'); console.log(c.includes('install.ps1') && !c.includes('pm2:start') ? 'OK' : 'FAIL')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: update README for PowerShell installer and release pipeline"
```

---

## Task 7: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run TypeScript build**

```bash
npm run build
```

Expected: no TypeScript errors, `dist/` generated.

- [ ] **Step 3: Verify old files are gone**

```bash
ls install/
```

Expected: `generate-env.js`, `install.ps1`, `uninstall.ps1`, `update.ps1` — no `.bat` or `.js` setup/uninstall files.

- [ ] **Step 4: Final commit if anything remains unstaged**

```bash
git status
```

If clean: done. If not, stage and commit remaining changes.
