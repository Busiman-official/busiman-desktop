/** Trim only — serial numbers are case-sensitive (5w4f ≠ 5W4F). */
export function normalizeSerialNumber(value: string): string {
  return value.trim();
}

export function normalizeSerialNumbers(values: string[]): string[] {
  return values.map(normalizeSerialNumber).filter((s) => s.length > 0);
}

export function serialNumbersEqual(a: string, b: string): boolean {
  return normalizeSerialNumber(a) === normalizeSerialNumber(b);
}
