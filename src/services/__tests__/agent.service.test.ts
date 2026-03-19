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
