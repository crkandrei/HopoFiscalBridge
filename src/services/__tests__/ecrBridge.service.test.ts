import { validatePrintRequest } from '../../utils/validator';
import ecrBridgeService from '../ecrBridge.service';
import { config } from '../../config/config';
import fs from 'fs';
import path from 'path';

describe('validatePrintRequest — vatClass', () => {
  const base = {
    paymentType: 'CASH',
    items: [{ name: 'Produs', quantity: 1, price: 10.0 }],
  };

  it('accepts items without vatClass (backwards compatible)', () => {
    const result = validatePrintRequest(base);
    expect(result.success).toBe(true);
  });

  it('accepts items with vatClass 1', () => {
    const result = validatePrintRequest({
      ...base,
      items: [{ name: 'Produs', quantity: 1, price: 10.0, vatClass: 1 }],
    });
    expect(result.success).toBe(true);
    expect(result.data!.items![0].vatClass).toBe(1);
  });

  it('accepts items with vatClass 2', () => {
    const result = validatePrintRequest({
      ...base,
      items: [{ name: 'Produs', quantity: 1, price: 10.0, vatClass: 2 }],
    });
    expect(result.success).toBe(true);
    expect(result.data!.items![0].vatClass).toBe(2);
  });

  it('rejects vatClass 0', () => {
    const result = validatePrintRequest({
      ...base,
      items: [{ name: 'Produs', quantity: 1, price: 10.0, vatClass: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects vatClass 10', () => {
    const result = validatePrintRequest({
      ...base,
      items: [{ name: 'Produs', quantity: 1, price: 10.0, vatClass: 10 }],
    });
    expect(result.success).toBe(false);
  });
});

describe('ecrBridgeService — generateReceiptFile vatClass', () => {
  const testBonPath = '/tmp/hopo-test-bon';
  const originalBonPath = config.ecrBridge.bonPath;

  beforeEach(() => {
    config.ecrBridge.bonPath = testBonPath;
    fs.mkdirSync(testBonPath, { recursive: true });
  });

  afterEach(() => {
    config.ecrBridge.bonPath = originalBonPath;
    fs.rmSync(testBonPath, { recursive: true, force: true });
  });

  it('uses vatClass from item when provided (live mode)', () => {
    const filename = ecrBridgeService.generateReceiptFile(
      {
        paymentType: 'CASH' as any,
        items: [{ name: 'Suc', quantity: 1, price: 5.0, vatClass: 2 }],
      },
      'live'
    );
    expect(filename).not.toBeNull();
    const content = fs.readFileSync(path.join(testBonPath, filename!), 'utf8');
    expect(content).toContain('I;Suc;1;5;2');
  });

  it('defaults to vatClass 1 when not provided (live mode)', () => {
    const filename = ecrBridgeService.generateReceiptFile(
      {
        paymentType: 'CASH' as any,
        items: [{ name: 'Suc', quantity: 1, price: 5.0 }],
      },
      'live'
    );
    expect(filename).not.toBeNull();
    const content = fs.readFileSync(path.join(testBonPath, filename!), 'utf8');
    expect(content).toContain('I;Suc;1;5;1');
  });
});
