import type { PosCartLine } from './usePosCart';
import { normalizeSerialNumber, serialNumbersEqual } from '../../../inventory/utils/serialNumber';

export function normalizePosSerial(value: string): string {
  return normalizeSerialNumber(value.replace(/[\r\n\t]/g, ''));
}

export function serialCountRequired(line: PosCartLine): number {
  return Math.max(0, Math.round(line.quantity));
}

export function pickedSerialCount(line: PosCartLine): number {
  return line.serialNumbers?.length ?? 0;
}

export function isPosSerialLineComplete(line: PosCartLine): boolean {
  if (!line.serialWarning) return true;
  // Optional tracking (server's SERIAL_OPTIONAL, see effective-tracking.ts): 0..quantity serials
  // are all valid, the server never requires an exact match — so an optional line is "complete"
  // (never blocks checkout) no matter how many serials are picked, same as a plain unserialized
  // item. Only mandatory (SERIAL) lines must match quantity exactly.
  if (line.serialOptional) return true;
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

/** Keep newSerialNumbers a subset of whatever serialNumbers survived a quantity/removal edit. */
export function trimNewSerials(line: PosCartLine, keptSerials: string[]): string[] | undefined {
  const kept = new Set(keptSerials.map(normalizePosSerial));
  const next = (line.newSerialNumbers ?? []).filter((sn) => kept.has(normalizePosSerial(sn)));
  return next.length > 0 ? next : undefined;
}

export function isNewSerial(line: PosCartLine, sn: string): boolean {
  const norm = normalizePosSerial(sn);
  return (line.newSerialNumbers ?? []).some((x) => normalizePosSerial(x) === norm);
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
  const serials = line.serialNumbers ?? [];
  const serialsText = () =>
    serials.length === 1 ? serials[0] : serials.length <= 2 ? serials.join(', ') : `${serials.length} serials`;

  if (line.serialOptional) {
    // No "X/Y" fraction here — Y (quantity) was never a target to hit, so showing it as a
    // denominator would read as a shortfall that doesn't exist.
    if (picked === 0) return 'No serial (optional)';
    const newCount = line.newSerialNumbers?.length ?? 0;
    const newSuffix = newCount > 0 ? ` · ${newCount} new` : '';
    return `${serialsText()} (optional)${newSuffix}`;
  }

  if (picked >= required && required > 0) return serialsText();
  return `${picked}/${required} serial${required === 1 ? '' : 's'}`;
}
