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
  "printCount": 42,
  "zReportCount": 1,
  "errorCount": 3
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

**Log buffer rules:**
- Maximum 500 entries in memory. When full, oldest entries are dropped (drop-oldest policy).
- Buffer is flushed (cleared) after each successful POST to cloud.
- If the POST fails, entries are retained and retried on the next batch interval.
- Integration with Winston: a custom Winston transport (`AgentTransport`) pushes each log entry into the buffer. This means all existing `logger.info/warn/error` calls are automatically captured without changes at call sites.

**Command poll** — GET `/bridges/commands/:clientId` every 10s.

The cloud returns `204 No Content` when there is no pending command. The agent skips execution on `204`. Any `2xx` response with a body is treated as a command:
```json
{ "commandId": "abc123", "command": "restart", "payload": null }
// or
{ "commandId": "abc123", "command": "set_config", "payload": { "BRIDGE_MODE": "test" } }
```

After executing a command, the bridge ACKs with POST `/bridges/commands/:clientId/ack`:
```json
{ "commandId": "abc123", "success": true, "message": "Restarting..." }
```

**Ordering for `restart` and `set_config`:** The ACK request is sent and awaited with a 3s timeout. If the ACK succeeds within 3s, the process exits cleanly. If it fails or times out, the process exits anyway (best-effort ACK — restart must not be blocked by network issues). The ACK call bypasses the normal exponential backoff mechanism and is always attempted immediately, regardless of prior failure state.

**Resilience:**
- All HTTP calls have a 5s timeout.
- Failed calls are silently swallowed and logged locally — the core printing loop is never blocked.
- Exponential backoff on repeated failures: initial delay 5s, multiplier 2x, max delay 5 min (300s). Backoff applies per-endpoint independently. Backoff resets to 5s after a successful call on that endpoint.
- `AGENT_ENABLED=false` disables the agent entirely (useful for development). **Note:** this setting can also be toggled remotely via `set_config` — see the important caveat in the `set_config` section below.

---

### `src/services/commandExecutor.service.ts`

Executes commands received from the cloud.

| Command | Action |
|---------|--------|
| `restart` | Sends ACK, awaits response, then calls `process.exit(0)` — Windows Service wrapper auto-restarts |
| `set_config` | Validates keys and values, writes to `.env`, sends ACK, awaits response, then calls `process.exit(0)` |

**Whitelist of remotely-configurable keys and their allowed values:**

| Key | Allowed values |
|-----|---------------|
| `BRIDGE_MODE` | `"live"` or `"test"` only |
| `RESPONSE_TIMEOUT` | Positive integer (ms), min 5000, max 60000 — same bounds enforced by `config.ts` at startup |
| `LOG_LEVEL` | `"info"`, `"warn"`, or `"error"` only |
| `HEARTBEAT_INTERVAL` | Positive integer (ms), min 5000 |
| `LOG_BATCH_INTERVAL` | Positive integer (ms), min 10000 |
| `COMMAND_POLL_INTERVAL` | Positive integer (ms), min 5000 |

**`AGENT_ENABLED` is intentionally excluded from the remote whitelist.** Allowing the cloud to set `AGENT_ENABLED=false` remotely would permanently sever the communication channel with no way to re-enable it without local access — defeating the purpose of remote control. Disabling the agent requires local `.env` edits only.

Sensitive keys (`CLOUD_API_KEY`, `CLIENT_ID`, all ECR paths) cannot be changed remotely. Any request containing a non-whitelisted key is rejected entirely, and an ACK with `success: false` is returned.

---

### `src/services/metrics.service.ts`

Simple in-memory counters read by AgentService for heartbeats:

```typescript
export const metrics = {
  printCount: 0,        // successful receipt prints
  zReportCount: 0,      // successful Z reports
  errorCount: 0,        // any failed operation (print or Z-report)
  lastPrintAt: null as Date | null,
};
```

`PrintController` increments `printCount` on success and `errorCount` on failure.
`Z-ReportController` increments `zReportCount` on success and `errorCount` on failure.

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

**ECR directory initialization at startup:**

The existing `app.ts` exits with code `1` if required ECR directories are missing. Under the Windows Service restart loop, a missing directory at boot would cause rapid repeated crashes. To prevent this, the startup sequence is changed:

- Directory init is retried up to 5 times with a 3s delay between attempts before giving up and exiting.
- This tolerates transient delays (e.g., a mapped network drive not yet mounted at boot).
- If all retries fail, the service exits and Windows restarts it after 5s as normal — the restart loop is acceptable because it will self-heal once the drive is available.

---

## Error Handling & Resilience Summary

| Scenario | Behavior |
|----------|----------|
| Cloud unreachable | Agent retries with exponential backoff (5s→10s→…→5min), printing continues normally |
| Command poll returns 204 | Agent skips execution, polls again after interval |
| `set_config` with invalid/non-whitelisted key | Rejected, ACK sent with `success: false`, no restart |
| `set_config` with invalid value | Rejected, ACK sent with `success: false`, no restart |
| ACK fails/times out before restart | Restart proceeds anyway after 3s (best-effort ACK) |
| Log buffer full (500 entries) | Oldest entries dropped, new ones accepted |
| Service crashes | Windows Service restarts it automatically after 5s |
| Machine reboots | Windows Service starts automatically on boot |
| ECR dirs missing at boot | Retried up to 5x with 3s delay before exit |
| `.env` missing at install | `generate-env.js` creates it with safe defaults |

---

## Security

- All requests to cloud include `Authorization: Bearer <CLOUD_API_KEY>` header
- `CLIENT_ID` is read-only after generation (not on remote whitelist)
- Whitelist enforced on `set_config` — covers both key names AND value validation
- `AGENT_ENABLED` cannot be disabled remotely (prevents self-silencing)
- HTTPS only for cloud communication
- Sensitive keys (ECR paths, API key, CLIENT_ID) not remotely configurable

---

## File Structure Changes

```
BongoFiscalBridge/
  src/
    services/
      agent.service.ts            ← NEW
      commandExecutor.service.ts  ← NEW
      metrics.service.ts          ← NEW
      agentTransport.ts           ← NEW (custom Winston transport)
      ecrBridge.service.ts        ← existing (no changes needed)
    controllers/
      print.controller.ts         ← existing (add metrics increment)
      z-report.controller.ts      ← existing (add metrics increment)
    app.ts                        ← existing (add AgentService start + dir retry logic)
    config/
      config.ts                   ← existing (add new env fields)
  install/
    install.bat                   ← NEW
    uninstall.bat                 ← NEW
    setup.js                      ← NEW
    generate-env.js               ← NEW
  .env.example                    ← update with new fields
```

---

## Implementation Order

1. `metrics.service.ts` — simple counters
2. `config.ts` updates — new env fields with validation
3. `agentTransport.ts` — custom Winston transport that pushes to log buffer
4. `agent.service.ts` — heartbeat + log batch (with buffer cap) + command poll (204 handling)
5. `commandExecutor.service.ts` — restart + set_config (ACK-before-exit, value validation)
6. Update controllers to increment metrics
7. Update `app.ts` — start AgentService, add dir init retry logic
8. `install/` scripts — Windows service wrapper

---

## Dependencies to Add

- `node-windows` — Windows service registration
- `uuid` — CLIENT_ID generation at install time
- Native `fetch` (Node 18+) — HTTP calls to cloud (already available, no new dependency)
