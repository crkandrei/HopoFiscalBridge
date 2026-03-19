import { metrics, incrementPrintCount, incrementZReportCount, incrementErrorCount } from '../metrics.service';

describe('metrics.service', () => {
  beforeEach(() => {
    metrics.printCount = 0;
    metrics.zReportCount = 0;
    metrics.errorCount = 0;
    metrics.lastPrintAt = null;
  });

  it('incrementPrintCount increments printCount and sets lastPrintAt', () => {
    const before = new Date();
    incrementPrintCount();
    expect(metrics.printCount).toBe(1);
    expect(metrics.lastPrintAt).not.toBeNull();
    expect(metrics.lastPrintAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('incrementZReportCount increments zReportCount', () => {
    incrementZReportCount();
    expect(metrics.zReportCount).toBe(1);
  });

  it('incrementErrorCount increments errorCount', () => {
    incrementErrorCount();
    expect(metrics.errorCount).toBe(1);
  });

  it('counters accumulate', () => {
    incrementPrintCount();
    incrementPrintCount();
    incrementErrorCount();
    expect(metrics.printCount).toBe(2);
    expect(metrics.errorCount).toBe(1);
  });
});
