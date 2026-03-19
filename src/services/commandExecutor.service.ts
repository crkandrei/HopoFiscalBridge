import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as childProcess from 'child_process';
import AdmZip from 'adm-zip';
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
      case 'update':
        await this.handleUpdate(cmd, ack);
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

  private async handleUpdate(cmd: Command, ack: AckFn): Promise<void> {
    const version = cmd.payload?.version;
    if (!version) {
      await ack({ commandId: cmd.commandId, success: false, message: 'version is required in payload' });
      return;
    }

    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      await ack({ commandId: cmd.commandId, success: false, message: 'version must be semver format (e.g. 1.2.0)' });
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
      try { fs.unlinkSync(zipPath); } catch {}
      try { fs.rmdirSync(extractDir, { recursive: true }); } catch {}
      await ack({ commandId: cmd.commandId, success: false, message: `Update failed: ${(err as Error).message}` });
      return;
    }

    // Resolve install root: dist/services/ → ../../
    const installDir = path.resolve(__dirname, '..', '..');
    const updateScript = path.join(installDir, 'install', 'update.ps1');

    // Use Task Scheduler to run update.ps1 outside the service's Job Object.
    // Direct spawn() from a Windows Service is killed when the service process exits
    // because child processes are bound to the same Job Object.
    const taskName = 'HopoFiscalBridgeUpdate';
    const psCmd = `powershell.exe -ExecutionPolicy Bypass -NonInteractive -File "${updateScript}" "${extractDir}" "${installDir}"`;
    try {
      childProcess.execSync(`schtasks /delete /f /tn "${taskName}"`, { stdio: 'ignore' });
    } catch { /* ignore if task doesn't exist */ }
    childProcess.execSync(`schtasks /create /f /tn "${taskName}" /sc once /st 00:00 /tr "${psCmd}" /ru SYSTEM /rl HIGHEST`);
    childProcess.execSync(`schtasks /run /tn "${taskName}"`);

    logger.info('Update task scheduled via schtasks, exiting', { version, installDir });

    try {
      await ack({ commandId: cmd.commandId, success: true, message: 'Update initiated, service restarting...' });
    } catch (err) {
      logger.warn('ACK failed before update exit (best-effort)', { error: (err as Error).message });
    }
    this.exitFn(0);
  }
}
