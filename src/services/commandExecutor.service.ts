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
