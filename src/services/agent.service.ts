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
      // Use console instead of logger to avoid re-buffering the warning itself
      console.warn('Log batch failed — re-buffering', { error: (err as Error).message });
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

      const command = await res.json() as Record<string, unknown>;
      if (command?.command) {
        await this.executeCommand(command as { commandId: string; command: string; payload: any });
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
    const ackCallback = async (ack: unknown): Promise<void> => {
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
    };

    try {
      // CommandExecutor is implemented in Task 6; dynamic import keeps this module loadable before that.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { CommandExecutor } = await import('./commandExecutor.service');
      const executor = new CommandExecutor(this.cfg);
      await executor.execute(cmd, ackCallback);
    } catch (err) {
      logger.warn('executeCommand failed', { error: (err as Error).message });
    }
  }
}

export const agentService = new AgentService(appConfig);
