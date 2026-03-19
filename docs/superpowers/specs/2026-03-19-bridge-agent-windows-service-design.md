# BongoFiscalBridge — Agent & Windows Service Design

**Date:** 2026-03-19
**Branch:** hopo-fiscal-version
**Scope:** Add remote monitoring/control agent and Windows service deployment to BongoFiscalBridge

---

## Problem Statement

Currently, each client installation requires manual setup via AnyDesk (clone repo, run `npm run dev`). When something goes wrong, the developer must connect via AnyDesk to diagnose and fix the issue. Operators are non-technical and cannot restart or manage the service themselves. There is no visibility into which clients are online or having issues.

---

## Goals

1. Bridge runs automatically as a Windows service (no operator intervention needed)
2. Bridge "phones home" to the cloud app with status, logs, and metrics
3. Cloud can send commands to the bridge (restart, config change) without AnyDesk
4. Failure of the agent/phone-home mechanism does NOT affect core printing functionality

---

## Out of Scope

- Super Admin Dashboard UI (to be built in the separate cloud application)
- Cloud API endpoints for receiving heartbeats/logs/commands (separate project)

---

## Architecture

```
┌─────────────────────────────────────┐
│         Cloud (aplicația ta)        │
│  Admin API: /bridges/*              │
└──────────────┬──────────────────────┘
               │ HTTPS (outbound from bridge)
┌──────────────┴──────────────────────┐
│        BongoFiscalBridge            │
│  (Windows Service on client station)│
│                                     │
│  ┌─────────────────────────────┐    │
│  │  Core (existing)            │    │
│  │  Express API, ECRBridge,    │    │
│  │  Print, Z-Report            │    │
│  └─────────────────────────────┘    │
│  ┌─────────────────────────────┐    │
│  │  AgentService (new)         │    │
│  │  - Heartbeat (30s)          │    │
│  │  - Log batch (60s)          │    │
│  │  - Command poll (10s)       │    │
│  └─────────────────────────────┘    │
│  ┌─────────────────────────────┐    │
│  │  CommandExecutor (new)      │    │
│  │  - restart                  │    │
│  │  - set_config               │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

---

## New Configuration (`.env`)

```env
# Existing fields...

# Agent / phone-home
CLOUD_API_URL=https://your-cloud-app.com/api
CLOUD_API_KEY=secret-key-shared-with-cloud
CLIENT_ID=uuid-generated-at-install-time
AGENT_ENABLED=true

# Intervals (ms)
HEARTBEAT_INTERVAL=30000
LOG_BATCH_INTERVAL=60000
COMMAND_POLL_INTERVAL=10000
```

`CLIENT_ID` is generated once at install time (UUID v4) and never changes — it uniquely identifies this bridge instance in the cloud dashboard.

---

## New Modules

### `src/services/agent.service.ts`

Single service responsible for all phone-home communication. Starts alongside the Express server and runs independently.

**Heartbeat** — POST `/bridges/heartbeat` every 30s:
```json
{
  "clientId": "uuid",
  "status": "online",
  "version": "1.2.0",
  "uptime": 3600,
  "bridgeMode": "live",
  "lastPrintAt": "2026-03-19T10:00:00Z",
  "printCountSinceStart": 42,
  "errorCountSinceStart": 1
}
```

**Log batch** — POST `/bridges/logs` every 60s:
```json
{
  "clientId": "uuid",
  "logs": [
    { "level": "info", "message": "Print success: bon_20260319.txt", "timestamp": "..." },
    { "level": "error", "message": "ECR timeout after 15000ms", "timestamp": "..." }
  ]
}
```
Logs are buffered in memory and flushed. Local file logs (Winston) remain as-is and serve as backup.

**Command poll** — GET `/bridges/commands/:clientId` every 10s:
```json
{ "commandId": "abc123", "command": "restart", "payload": null }
// or
{ "commandId": "abc123", "command": "set_config", "payload": { "BRIDGE_MODE": "test" } }
// or
{ "commandId": null, "command": null, "payload": null }
```
After executing a command, the bridge ACKs with POST `/bridges/commands/:clientId/ack`:
```json
{ "commandId": "abc123", "success": true, "message": "Restarting..." }
```

**Resilience:**
- All HTTP calls have a 5s timeout
- Failed calls are silently swallowed and logged locally — the core printing loop is never blocked
- Exponential backoff on repeated failures (max 5 min between retries)
- `AGENT_ENABLED=false` disables the agent entirely (useful for development)

---

### `src/services/commandExecutor.service.ts`

Executes commands received from the cloud.

| Command | Action |
|---------|--------|
| `restart` | Calls `process.exit(0)` — Windows Service wrapper auto-restarts the process |
| `set_config` | Writes new values to `.env` file, then restarts |

Only a whitelist of config keys can be changed remotely:
- `BRIDGE_MODE`
- `RESPONSE_TIMEOUT`
- `LOG_LEVEL`
- `AGENT_ENABLED`
- `HEARTBEAT_INTERVAL`
- `LOG_BATCH_INTERVAL`
- `COMMAND_POLL_INTERVAL`

Sensitive keys (`CLOUD_API_KEY`, `CLIENT_ID`, ECR paths) cannot be changed remotely.

---

### `install/` — Windows Service Installer

```
install/
  install.bat          ← double-click to install
  uninstall.bat        ← double-click to uninstall
  setup.js             ← node-windows service registration
  generate-env.js      ← generates .env with new CLIENT_ID if not present
