import type { PosCartLine } from './usePosCart';

export function normalizePosSerial(value: string): string {
  return value.replace(/[\r\n\t]/g, '').trim().toUpperCase();
}

export function serialCountRequired(line: PosCartLine): number {
  return Math.max(0, Math.round(line.quantity));
}

export function pickedSerialCount(line: PosCartLine): number {
  return line.serialNumbers?.length ?? 0;
}

export function isPosSerialLineComplete(line: PosCartLine): boolean {
  if (!line.serialWarning) return true;
  return pickedSerialCount(line) === serialCountRequired(line);
}

export function countIncompletePosSerialLines(lines: PosCartLine[]): number {
  return lines.filter((l) => l.serialWarning && !isPosSerialLineComplete(l)).length;
}

export function trimSerialsToQuantity(line: PosCartLine, quantity: number): string[] {
  const serials = line.serialNumbers ?? [];
  const cap = Math.max(0, Math.round(quantity));
  return serials.slice(0, cap);
}

export function mergePosSerialNumbers(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
  const merged = [...(a ?? []), ...(b ?? [])];
  if (merged.length === 0) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of merged) {
    const sn = normalizePosSerial(raw);
    if (!sn || seen.has(sn)) continue;
    seen.add(sn);
    out.push(sn);
  }
  return out.length > 0 ? out : undefined;
}

export function formatPosSerialCartLabel(line: PosCartLine): string | null {
  if (!line.serialWarning) return null;
  const picked = pickedSerialCount(line);
  const required = serialCountRequired(line);
  if (picked >= required && required > 0) {
    const serials = line.serialNumbers ?? [];
    if (serials.length === 1) return serials[0];
    if (serials.length <= 2) return serials.join(', ');
    return `${serials.length} serials`;
  }
  return `${picked}/${required} serial${required === 1 ? '' : 's'}`;
}
