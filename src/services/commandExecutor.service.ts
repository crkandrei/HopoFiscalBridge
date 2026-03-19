import { config as appConfig } from '../config/config';
import logger from '../utils/logger';

export interface CommandAck {
  commandId: string;
  status: 'ok' | 'error';
  result?: unknown;
  error?: string;
}

export type AckCallback = (ack: CommandAck) => Promise<void>;

/**
 * Executes commands received from the cloud API.
 * Implemented in Task 6 — this stub satisfies the compiler for Task 5.
 */
export class CommandExecutor {
  private cfg: typeof appConfig;

  constructor(cfg: typeof appConfig) {
    this.cfg = cfg;
  }

  async execute(
    cmd: { commandId: string; command: string; payload: unknown },
    ack: AckCallback
  ): Promise<void> {
    logger.warn('CommandExecutor.execute called but not yet implemented', { command: cmd.command });
    await ack({ commandId: cmd.commandId, status: 'error', error: 'not implemented' });
  }
}