```

**`install.bat` flow:**
1. Checks Node.js is installed (prompts to install if missing)
2. Runs `npm install`
3. Runs `node install/generate-env.js` — creates `.env` with a fresh `CLIENT_ID` UUID if `.env` doesn't exist
4. Runs `node install/setup.js` — registers bridge as Windows Service named "BongoFiscalBridge"
5. Starts the service

**Windows Service behavior:**
- Service name: `BongoFiscalBridge`
- Start type: Automatic (starts on boot)
- Restart on failure: Yes (after 5s delay)
- Runs as: Local System

---

## Metrics Tracked In-Memory

The core service increments simple counters that the AgentService reads for heartbeats:

```typescript
// src/services/metrics.service.ts
export const metrics = {
  printCount: 0,
  errorCount: 0,
  lastPrintAt: null as Date | null,
};
```

PrintController and Z-ReportController increment these after each operation.

---

## Error Handling & Resilience Summary

| Scenario | Behavior |
|----------|----------|
| Cloud unreachable | Agent retries with backoff, printing continues normally |
| Command poll fails | Logged locally, next poll attempted after interval |
| `set_config` with invalid key | Rejected, ACK sent with `success: false` |
| Service crashes | Windows Service restarts it automatically after 5s |
| Machine reboots | Windows Service starts automatically on boot |
| `.env` missing at install | `generate-env.js` creates it with safe defaults |

---

## Security

- All requests to cloud include `Authorization: Bearer <CLOUD_API_KEY>` header
- `CLIENT_ID` is read-only after generation
- Whitelist enforced on `set_config` — no arbitrary env key injection
- HTTPS only for cloud communication

---

## File Structure Changes

```
BongoFiscalBridge/
  src/
    services/
      agent.service.ts        ← NEW
      commandExecutor.service.ts  ← NEW
      metrics.service.ts      ← NEW
      ecrBridge.service.ts    ← existing (minor update: increment metrics)
    controllers/
      print.controller.ts     ← existing (minor update: increment metrics)
      z-report.controller.ts  ← existing (minor update: increment metrics)
    app.ts                    ← existing (minor update: start AgentService)
    config/
      config.ts               ← existing (add new env fields)
  install/
    install.bat               ← NEW
    uninstall.bat             ← NEW
    setup.js                  ← NEW
    generate-env.js           ← NEW
  .env.example                ← update with new fields
```

---

## Implementation Order

1. `metrics.service.ts` — simple counters
2. `config.ts` updates — new env fields
3. `agent.service.ts` — heartbeat + log batch + command poll
4. `commandExecutor.service.ts` — restart + set_config
5. Update controllers to increment metrics
6. Update `app.ts` to start AgentService
7. `install/` scripts — Windows service wrapper

---

## Dependencies to Add

- `node-windows` — Windows service registration
- `uuid` — CLIENT_ID generation at install time
- `axios` or native `fetch` (Node 18+) — HTTP calls to cloud (prefer native fetch, already available)
