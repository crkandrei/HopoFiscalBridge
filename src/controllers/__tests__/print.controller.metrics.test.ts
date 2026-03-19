import { metrics } from '../../services/metrics.service';

// Reset metrics before each test
beforeEach(() => {
  metrics.printCount = 0;
  metrics.errorCount = 0;
  metrics.lastPrintAt = null;
});

jest.mock('../../services/ecrBridge.service', () => ({
  __esModule: true,
  default: {
    generateReceiptFile: jest.fn(),
    waitForResponse: jest.fn(),
  },
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
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
