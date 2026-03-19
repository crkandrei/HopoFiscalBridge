import { metrics } from '../../services/metrics.service';

beforeEach(() => {
  metrics.zReportCount = 0;
  metrics.errorCount = 0;
});

jest.mock('../../services/ecrBridge.service', () => ({
  __esModule: true,
  default: {
    generateZReportFile: jest.fn(),
    waitForResponse: jest.fn(),
  },
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
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
