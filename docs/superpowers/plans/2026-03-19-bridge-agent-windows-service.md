# Bridge Agent & Windows Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a phone-home agent (heartbeat, logs, command poll) and Windows service installer to BongoFiscalBridge, enabling remote monitoring and control without AnyDesk.

**Architecture:** A new `AgentService` runs independently alongside the Express server, periodically sending heartbeat/logs to the cloud and polling for commands. A `CommandExecutor` handles `restart` and `set_config` commands. An `install/` directory contains scripts that register the bridge as an auto-starting Windows service.

**Tech Stack:** TypeScript 5.3, Node.js 18+ (native fetch), Winston 3.11, node-windows, uuid, Jest + ts-jest (tests)

**Notes on divergence from spec:**
- `agentTransport.ts` lives in `src/utils/` (not `src/services/`) — keeps it with other utilities
- `install/uninstall.js` added (not in spec) — required for `uninstall.bat` to work
- `install/install.bat` includes a `npm run build` step (not in spec) — required since `setup.js` references `dist/app.js`
- `RESPONSE_TIMEOUT` startup validation (5000–60000) added to `config.ts` for consistency with `commandExecutor` whitelist

---

## File Map

| File | Status | Responsibility |
|------|--------|---------------|
| `src/services/metrics.service.ts` | CREATE | In-memory counters for print/zReport/error counts |
| `src/config/config.ts` | MODIFY | Add agent env fields with validation |
| `src/utils/agentTransport.ts` | CREATE | Custom Winston transport + log buffer (max 500) |
| `src/services/agent.service.ts` | CREATE | Heartbeat, log batch, command poll loops |
| `src/services/commandExecutor.service.ts` | CREATE | Execute restart and set_config commands |
| `src/controllers/print.controller.ts` | MODIFY | Increment metrics on success/failure |
| `src/controllers/z-report.controller.ts` | MODIFY | Increment metrics on success/failure |
| `src/app.ts` | MODIFY | Start AgentService, retry dir init up to 5x |
| `src/utils/logger.ts` | MODIFY | Register AgentTransport |
| `install/generate-env.js` | CREATE | Generate .env with CLIENT_ID if missing |
| `install/setup.js` | CREATE | Register bridge as Windows service via node-windows |
| `install/uninstall.js` | CREATE | Unregister Windows service |
| `install/install.bat` | CREATE | One-click installer for operators |
| `install/uninstall.bat` | CREATE | One-click uninstaller |
| `.env.example` | MODIFY | Add new agent fields |

---

## Task 1: Add Jest test framework

**Files:**
- Modify: `package.json`
- Create: `jest.config.js`

- [ ] **Step 1: Install Jest + ts-jest**

```bash
npm install --save-dev jest ts-jest @types/jest
```

- [ ] **Step 2: Create `jest.config.js`**

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/app.ts'],
};
```

- [ ] **Step 3: Add test script to `package.json`**

In `package.json`, add to `"scripts"`:
```json
"test": "jest",
"test:watch": "jest --watch"
```

- [ ] **Step 4: Verify existing test still passes**

```bash
npm test
```
Expected: `src/utils/__tests__/errorParser.test.ts` passes.

- [ ] **Step 5: Commit**

```bash
git add package.json jest.config.js
git commit -m "chore: add Jest + ts-jest test framework"
```

---

## Task 2: metrics.service.ts

**Files:**
- Create: `src/services/metrics.service.ts`
- Create: `src/services/__tests__/metrics.service.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/services/__tests__/metrics.service.test.ts`:

```typescript
import { metrics, incrementPrintCount, incrementZReportCount, incrementErrorCount } from '../metrics.service';

