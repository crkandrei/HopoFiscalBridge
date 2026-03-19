import { CommandExecutor } from '../commandExecutor.service';
import * as fs from 'fs';
import * as childProcess from 'child_process';
import AdmZip from 'adm-zip';

jest.mock('fs');
jest.mock('child_process');
jest.mock('adm-zip');

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
  update: {
    githubRepo: '',
  },
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
});
