import fs from 'fs';
import path from 'path';
import { config } from '../../config/config';
import ecrBridgeService from '../../services/ecrBridge.service';
import { handlePrintRequest } from '../print.controller';

/**
 * Comanda trimisă spre waitForResponse e folosită ca să verificăm că fișierul
 * de eroare din BonErr chiar corespunde bonului nostru. Dacă nu e identică cu
 * ce s-a scris în fișier, verificarea aia nu mai înseamnă nimic.
 */
describe('print.controller — comanda raportată corespunde fișierului scris', () => {
  const testBonPath = '/tmp/hopo-test-bon-command';
  const originalBonPath = config.ecrBridge.bonPath;
  const originalMode = config.bridgeMode;
  const originalDepartmentsEnabled = config.ecrBridge.departmentsEnabled;
  let waitSpy: jest.SpyInstance;

  const makeReq = (body: any) => ({ body, ip: '127.0.0.1' } as any);
  const makeRes = () => {
    const res: any = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  beforeEach(() => {
    config.ecrBridge.bonPath = testBonPath;
    config.bridgeMode = 'live';
    config.ecrBridge.departmentsEnabled = true;
    fs.mkdirSync(testBonPath, { recursive: true });
    waitSpy = jest
      .spyOn(ecrBridgeService, 'waitForResponse')
      .mockResolvedValue({ success: true, filename: 'x' });
  });

  afterEach(() => {
    waitSpy.mockRestore();
    config.ecrBridge.bonPath = originalBonPath;
    config.bridgeMode = originalMode;
    config.ecrBridge.departmentsEnabled = originalDepartmentsEnabled;
    fs.rmSync(testBonPath, { recursive: true, force: true });
  });

  const sentCommandFor = async (body: any): Promise<{ sent: string; written: string }> => {
    await handlePrintRequest(makeReq(body), makeRes());
    const [filename, sent] = waitSpy.mock.calls[0];
    const written = fs.readFileSync(path.join(testBonPath, filename as string), 'utf8');
    return { sent: sent as string, written };
  };

  it('pentru o linie cu departament', async () => {
    const { sent, written } = await sentCommandFor({
      paymentType: 'CASH',
      items: [{ name: 'Suc', quantity: 1, price: 5.0, vatClass: 2, dept: 1 }],
    });

    expect(sent).toBe(written);
    expect(sent).toContain('I;Suc;1;5;2;BUC.;1');
  });

  it('pentru o linie cu altă cotă de TVA decât prima', async () => {
    const { sent, written } = await sentCommandFor({
      paymentType: 'CASH',
      items: [{ name: 'Apa', quantity: 2, price: 8.0, vatClass: 5 }],
    });

    expect(sent).toBe(written);
  });
});
