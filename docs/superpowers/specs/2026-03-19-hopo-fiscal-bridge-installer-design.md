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
4. Also create `HopoFiscalBridge-latest.zip` (same content, stable filename for auto-update)
5. `gh release create v{version} HopoFiscalBridge-v{version}.zip HopoFiscalBridge-latest.zip`

**Stable download URL used by auto-update:**
```
https://github.com/{owner}/HopoFiscalBridge/releases/latest/download/HopoFiscalBridge-latest.zip
```

---

## Component 2: PowerShell Installer

### install.ps1

Installation directory: `C:\HopoFiscalBridge\` (or wherever the ZIP was extracted)

Steps:
1. Check Node.js ≥ v18 is installed; abort with message if not
2. Run `node install\generate-env.js` → creates `.env` with unique UUID `CLIENT_ID`
3. Register service via NSSM:
   ```
   nssm install HopoFiscalBridge node "C:\HopoFiscalBridge\dist\app.js"
   nssm set HopoFiscalBridge AppDirectory "C:\HopoFiscalBridge"
   nssm set HopoFiscalBridge AppEnvironmentExtra NODE_ENV=production
   nssm set HopoFiscalBridge Start SERVICE_AUTO_START
   nssm start HopoFiscalBridge
   ```
4. Print success message with verification command

Must be run as Administrator (NSSM requires elevated privileges to register services).

### uninstall.ps1

Steps:
1. `nssm stop HopoFiscalBridge`
2. `nssm remove HopoFiscalBridge confirm`
3. Optional: prompt to delete installation directory

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

**Payload:** `{ version?: string }` (optional, defaults to "latest")

1. Determine download URL:
   - If version specified: `releases/download/v{version}/HopoFiscalBridge-v{version}.zip`
   - Otherwise: `releases/latest/download/HopoFiscalBridge-latest.zip`
2. Download ZIP to `C:\temp\hopo-update-{timestamp}.zip`
3. Extract ZIP to `C:\temp\hopo-update-{timestamp}\`
4. Resolve install directory from `process.cwd()`
5. Spawn `update.ps1` detached with args: `[tempDir, installDir]`
6. ACK `{ success: true, message: "Update initiated, service restarting..." }`
7. `process.exit(0)`

**Why detached spawn?** The service cannot replace its own files while running. The update script runs independently after the service exits.

### update.ps1

Parameters: `$TempDir`, `$InstallDir`

Steps:
1. Wait for `HopoFiscalBridge` service to reach `Stopped` state (poll every 1s, max 15s)
2. `nssm stop HopoFiscalBridge` (safety stop in case still running)
3. Copy `$TempDir\dist\` → `$InstallDir\dist\` (overwrite)
4. Copy `$TempDir\node_modules\` → `$InstallDir\node_modules\` (overwrite)
5. Copy `$TempDir\package.json` → `$InstallDir\package.json`
6. `nssm start HopoFiscalBridge`
7. Delete `$TempDir` (cleanup)
8. Log result to `$InstallDir\logs\update.log`

**Note:** `.env` is never overwritten during update — client configuration is preserved.

---

## Component 4: README Updates

The README for HopoFiscalBridge will document:
1. Installation section updated to describe PowerShell installer (replaces old `install.bat` section)
2. New "Releasing a new version" section for the developer
3. New "Auto-update" section explaining the `update` cloud command
4. Removal of PM2 references (Windows Service is the only supported production mode)

---

## Repository Migration

- Source: `hopo-fiscal-version` branch of `BongoFiscalBridge`
- Target: new repository `HopoFiscalBridge`
- The `BongoFiscalBridge` main branch is **not affected** — it remains as-is for its dedicated client

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Node.js not installed | installer aborts with clear message |
| Service already exists at install | installer stops existing service, reinstalls |
| Download fails during update | ACK with failure, no files changed |
| Update script times out waiting for service stop | Force stop, proceed with update |
| update.ps1 copy fails | Log error to update.log, attempt service restart anyway |

---

## Out of Scope

- Automatic rollback on failed update (future consideration)
- Delta updates (only full ZIP replacement)
- Windows installer wizard (not needed for remote installation)
- Bundling Node.js runtime (Node.js assumed present on all stations)