describe('metrics.service', () => {
  beforeEach(() => {
    metrics.printCount = 0;
    metrics.zReportCount = 0;
    metrics.errorCount = 0;
    metrics.lastPrintAt = null;
  });

  it('incrementPrintCount increments printCount and sets lastPrintAt', () => {
    const before = new Date();
    incrementPrintCount();
    expect(metrics.printCount).toBe(1);
    expect(metrics.lastPrintAt).not.toBeNull();
    expect(metrics.lastPrintAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('incrementZReportCount increments zReportCount', () => {
    incrementZReportCount();
    expect(metrics.zReportCount).toBe(1);
  });

  it('incrementErrorCount increments errorCount', () => {
    incrementErrorCount();
    expect(metrics.errorCount).toBe(1);
  });

  it('counters accumulate', () => {
    incrementPrintCount();
    incrementPrintCount();
    incrementErrorCount();
    expect(metrics.printCount).toBe(2);
    expect(metrics.errorCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npm test -- --testPathPattern=metrics.service
```
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement `src/services/metrics.service.ts`**

```typescript
export const metrics = {
  printCount: 0,
  zReportCount: 0,
  errorCount: 0,
  lastPrintAt: null as Date | null,
};

export function incrementPrintCount(): void {
  metrics.printCount++;
  metrics.lastPrintAt = new Date();
}

export function incrementZReportCount(): void {
  metrics.zReportCount++;
}

export function incrementErrorCount(): void {
  metrics.errorCount++;
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npm test -- --testPathPattern=metrics.service
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/metrics.service.ts src/services/__tests__/metrics.service.test.ts
git commit -m "feat: add metrics service with print/zReport/error counters"
```

---

## Task 3: Update config.ts with agent fields

**Files:**
- Modify: `src/config/config.ts`
- Modify: `.env.example`

- [ ] **Step 1: Update `src/config/config.ts`**

After `bridgeMode: (process.env.BRIDGE_MODE || 'live').toLowerCase(),`, add a new `agent` field:

```typescript
// Agent / phone-home configuration
agent: {
  cloudApiUrl: process.env.CLOUD_API_URL || '',
  cloudApiKey: process.env.CLOUD_API_KEY || '',
  clientId: process.env.CLIENT_ID || '',
  enabled: process.env.AGENT_ENABLED !== 'false',
  heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL || '30000', 10),
  logBatchInterval: parseInt(process.env.LOG_BATCH_INTERVAL || '60000', 10),
  commandPollInterval: parseInt(process.env.COMMAND_POLL_INTERVAL || '10000', 10),
},
```

After the existing `bridgeMode` validation block (after line `if (config.bridgeMode !== 'live' && config.bridgeMode !== 'test')`), add:

```typescript
// Validate RESPONSE_TIMEOUT bounds (must be 5000–60000 ms)
if (config.responseTimeout < 5000 || config.responseTimeout > 60000) {
  throw new Error('RESPONSE_TIMEOUT must be between 5000 and 60000 ms');
}
```

- [ ] **Step 2: Update `.env.example`**

Append at the end of the file:

```env
# Agent / phone-home (optional — bridge works without these)
CLOUD_API_URL=https://your-cloud-app.com/api
CLOUD_API_KEY=your-secret-api-key
CLIENT_ID=auto-generated-at-install
AGENT_ENABLED=true

# Agent intervals (milliseconds)
HEARTBEAT_INTERVAL=30000
LOG_BATCH_INTERVAL=60000
COMMAND_POLL_INTERVAL=10000
```

- [ ] **Step 3: Build to verify no TypeScript errors**

```bash
npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/config/config.ts .env.example
git commit -m "feat: add agent configuration fields to config"
```

---

## Task 4: AgentTransport (custom Winston transport + log buffer)

**Files:**
- Create: `src/utils/agentTransport.ts`
- Create: `src/utils/__tests__/agentTransport.test.ts`

The `AgentTransport` is a Winston transport that pushes log entries into an in-memory `AgentLogBuffer` (max 500 entries, drop-oldest). The buffer exposes `push`, `pushAll`, `drain`, `flush`, and `seed` methods — `seed` is for tests only.

- [ ] **Step 1: Write failing test**

Create `src/utils/__tests__/agentTransport.test.ts`:

```typescript
import { AgentTransport, agentLogBuffer } from '../agentTransport';
import Transport from 'winston-transport';

describe('AgentTransport', () => {
  beforeEach(() => {
    agentLogBuffer.flush();
  });

  it('is a Winston transport', () => {
    const t = new AgentTransport();
    expect(t).toBeInstanceOf(Transport);
  });

  it('adds log entries to the buffer', () => {
    const t = new AgentTransport();
    const callback = jest.fn();
    t.log({ level: 'info', message: 'hello' }, callback);
    const entries = agentLogBuffer.drain();
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('info');
    expect(entries[0].message).toBe('hello');
    expect(callback).toHaveBeenCalled();
  });

  it('drops oldest entries when buffer exceeds 500', () => {
    const t = new AgentTransport();
    for (let i = 0; i < 501; i++) {
      t.log({ level: 'info', message: `msg-${i}` }, () => {});
    }
    const entries = agentLogBuffer.drain();
    expect(entries).toHaveLength(500);
    expect(entries[0].message).toBe('msg-1'); // msg-0 dropped
    expect(entries[499].message).toBe('msg-500');
  });

  it('drain returns entries and empties buffer', () => {
    const t = new AgentTransport();
    t.log({ level: 'warn', message: 'test' }, () => {});
    const first = agentLogBuffer.drain();
    const second = agentLogBuffer.drain();
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it('flush clears buffer without returning entries', () => {
    const t = new AgentTransport();
    t.log({ level: 'error', message: 'oops' }, () => {});
    agentLogBuffer.flush();
    expect(agentLogBuffer.drain()).toHaveLength(0);
  });

  it('pushAll re-buffers entries respecting the 500-entry cap', () => {
    // Fill buffer to 490
    for (let i = 0; i < 490; i++) {
      agentLogBuffer.push({ level: 'info', message: `existing-${i}` });
    }
    // Re-buffer 20 entries — only 10 fit (500 - 490)
    const toRebuffer = Array.from({ length: 20 }, (_, i) => ({
      level: 'info',
      message: `rebuffer-${i}`,
      timestamp: '2026-01-01',
    }));
    agentLogBuffer.pushAll(toRebuffer);
    expect(agentLogBuffer.size).toBe(500);
  });

  it('seed directly sets buffer contents (test helper)', () => {
    agentLogBuffer.seed([{ level: 'info', message: 'seeded', timestamp: '2026-01-01' }]);
    expect(agentLogBuffer.size).toBe(1);
    const entries = agentLogBuffer.drain();
    expect(entries[0].message).toBe('seeded');
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npm test -- --testPathPattern=agentTransport
```
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement `src/utils/agentTransport.ts`**

```typescript
import Transport from 'winston-transport';

export interface LogEntry {
  level: string;
  message: string;
  timestamp?: string;
}

const MAX_BUFFER_SIZE = 500;

class AgentLogBuffer {
  private buffer: LogEntry[] = [];

  push(entry: LogEntry): void {
    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      this.buffer.shift(); // drop oldest
    }
    this.buffer.push(entry);
  }

  /** Re-buffer a list of entries (e.g. after a failed POST). Respects the 500-entry cap. */
  pushAll(entries: LogEntry[]): void {
    for (const e of entries) {
      this.push(e);
    }
  }

  /** Returns all buffered entries and clears the buffer. */
  drain(): LogEntry[] {
    const entries = [...this.buffer];
    this.buffer = [];
    return entries;
  }

  /** Clears the buffer (discard all entries). */
  flush(): void {
    this.buffer = [];
  }

  /** FOR TESTS ONLY: directly replace buffer contents. */
  seed(entries: LogEntry[]): void {
    this.buffer = [...entries];
  }

  get size(): number {
    return this.buffer.length;
  }
}

export const agentLogBuffer = new AgentLogBuffer();

export class AgentTransport extends Transport {
  log(info: any, callback: () => void): void {
    agentLogBuffer.push({
      level: info.level,
      message: info.message,
      timestamp: info.timestamp || new Date().toISOString(),
    });
    callback();
  }
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npm test -- --testPathPattern=agentTransport
```
Expected: PASS

- [ ] **Step 5: Register AgentTransport in `src/utils/logger.ts`**

At the top of `src/utils/logger.ts`, add the import after the existing imports:
```typescript
import { AgentTransport } from './agentTransport';
```

Inside the `winston.createLogger({...})` call, add `new AgentTransport()` to the `transports` array, after the existing two `File` transports:
```typescript
new AgentTransport(),
```

- [ ] **Step 6: Build to verify no TypeScript errors**

```bash
npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/utils/agentTransport.ts src/utils/__tests__/agentTransport.test.ts src/utils/logger.ts
git commit -m "feat: add AgentTransport Winston transport with 500-entry log buffer"
```

---

## Task 5: agent.service.ts

**Files:**
- Create: `src/services/agent.service.ts`
- Create: `src/services/__tests__/agent.service.test.ts`

The `AgentService` runs three independent loops: heartbeat (30s), log batch (60s), command poll (10s). Each has independent exponential backoff. The entire service is a no-op if `AGENT_ENABLED=false` or `CLOUD_API_URL` is empty.

- [ ] **Step 1: Write failing tests**

Create `src/services/__tests__/agent.service.test.ts`:

```typescript
import { AgentService } from '../agent.service';
import { metrics } from '../metrics.service';
import { agentLogBuffer } from '../../utils/agentTransport';

global.fetch = jest.fn();

const mockConfig = {
  agent: {
    cloudApiUrl: 'https://cloud.example.com/api',
    cloudApiKey: 'test-key',
    clientId: 'test-client-id',
    enabled: true,
    heartbeatInterval: 100,
    logBatchInterval: 100,
    commandPollInterval: 100,
  },
  bridgeMode: 'live',
} as any;

describe('AgentService', () => {
  let service: AgentService;

  beforeEach(() => {
    jest.clearAllMocks();
    metrics.printCount = 0;
    metrics.zReportCount = 0;
    metrics.errorCount = 0;
    metrics.lastPrintAt = null;
    agentLogBuffer.flush();
  });

  afterEach(() => {
    service?.stop();
  });

  it('does not start if AGENT_ENABLED is false', () => {
    service = new AgentService({ ...mockConfig, agent: { ...mockConfig.agent, enabled: false } });
    service.start();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not start if cloudApiUrl is empty', () => {
    service = new AgentService({ ...mockConfig, agent: { ...mockConfig.agent, cloudApiUrl: '' } });
    service.start();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sendHeartbeat posts correct payload', async () => {
    (fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });
    service = new AgentService(mockConfig);
    await service.sendHeartbeat();
    expect(fetch).toHaveBeenCalledWith(
      'https://cloud.example.com/api/bridges/heartbeat',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
        body: expect.stringContaining('"clientId":"test-client-id"'),
      })
    );
  });

  it('sendLogBatch posts logs and drains buffer', async () => {
    (fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });
    agentLogBuffer.seed([{ level: 'info', message: 'test', timestamp: '2026-01-01' }]);
    service = new AgentService(mockConfig);
    await service.sendLogBatch();
    expect(fetch).toHaveBeenCalledWith(
      'https://cloud.example.com/api/bridges/logs',
      expect.objectContaining({ method: 'POST' })
    );
    expect(agentLogBuffer.size).toBe(0);
  });

  it('sendLogBatch re-buffers entries on failure', async () => {
    (fetch as jest.Mock).mockRejectedValue(new Error('network'));
    agentLogBuffer.seed([{ level: 'info', message: 'test', timestamp: '2026-01-01' }]);
    service = new AgentService(mockConfig);
    await service.sendLogBatch();
    expect(agentLogBuffer.size).toBe(1); // entries restored
  });

  it('sendLogBatch does nothing when buffer is empty', async () => {
    service = new AgentService(mockConfig);
    await service.sendLogBatch();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('pollCommands skips execution on 204', async () => {
    (fetch as jest.Mock).mockResolvedValue({ ok: true, status: 204 });
    service = new AgentService(mockConfig);
    const executeSpy = jest.spyOn(service as any, 'executeCommand');
    await service.pollCommands();
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('pollCommands calls executeCommand on valid command', async () => {
    const command = { commandId: 'abc', command: 'restart', payload: null };
    (fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200, json: async () => command });
    service = new AgentService(mockConfig);
    const executeSpy = jest.spyOn(service as any, 'executeCommand').mockResolvedValue(undefined);
    await service.pollCommands();
    expect(executeSpy).toHaveBeenCalledWith(command);
  });

  it('failed fetch does not throw (resilience)', async () => {
    (fetch as jest.Mock).mockRejectedValue(new Error('network error'));
    service = new AgentService(mockConfig);
    await expect(service.sendHeartbeat()).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npm test -- --testPathPattern=agent.service
```
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement `src/services/agent.service.ts`**

```typescript
import { config as appConfig } from '../config/config';
import { metrics } from './metrics.service';
import { agentLogBuffer } from '../utils/agentTransport';
import logger from '../utils/logger';

const VERSION = '1.0.0';

interface BackoffState {
  delay: number;
}

function createBackoff(): BackoffState {
  return { delay: 5000 };
}

function advanceBackoff(state: BackoffState): void {
  state.delay = Math.min(state.delay * 2, 300000);
}

function resetBackoff(state: BackoffState): void {
  state.delay = 5000;
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

export class AgentService {
  private timers: ReturnType<typeof setTimeout>[] = [];
  private heartbeatBackoff = createBackoff();
  private logBackoff = createBackoff();
  private pollBackoff = createBackoff();
  private cfg: typeof appConfig;

  constructor(cfg: typeof appConfig) {
    this.cfg = cfg;
  }

  start(): void {
    if (!this.cfg.agent.enabled || !this.cfg.agent.cloudApiUrl) {
      logger.info('AgentService disabled or CLOUD_API_URL not set — skipping start');
      return;
    }
    logger.info('AgentService starting', { clientId: this.cfg.agent.clientId });
    this.scheduleHeartbeat();
    this.scheduleLogBatch();
    this.schedulePoll();
  }

  stop(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  private scheduleHeartbeat(): void {
    const t = setTimeout(async () => {
      await this.sendHeartbeat();
      this.scheduleHeartbeat();
    }, this.cfg.agent.heartbeatInterval);
    this.timers.push(t);
  }

  private scheduleLogBatch(): void {
    const t = setTimeout(async () => {
      await this.sendLogBatch();
      this.scheduleLogBatch();
    }, this.cfg.agent.logBatchInterval);
    this.timers.push(t);
  }

  private schedulePoll(): void {
    const t = setTimeout(async () => {
      await this.pollCommands();
      this.schedulePoll();
    }, this.cfg.agent.commandPollInterval);
    this.timers.push(t);
  }

  async sendHeartbeat(): Promise<void> {
    const payload = {
      clientId: this.cfg.agent.clientId,
      status: 'online',
      version: VERSION,
      uptime: Math.floor(process.uptime()),
      bridgeMode: this.cfg.bridgeMode,
      lastPrintAt: metrics.lastPrintAt?.toISOString() ?? null,
      printCount: metrics.printCount,
      zReportCount: metrics.zReportCount,
      errorCount: metrics.errorCount,
    };

    try {
      await fetchWithTimeout(
        `${this.cfg.agent.cloudApiUrl}/bridges/heartbeat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.cfg.agent.cloudApiKey}`,
          },
          body: JSON.stringify(payload),
        },
        5000
      );
      resetBackoff(this.heartbeatBackoff);
    } catch (err) {
      logger.warn('Heartbeat failed', { error: (err as Error).message });
      advanceBackoff(this.heartbeatBackoff);
    }
  }

  async sendLogBatch(): Promise<void> {
    const logs = agentLogBuffer.drain();
    if (logs.length === 0) return;

    try {
      const res = await fetchWithTimeout(
        `${this.cfg.agent.cloudApiUrl}/bridges/logs`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.cfg.agent.cloudApiKey}`,
          },
          body: JSON.stringify({ clientId: this.cfg.agent.clientId, logs }),
        },
        5000
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      resetBackoff(this.logBackoff);
    } catch (err) {
      logger.warn('Log batch failed — re-buffering', { error: (err as Error).message });
      agentLogBuffer.pushAll(logs); // safe: respects 500-entry cap
      advanceBackoff(this.logBackoff);
    }
  }

  async pollCommands(): Promise<void> {
    try {
      const res = await fetchWithTimeout(
        `${this.cfg.agent.cloudApiUrl}/bridges/commands/${this.cfg.agent.clientId}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${this.cfg.agent.cloudApiKey}` },
        },
        5000
      );

      if (res.status === 204) {
        resetBackoff(this.pollBackoff);
        return;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const command = await res.json();
      if (command?.command) {
        await this.executeCommand(command);
      }
      resetBackoff(this.pollBackoff);
    } catch (err) {
      logger.warn('Command poll failed', { error: (err as Error).message });
      advanceBackoff(this.pollBackoff);
    }
  }

  private async executeCommand(cmd: {
    commandId: string;
    command: string;
    payload: any;
  }): Promise<void> {
    const { CommandExecutor } = await import('./commandExecutor.service');
    const executor = new CommandExecutor(this.cfg);
    await executor.execute(cmd, async (ack) => {
      try {
        await fetchWithTimeout(
          `${this.cfg.agent.cloudApiUrl}/bridges/commands/${this.cfg.agent.clientId}/ack`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.cfg.agent.cloudApiKey}`,
            },
            body: JSON.stringify(ack),
          },
          3000
        );
      } catch (err) {
        logger.warn('ACK failed (best-effort)', { error: (err as Error).message });
      }
    });
  }
}

export const agentService = new AgentService(appConfig);
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npm test -- --testPathPattern=agent.service
```
Expected: PASS

- [ ] **Step 5: Build to verify no TypeScript errors**

```bash
npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/services/agent.service.ts src/services/__tests__/agent.service.test.ts
git commit -m "feat: add AgentService with heartbeat, log batch, and command poll"
```

---

## Task 6: commandExecutor.service.ts

**Files:**
- Create: `src/services/commandExecutor.service.ts`
- Create: `src/services/__tests__/commandExecutor.service.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/services/__tests__/commandExecutor.service.test.ts`:

```typescript
import { CommandExecutor } from '../commandExecutor.service';
import * as fs from 'fs';

jest.mock('fs');

const mockConfig = {
  agent: {
    clientId: 'test-id',
    cloudApiUrl: 'https://cloud.example.com/api',
    cloudApiKey: 'key',
    enabled: true,
    heartbeatInterval: 30000,
    logBatchInterval: 60000,
    commandPollInterval: 10000,
  },
  bridgeMode: 'live',
  responseTimeout: 15000,
  logLevel: 'info',
} as any;

describe('CommandExecutor', () => {
  let mockAck: jest.Mock;
  let mockExit: jest.Mock;
  let executor: CommandExecutor;

  beforeEach(() => {
    mockAck = jest.fn().mockResolvedValue(undefined);
    mockExit = jest.fn();
    executor = new CommandExecutor(mockConfig, mockExit);
  });

  describe('restart', () => {
    it('sends success ACK then exits with 0', async () => {
      await executor.execute({ commandId: 'cmd1', command: 'restart', payload: null }, mockAck);
      expect(mockAck).toHaveBeenCalledWith({
        commandId: 'cmd1',
        success: true,
        message: 'Restarting...',
      });
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('exits even if ACK throws', async () => {
      mockAck.mockRejectedValue(new Error('network'));
      await executor.execute({ commandId: 'cmd1', command: 'restart', payload: null }, mockAck);
      expect(mockExit).toHaveBeenCalledWith(0);
    });
  });

  describe('set_config', () => {
    it('rejects unknown keys', async () => {
      await executor.execute(
        { commandId: 'cmd2', command: 'set_config', payload: { SECRET_KEY: 'x' } },
        mockAck
      );
      expect(mockAck).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
      expect(mockExit).not.toHaveBeenCalled();
    });

    it('rejects invalid BRIDGE_MODE value', async () => {
      await executor.execute(
        { commandId: 'cmd3', command: 'set_config', payload: { BRIDGE_MODE: 'hack' } },
        mockAck
      );
      expect(mockAck).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
      expect(mockExit).not.toHaveBeenCalled();
    });

    it('rejects RESPONSE_TIMEOUT below minimum', async () => {
      await executor.execute(
        { commandId: 'cmd4', command: 'set_config', payload: { RESPONSE_TIMEOUT: '100' } },
        mockAck
      );
      expect(mockAck).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    it('rejects RESPONSE_TIMEOUT above maximum', async () => {
      await executor.execute(
        { commandId: 'cmd4b', command: 'set_config', payload: { RESPONSE_TIMEOUT: '99999' } },
        mockAck
      );
      expect(mockAck).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    it('accepts valid BRIDGE_MODE and writes .env', async () => {
      (fs.readFileSync as jest.Mock).mockReturnValue('BRIDGE_MODE=live\n');
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {});
      await executor.execute(
        { commandId: 'cmd5', command: 'set_config', payload: { BRIDGE_MODE: 'test' } },
        mockAck
      );
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(mockAck).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('accepts valid RESPONSE_TIMEOUT in range', async () => {
      (fs.readFileSync as jest.Mock).mockReturnValue('RESPONSE_TIMEOUT=15000\n');
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {});
      await executor.execute(
        { commandId: 'cmd6', command: 'set_config', payload: { RESPONSE_TIMEOUT: '20000' } },
        mockAck
      );
      expect(mockAck).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('sends failure ACK if fs.writeFileSync throws', async () => {
      (fs.readFileSync as jest.Mock).mockReturnValue('');
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('disk full');
      });
      await executor.execute(
        { commandId: 'cmd7', command: 'set_config', payload: { BRIDGE_MODE: 'test' } },
        mockAck
      );
      expect(mockAck).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
      expect(mockExit).not.toHaveBeenCalled();
    });
  });

  describe('unknown command', () => {
    it('sends failure ACK', async () => {
      await executor.execute(
        { commandId: 'cmd8', command: 'delete_all', payload: null },
        mockAck
      );
      expect(mockAck).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
      expect(mockExit).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npm test -- --testPathPattern=commandExecutor
```
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement `src/services/commandExecutor.service.ts`**

```typescript
import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';
import { config as appConfig } from '../config/config';

type AckFn = (ack: { commandId: string; success: boolean; message: string }) => Promise<void>;

interface Command {
  commandId: string;
  command: string;
  payload: Record<string, string> | null;
}

const ALLOWED_CONFIG_KEYS: Record<string, (value: string) => boolean> = {
  BRIDGE_MODE: (v) => v === 'live' || v === 'test',
  RESPONSE_TIMEOUT: (v) => {
    const n = parseInt(v, 10);
    return !isNaN(n) && n >= 5000 && n <= 60000;
  },
  LOG_LEVEL: (v) => ['info', 'warn', 'error'].includes(v),
  HEARTBEAT_INTERVAL: (v) => {
    const n = parseInt(v, 10);
    return !isNaN(n) && n >= 5000;
  },
  LOG_BATCH_INTERVAL: (v) => {
    const n = parseInt(v, 10);
    return !isNaN(n) && n >= 10000;
  },
  COMMAND_POLL_INTERVAL: (v) => {
    const n = parseInt(v, 10);
    return !isNaN(n) && n >= 5000;
  },
};

export class CommandExecutor {
  private cfg: typeof appConfig;
  private exitFn: (code: number) => void;

  constructor(cfg: typeof appConfig, exitFn: (code: number) => void = process.exit) {
    this.cfg = cfg;
    this.exitFn = exitFn;
  }

  async execute(cmd: Command, ack: AckFn): Promise<void> {
    switch (cmd.command) {
      case 'restart':
        await this.handleRestart(cmd, ack);
        break;
      case 'set_config':
        await this.handleSetConfig(cmd, ack);
        break;
      default:
        logger.warn('Unknown command received', { command: cmd.command });
        await ack({
          commandId: cmd.commandId,
          success: false,
          message: `Unknown command: ${cmd.command}`,
        });
    }
  }

  private async handleRestart(cmd: Command, ack: AckFn): Promise<void> {
    logger.info('Restart command received', { commandId: cmd.commandId });
    try {
      await ack({ commandId: cmd.commandId, success: true, message: 'Restarting...' });
    } catch (err) {
      logger.warn('ACK failed before restart (best-effort)', { error: (err as Error).message });
    }
    this.exitFn(0);
  }

  private async handleSetConfig(cmd: Command, ack: AckFn): Promise<void> {
    const payload = cmd.payload || {};
    const keys = Object.keys(payload);

    for (const key of keys) {
      if (!(key in ALLOWED_CONFIG_KEYS)) {
        await ack({ commandId: cmd.commandId, success: false, message: `Key not allowed: ${key}` });
        return;
      }
      if (!ALLOWED_CONFIG_KEYS[key](payload[key])) {
        await ack({
          commandId: cmd.commandId,
          success: false,
          message: `Invalid value for ${key}: ${payload[key]}`,
        });
        return;
      }
    }

    try {
      const envPath = path.join(process.cwd(), '.env');
      let envContent = '';
      try {
        envContent = fs.readFileSync(envPath, 'utf-8');
      } catch {
        // .env may not exist yet — start with empty content
      }

      for (const [key, value] of Object.entries(payload)) {
        const regex = new RegExp(`^${key}=.*$`, 'm');
        if (regex.test(envContent)) {
          envContent = envContent.replace(regex, `${key}=${value}`);
        } else {
          envContent += `\n${key}=${value}`;
        }
      }

      fs.writeFileSync(envPath, envContent, 'utf-8');
      logger.info('Config updated, restarting', { keys });
    } catch (err) {
      logger.error('Failed to write .env', { error: (err as Error).message });
      await ack({ commandId: cmd.commandId, success: false, message: 'Failed to write .env' });
      return;
    }

    try {
      await ack({ commandId: cmd.commandId, success: true, message: 'Config updated, restarting...' });
    } catch (err) {
      logger.warn('ACK failed before restart (best-effort)', { error: (err as Error).message });
    }
    this.exitFn(0);
  }
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npm test -- --testPathPattern=commandExecutor
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/commandExecutor.service.ts src/services/__tests__/commandExecutor.service.test.ts
git commit -m "feat: add CommandExecutor for restart and set_config commands"
```

---

## Task 7: Update controllers to track metrics

**Files:**
- Modify: `src/controllers/print.controller.ts`
- Modify: `src/controllers/z-report.controller.ts`
- Create: `src/controllers/__tests__/print.controller.metrics.test.ts`
- Create: `src/controllers/__tests__/z-report.controller.metrics.test.ts`

- [ ] **Step 1: Write failing tests for print controller metrics**

Create `src/controllers/__tests__/print.controller.metrics.test.ts`:

```typescript
import { metrics } from '../../services/metrics.service';

// Reset metrics before each test
beforeEach(() => {
  metrics.printCount = 0;
  metrics.errorCount = 0;
  metrics.lastPrintAt = null;
});

jest.mock('../../services/ecrBridge.service', () => ({
  default: {
    generateReceiptFile: jest.fn(),
    waitForResponse: jest.fn(),
  },
}));

jest.mock('../../utils/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../config/config', () => ({
  config: {
    bridgeMode: 'test',
    ecrBridge: { fiscalCode: undefined },
  },
}));

import { handlePrintRequest } from '../print.controller';
import ecrBridgeService from '../../services/ecrBridge.service';

function makeReq(body: any) {
  return { body, ip: '127.0.0.1' } as any;
}
function makeRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('print.controller metrics', () => {
  it('increments printCount on success', async () => {
    (ecrBridgeService.generateReceiptFile as jest.Mock).mockReturnValue('bon_test.txt');
    (ecrBridgeService.waitForResponse as jest.Mock).mockResolvedValue({ success: true });
    const req = makeReq({ items: [{ name: 'Test', quantity: 1, price: 10 }], paymentType: 'CASH' });
    await handlePrintRequest(req, makeRes());
    expect(metrics.printCount).toBe(1);
    expect(metrics.lastPrintAt).not.toBeNull();
  });

  it('increments errorCount when ECR returns error', async () => {
    (ecrBridgeService.generateReceiptFile as jest.Mock).mockReturnValue('bon_test.txt');
    (ecrBridgeService.waitForResponse as jest.Mock).mockResolvedValue({
      success: false,
      details: 'printer error',
    });
    const req = makeReq({ items: [{ name: 'Test', quantity: 1, price: 10 }], paymentType: 'CASH' });
    await handlePrintRequest(req, makeRes());
    expect(metrics.errorCount).toBe(1);
  });

  it('increments errorCount on timeout', async () => {
    (ecrBridgeService.generateReceiptFile as jest.Mock).mockReturnValue('bon_test.txt');
    (ecrBridgeService.waitForResponse as jest.Mock).mockRejectedValue(new Error('Timeout'));
    const req = makeReq({ items: [{ name: 'Test', quantity: 1, price: 10 }], paymentType: 'CASH' });
    await handlePrintRequest(req, makeRes());
    expect(metrics.errorCount).toBe(1);
  });
});
```

- [ ] **Step 2: Write failing tests for z-report controller metrics**

Create `src/controllers/__tests__/z-report.controller.metrics.test.ts`:

```typescript
import { metrics } from '../../services/metrics.service';

beforeEach(() => {
  metrics.zReportCount = 0;
  metrics.errorCount = 0;
});

jest.mock('../../services/ecrBridge.service', () => ({
  default: {
    generateZReportFile: jest.fn(),
    waitForResponse: jest.fn(),
  },
}));

jest.mock('../../utils/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../config/config', () => ({
  config: { bridgeMode: 'live', ecrBridge: { fiscalCode: undefined } },
}));

import { handleZReportRequest } from '../z-report.controller';
import ecrBridgeService from '../../services/ecrBridge.service';

function makeRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('z-report.controller metrics', () => {
  it('increments zReportCount on success', async () => {
    (ecrBridgeService.generateZReportFile as jest.Mock).mockReturnValue('Z_test.txt');
    (ecrBridgeService.waitForResponse as jest.Mock).mockResolvedValue({ success: true });
    await handleZReportRequest({} as any, makeRes());
    expect(metrics.zReportCount).toBe(1);
  });

  it('increments errorCount when ECR returns error', async () => {
    (ecrBridgeService.generateZReportFile as jest.Mock).mockReturnValue('Z_test.txt');
    (ecrBridgeService.waitForResponse as jest.Mock).mockResolvedValue({
      success: false,
      details: 'error',
    });
    await handleZReportRequest({} as any, makeRes());
    expect(metrics.errorCount).toBe(1);
  });

  it('increments errorCount on timeout', async () => {
    (ecrBridgeService.generateZReportFile as jest.Mock).mockReturnValue('Z_test.txt');
    (ecrBridgeService.waitForResponse as jest.Mock).mockRejectedValue(new Error('Timeout'));
    await handleZReportRequest({} as any, makeRes());
    expect(metrics.errorCount).toBe(1);
  });
});
```

- [ ] **Step 3: Run tests — verify they fail**

```bash
npm test -- --testPathPattern="print.controller.metrics|z-report.controller.metrics"
```
Expected: FAIL (controllers don't call metrics yet)

- [ ] **Step 4: Update `src/controllers/print.controller.ts`**

Add import at the top:
```typescript
import { incrementPrintCount, incrementErrorCount } from '../services/metrics.service';
```

After `logger.info('Print request completed successfully'`, before the `res.status(200)` call, add:
```typescript
incrementPrintCount();
```

After `logger.error('ECR Bridge returned error'`, before the `res.status(500)` call, add:
```typescript
incrementErrorCount();
```

After `logger.error('Error waiting for ECR Bridge response'`, before the `res.status(504)` call, add:
```typescript
incrementErrorCount();
```

- [ ] **Step 5: Update `src/controllers/z-report.controller.ts`**

Add import at the top:
```typescript
import { incrementZReportCount, incrementErrorCount } from '../services/metrics.service';
```

After `logger.info('Z Report request completed successfully'`, before `res.status(200)`, add:
```typescript
incrementZReportCount();
```

After `logger.error('ECR Bridge returned error for Z report'`, before `res.status(500)`, add:
```typescript
incrementErrorCount();
```

After `logger.error('Error waiting for Z report response'`, before `res.status(504)`, add:
```typescript
incrementErrorCount();
```

- [ ] **Step 6: Run tests — verify they pass**

```bash
npm test -- --testPathPattern="print.controller.metrics|z-report.controller.metrics"
```
Expected: PASS

- [ ] **Step 7: Run all tests**

```bash
npm test
```
Expected: all PASS

- [ ] **Step 8: Commit**

```bash
git add src/controllers/print.controller.ts src/controllers/z-report.controller.ts src/controllers/__tests__/
git commit -m "feat: track print/zReport/error metrics in controllers"
```

---

## Task 8: Update app.ts (AgentService start + dir retry)

**Files:**
- Modify: `src/app.ts`

- [ ] **Step 1: Add AgentService import**

At the top of `src/app.ts`, after the existing imports, add:
```typescript
import { agentService } from './services/agent.service';
```

- [ ] **Step 2: Replace `initializeApp` function**

Find the entire `function initializeApp(): void { ... }` block (lines 72–103) and replace it with:

```typescript
async function initializeApp(): Promise<void> {
  logger.info('Initializing application...');

  const directories = [
    config.ecrBridge.bonPath,
    config.ecrBridge.bonOkPath,
    config.ecrBridge.bonErrPath,
  ];

  const MAX_RETRIES = 5;
  const RETRY_DELAY_MS = 3000;

  for (const dir of directories) {
    let success = false;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      if (ensureDirectoryExists(dir)) {
        logger.info(`Directory ready: ${dir}`);
        success = true;
        break;
      }
      logger.warn(`Directory not ready (attempt ${attempt}/${MAX_RETRIES}): ${dir}`);
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
    if (!success) {
      logger.error(`Failed to initialize directory after ${MAX_RETRIES} attempts: ${dir}`);
      process.exit(1);
    }
  }

  const modeLabel = config.bridgeMode === 'live' ? 'LIVE' : 'TEST';
  const modeDescription = config.bridgeMode === 'live' ? 'Fiscal receipts' : 'Non-fiscal test receipts';
  logger.info(`Bridge mode: ${modeLabel} - ${modeDescription}`);
  logger.info('Application initialized successfully');
}
```

- [ ] **Step 3: Replace `startServer` function**

Find the entire `function startServer(): void { ... }` block (lines 108–137) and replace it with:

```typescript
async function startServer(): Promise<void> {
  await initializeApp();

  const server = app.listen(config.port, () => {
    logger.info(`Server started on port ${config.port}`, {
      port: config.port,
      env: process.env.NODE_ENV || 'development',
      bridgeMode: config.bridgeMode.toUpperCase(),
    });
  });

  agentService.start();

  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    agentService.stop();
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully');
    agentService.stop();
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  });
}
```

- [ ] **Step 4: Replace the `startServer()` call at the bottom**

Find line `startServer();` (line 140) and replace **that line only** with the following — do NOT remove the `export default app;` line below it:

```typescript
startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
```

- [ ] **Step 5: Build to verify no TypeScript errors**

```bash
npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 6: Run all tests**

```bash
npm test
```
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add src/app.ts
git commit -m "feat: start AgentService on boot, add ECR dir retry logic (5x / 3s delay)"
```

---

## Task 9: Windows Service installer scripts

**Files:**
- Create: `install/generate-env.js`
- Create: `install/setup.js`
- Create: `install/uninstall.js`
- Create: `install/install.bat`
- Create: `install/uninstall.bat`

- [ ] **Step 1: Install node-windows and uuid**

```bash
npm install node-windows uuid
npm install --save-dev @types/uuid
```

- [ ] **Step 2: Create `install/generate-env.js`**

```javascript
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const envPath = path.join(__dirname, '..', '.env');
const envExamplePath = path.join(__dirname, '..', '.env.example');

if (fs.existsSync(envPath)) {
  console.log('.env already exists — skipping generation.');
  process.exit(0);
}

let content = '';
if (fs.existsSync(envExamplePath)) {
  content = fs.readFileSync(envExamplePath, 'utf-8');
} else {
  content = [
    'PORT=9000',
    'ECR_BRIDGE_BON_PATH=C:/ECRBridge/Bon/',
    'ECR_BRIDGE_BON_OK_PATH=C:/ECRBridge/BonOK/',
    'ECR_BRIDGE_BON_ERR_PATH=C:/ECRBridge/BonErr/',
    'RESPONSE_TIMEOUT=15000',
    'BRIDGE_MODE=live',
    'LOG_LEVEL=info',
    'AGENT_ENABLED=true',
    'HEARTBEAT_INTERVAL=30000',
    'LOG_BATCH_INTERVAL=60000',
    'COMMAND_POLL_INTERVAL=10000',
  ].join('\n');
}

const clientId = uuidv4();
if (/^CLIENT_ID=/m.test(content)) {
  content = content.replace(/^CLIENT_ID=.*$/m, `CLIENT_ID=${clientId}`);
} else {
  content += `\nCLIENT_ID=${clientId}`;
}

fs.writeFileSync(envPath, content, 'utf-8');
console.log(`.env created with CLIENT_ID=${clientId}`);
```

- [ ] **Step 3: Create `install/setup.js`**

```javascript
const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
  name: 'BongoFiscalBridge',
  description: 'Bongo Fiscal Bridge — ECR printer integration service',
  script: path.join(__dirname, '..', 'dist', 'app.js'),
  env: { name: 'NODE_ENV', value: 'production' },
});

svc.on('install', () => {
  console.log('Service installed. Starting...');
  svc.start();
});

svc.on('start', () => {
  console.log('BongoFiscalBridge service started successfully.');
});

svc.on('error', (err) => {
  console.error('Service error:', err);
});

svc.install();
```

- [ ] **Step 4: Create `install/uninstall.js`**

```javascript
const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
  name: 'BongoFiscalBridge',
  script: path.join(__dirname, '..', 'dist', 'app.js'),
});

svc.on('uninstall', () => {
  console.log('BongoFiscalBridge service uninstalled.');
});

svc.uninstall();
```

- [ ] **Step 5: Create `install/install.bat`**

```bat
@echo off
echo ===================================
echo  BongoFiscalBridge Installer
echo ===================================
echo.

:: Check Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed.
    echo Please install Node.js from https://nodejs.org and re-run this installer.
    pause
    exit /b 1
)

echo Node.js found. Installing dependencies...
cd /d "%~dp0.."
call npm install
if %errorlevel% neq 0 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
)

echo Building application...
call npm run build
if %errorlevel% neq 0 (
    echo ERROR: Build failed.
    pause
    exit /b 1
)

echo Generating configuration...
node install\generate-env.js

echo Registering Windows service...
node install\setup.js

echo.
echo ===================================
echo  Installation complete!
echo  BongoFiscalBridge will start
echo  automatically on Windows boot.
echo ===================================
pause
```

- [ ] **Step 6: Create `install/uninstall.bat`**

```bat
@echo off
echo ===================================
echo  BongoFiscalBridge Uninstaller
echo ===================================
echo.
cd /d "%~dp0.."
node install\uninstall.js
echo.
echo Service uninstalled.
pause
```

- [ ] **Step 7: Verify build runs cleanly**

```bash
npm run build
```
Expected: `dist/` folder created, no errors.

- [ ] **Step 8: Run full test suite**

```bash
npm test
```
Expected: all PASS

- [ ] **Step 9: Commit**

```bash
git add install/ package.json package-lock.json
git commit -m "feat: add Windows service installer scripts"
```

---

## Task 10: Final verification

- [ ] **Step 1: Run full build + tests**

```bash
npm run build && npm test
```
Expected: build succeeds, all tests PASS.

- [ ] **Step 2: Smoke test with AGENT_ENABLED=false**

Set `AGENT_ENABLED=false` in `.env` (or create a `.env` with that value), then:
```bash
npm run dev
```
Expected: server starts, log shows "AgentService disabled or CLOUD_API_URL not set — skipping start". No HTTP calls to cloud.

- [ ] **Step 3: Commit final state**

```bash
git add .
git commit -m "chore: final verification — all tests pass, build clean"
```
