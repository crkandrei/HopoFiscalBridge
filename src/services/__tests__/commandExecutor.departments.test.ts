import { CommandExecutor } from '../commandExecutor.service';
import * as fs from 'fs';

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
  update: { githubRepo: '' },
} as any;

/**
 * Departamentele se activează per client, după ce service-ul le-a programat în
 * casă. Fără set_config ar însemna o deplasare la fiecare locație.
 */
describe('CommandExecutor — set_config pentru departamente', () => {
  let mockAck: jest.Mock;
  let mockExit: jest.Mock;
  let executor: CommandExecutor;

  const setConfig = (payload: Record<string, string>) =>
    executor.execute({ commandId: 'cmd', command: 'set_config', payload }, mockAck);

  beforeEach(() => {
    jest.clearAllMocks();
    mockAck = jest.fn().mockResolvedValue(undefined);
    mockExit = jest.fn();
    executor = new CommandExecutor(mockConfig, mockExit);
    (fs.readFileSync as jest.Mock).mockReturnValue('BRIDGE_MODE=live\n');
    (fs.writeFileSync as jest.Mock).mockImplementation(() => {});
  });

  it('acceptă activarea departamentelor', async () => {
    await setConfig({ ECR_BRIDGE_DEPARTMENTS_ENABLED: 'true' });

    expect(mockAck).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it('acceptă dezactivarea lor — trebuie să putem da înapoi de la distanță', async () => {
    await setConfig({ ECR_BRIDGE_DEPARTMENTS_ENABLED: 'false' });

    expect(mockAck).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('acceptă flag-ul de raport RD înainte de Z', async () => {
    await setConfig({ ECR_BRIDGE_DEPARTMENT_REPORT_BEFORE_Z: 'true' });

    expect(mockAck).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('respinge orice altceva decât true/false', async () => {
    await setConfig({ ECR_BRIDGE_DEPARTMENTS_ENABLED: 'da' });

    expect(mockAck).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('scrie în .env valoarea trimisă', async () => {
    await setConfig({ ECR_BRIDGE_DEPARTMENTS_ENABLED: 'true' });

    const written = (fs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
    expect(written).toContain('ECR_BRIDGE_DEPARTMENTS_ENABLED=true');
  });
});
