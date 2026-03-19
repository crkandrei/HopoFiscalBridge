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
