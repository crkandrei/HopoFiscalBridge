export const metrics = {
  printCount: 0,
  zReportCount: 0,
  errorCount: 0,
  lastPrintAt: null as Date | null,
};

export function incrementPrintCount(): void {
  metrics.printCount++;
  metrics.lastPrintAt = new Date();
}

export function incrementZReportCount(): void {
  metrics.zReportCount++;
}

export function incrementErrorCount(): void {
  metrics.errorCount++;
}
