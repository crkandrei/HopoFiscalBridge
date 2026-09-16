import { validatePrintRequest } from '../../utils/validator';
import ecrBridgeService from '../ecrBridge.service';
import { config } from '../../config/config';
import fs from 'fs';
import path from 'path';

describe('validatePrintRequest — dept', () => {
  const base = {
    paymentType: 'CASH',
    items: [{ name: 'Produs', quantity: 1, price: 10.0 }],
  };

  it('accepts items without dept (backwards compatible)', () => {
    const result = validatePrintRequest(base);
    expect(result.success).toBe(true);
    expect(result.data!.items![0].dept).toBeUndefined();
  });

  it('keeps dept on the validated item', () => {
    const result = validatePrintRequest({
      ...base,
      items: [{ name: 'Produs', quantity: 1, price: 10.0, dept: 2 }],
    });
    expect(result.success).toBe(true);
    expect(result.data!.items![0].dept).toBe(2);
  });

  it('accepts dept 0 (vânzare fără departament)', () => {
    const result = validatePrintRequest({
      ...base,
      items: [{ name: 'Produs', quantity: 1, price: 10.0, dept: 0 }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects dept 10 — casa acceptă doar 0-9', () => {
    const result = validatePrintRequest({
      ...base,
      items: [{ name: 'Produs', quantity: 1, price: 10.0, dept: 10 }],
    });
    expect(result.success).toBe(false);
  });
});

describe('ecrBridgeService — departamente pe linia de vânzare', () => {
  const testBonPath = '/tmp/hopo-test-bon-dept';
  const originalBonPath = config.ecrBridge.bonPath;
  const originalDepartmentsEnabled = config.ecrBridge.departmentsEnabled;

  const writeReceipt = (item: Record<string, unknown>): string => {
    const filename = ecrBridgeService.generateReceiptFile(
      {
        paymentType: 'CASH' as any,
        items: [item as any],
      },
      'live'
    );
    expect(filename).not.toBeNull();
    return fs.readFileSync(path.join(testBonPath, filename!), 'utf8');
  };

  beforeEach(() => {
    config.ecrBridge.bonPath = testBonPath;
    config.ecrBridge.departmentsEnabled = true;
    fs.mkdirSync(testBonPath, { recursive: true });
  });

  afterEach(() => {
    config.ecrBridge.bonPath = originalBonPath;
    config.ecrBridge.departmentsEnabled = originalDepartmentsEnabled;
    fs.rmSync(testBonPath, { recursive: true, force: true });
  });

  it('emite I;name;qty;price;vat;um;dept când departamentele sunt active', () => {
    const content = writeReceipt({ name: 'Suc', quantity: 1, price: 5.0, vatClass: 2, dept: 1 });
    expect(content).toContain('I;Suc;1;5;2;BUC.;1');
  });

  it('folosește unitatea de măsură trimisă de platformă', () => {
    const content = writeReceipt({
      name: 'Ora de joaca',
      quantity: 1,
      price: 25.0,
      vatClass: 5,
      dept: 2,
      um: 'ORA',
    });
    expect(content).toContain('I;Ora de joaca;1;25;5;ORA;2');
  });

  it('omite um și dept pentru dept 0 — linia rămâne ca înainte', () => {
    const content = writeReceipt({ name: 'Suc', quantity: 1, price: 5.0, vatClass: 2, dept: 0 });
    expect(content).toContain('I;Suc;1;5;2\n');
  });

  it('ignoră dept când departamentele nu sunt active pe această instalare', () => {
    config.ecrBridge.departmentsEnabled = false;
    const content = writeReceipt({ name: 'Suc', quantity: 1, price: 5.0, vatClass: 2, dept: 3 });
    expect(content).toContain('I;Suc;1;5;2\n');
  });
});

describe('ecrBridgeService — raport pe departamente', () => {
  const testBonPath = '/tmp/hopo-test-bon-rd';
  const originalBonPath = config.ecrBridge.bonPath;

  beforeEach(() => {
    config.ecrBridge.bonPath = testBonPath;
    fs.mkdirSync(testBonPath, { recursive: true });
  });

  afterEach(() => {
    config.ecrBridge.bonPath = originalBonPath;
    fs.rmSync(testBonPath, { recursive: true, force: true });
  });

  it('scrie un fișier cu comanda RD', () => {
    const filename = ecrBridgeService.generateDepartmentReportFile();
    expect(filename).not.toBeNull();
    const content = fs.readFileSync(path.join(testBonPath, filename!), 'utf8');
    expect(content).toBe('RD');
  });

  it('folosește un nume distinct de al raportului Z', () => {
    const rdFilename = ecrBridgeService.generateDepartmentReportFile();
    const zFilename = ecrBridgeService.generateZReportFile();
    expect(rdFilename).not.toBe(zFilename);
    expect(rdFilename).toMatch(/^RD_\d{8}_\d{6}\.txt$/);
  });
});
