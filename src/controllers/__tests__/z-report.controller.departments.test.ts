jest.mock('../../services/ecrBridge.service', () => ({
  __esModule: true,
  default: {
    generateZReportFile: jest.fn(),
    generateDepartmentReportFile: jest.fn(),
    waitForResponse: jest.fn(),
  },
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../config/config', () => ({
  config: {
    bridgeMode: 'live',
    ecrBridge: { fiscalCode: undefined, departmentReportBeforeZ: false },
  },
}));

import { handleZReportRequest } from '../z-report.controller';
import ecrBridgeService from '../../services/ecrBridge.service';
import { config } from '../../config/config';

function makeRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('z-report.controller — raport pe departamente înainte de Z', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    config.ecrBridge.departmentReportBeforeZ = false;
    (ecrBridgeService.generateDepartmentReportFile as jest.Mock).mockReturnValue('RD_test.txt');
    (ecrBridgeService.generateZReportFile as jest.Mock).mockReturnValue('Z_test.txt');
    (ecrBridgeService.waitForResponse as jest.Mock).mockResolvedValue({ success: true });
  });

  it('nu emite RD când opțiunea e dezactivată', async () => {
    await handleZReportRequest({} as any, makeRes());
    expect(ecrBridgeService.generateDepartmentReportFile).not.toHaveBeenCalled();
  });

  it('emite RD înaintea raportului Z când opțiunea e activă', async () => {
    config.ecrBridge.departmentReportBeforeZ = true;

    const order: string[] = [];
    (ecrBridgeService.generateDepartmentReportFile as jest.Mock).mockImplementation(() => {
      order.push('RD');
      return 'RD_test.txt';
    });
    (ecrBridgeService.generateZReportFile as jest.Mock).mockImplementation(() => {
      order.push('Z');
      return 'Z_test.txt';
    });

    await handleZReportRequest({} as any, makeRes());

    expect(order).toEqual(['RD', 'Z']);
  });

  it('așteaptă răspunsul casei la RD înainte să trimită Z', async () => {
    config.ecrBridge.departmentReportBeforeZ = true;

    await handleZReportRequest({} as any, makeRes());

    expect(ecrBridgeService.waitForResponse).toHaveBeenNthCalledWith(
      1,
      'RD_test.txt',
      'RD',
      expect.any(Number)
    );
  });

  it('emite totuși raportul Z dacă RD eșuează', async () => {
    config.ecrBridge.departmentReportBeforeZ = true;
    (ecrBridgeService.waitForResponse as jest.Mock)
      .mockResolvedValueOnce({ success: false, details: 'Comanda RD nu e permisa' })
      .mockResolvedValueOnce({ success: true });

    const res = makeRes();
    await handleZReportRequest({} as any, res);

    expect(ecrBridgeService.generateZReportFile).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success', departmentReport: 'error' })
    );
  });

  it('raportează departmentReport success când RD trece', async () => {
    config.ecrBridge.departmentReportBeforeZ = true;

    const res = makeRes();
    await handleZReportRequest({} as any, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success', departmentReport: 'success' })
    );
  });
});
