/**
 * Reads the "Stock (On Hand)" column (Variants sheet) and the "Serial Numbers" sheet from a
 * product export/import workbook (see exportProductsExcel.ts) and turns edited values into a
 * Stock Count's lines — NOT a direct stock overwrite. Stock in this app only ever changes through
 * a movement with a reason and, for anything beyond a trivial edit, a review step; silently
 * trusting a spreadsheet number would skip both. Routing it through the existing Stock Count
 * flow (create → enter physical → submit → approve) keeps that guarantee for file-driven edits
 * exactly like it holds for someone typing counts in by hand.
 *
 * The workbook's "Stock (On Hand)" is a COMPANY-WIDE total (see buildProductsWorkbook), but a
 * Stock Count is always for ONE location — so this treats every edited number as "this is what
 * should physically be at the location you picked for this reconciliation", not the company-wide
 * total. That's the right read for a single-location business, and still useful for a specific
 * "true up this one location" exercise elsewhere, but callers must make the location choice
 * explicit (see ItemMaster.tsx's reconcile flow) rather than defaulting it silently.
 */
import ExcelJS from 'exceljs';

export interface StockReconcileLine {
  row: number;
  productName: string;
  sku: string;
  /** Present only when the sheet's Stock value differs from what's currently on hand for this
   * variant at the chosen location — omitted rows aren't worth a count line at all. */
  physicalQuantity?: number;
  /** Serial numbers listed for this variant that the system doesn't already have. */
  newSerialNumbers: string[];
}

export interface StockReconcileParseResult {
  lines: StockReconcileLine[];
  errors: Array<{ row: number; message: string }>;
}

function toStr(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'text' in (value as any)) return String((value as any).text ?? '').trim();
  return String(value).trim();
}

function toNum(value: ExcelJS.CellValue): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function headerIndex(sheet: ExcelJS.Worksheet): Map<string, number> {
  const map = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, colNumber) => map.set(toStr(cell.value), colNumber));
  return map;
}

function cellAt(row: ExcelJS.Row, headers: Map<string, number>, name: string): ExcelJS.CellValue {
  const idx = headers.get(name);
  return idx == null ? null : row.getCell(idx).value;
}

/**
 * @param currentSystemQuantity  `(sku) => on-hand at the chosen location right now` — used to
 *   decide whether a Stock cell actually changed anything (an unedited export re-uploaded as-is
 *   must not manufacture a pile of zero-variance count lines).
 * @param existingSerialNumbers  The full set of serial numbers the system already knows about
 *   (any item, any location) — a Serial Numbers sheet row naming one of these is that serial's
 *   current record, not a new unit; only genuinely unrecognized numbers become newSerialNumbers.
 */
export async function parseStockReconcileWorkbook(
  buffer: ArrayBuffer,
  currentSystemQuantity: (sku: string) => number | undefined,
  existingSerialNumbers: Set<string>,
): Promise<StockReconcileParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const errors: StockReconcileParseResult['errors'] = [];

  const linesBySku = new Map<string, StockReconcileLine>();
  const getOrCreate = (sku: string, productName: string, row: number): StockReconcileLine => {
    const existing = linesBySku.get(sku);
    if (existing) return existing;
    const created: StockReconcileLine = { row, productName, sku, newSerialNumbers: [] };
    linesBySku.set(sku, created);
    return created;
  };

  const variantsSheet = workbook.getWorksheet('Variants');
  if (variantsSheet) {
    const headers = headerIndex(variantsSheet);
    if (headers.has('Variant SKU') && headers.has('Stock (On Hand)')) {
      variantsSheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const sku = toStr(cellAt(row, headers, 'Variant SKU'));
        if (!sku || sku === '(no variants)') return;
        const productName = toStr(cellAt(row, headers, 'Product Name'));
        // A blank cell means "count this as zero" (e.g. a freshly added product row whose stock
        // was never filled in), not "leave it alone" — an unedited export always carries a real
        // number here (buildProductsWorkbook defaults it to 0), so blank only ever means the user
        // left it that way on purpose.
        const sheetQty = toNum(cellAt(row, headers, 'Stock (On Hand)')) ?? 0;
        const current = currentSystemQuantity(sku);
        if (current != null && current === sheetQty) return; // unchanged — not worth a count line
        getOrCreate(sku, productName, rowNumber).physicalQuantity = sheetQty;
      });
    }
  }

  const serialSheet = workbook.getWorksheet('Serial Numbers');
  if (serialSheet) {
    const headers = headerIndex(serialSheet);
    if (headers.has('Variant SKU') && headers.has('Serial Number')) {
      serialSheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const sku = toStr(cellAt(row, headers, 'Variant SKU'));
        const serialNumber = toStr(cellAt(row, headers, 'Serial Number'));
        if (!sku || !serialNumber) return; // blank/placeholder row (e.g. a variant with none yet)
        if (existingSerialNumbers.has(serialNumber.toUpperCase())) return; // already a real serial
        const productName = toStr(cellAt(row, headers, 'Product Name'));
        const line = getOrCreate(sku, productName, rowNumber);
        if (!line.newSerialNumbers.includes(serialNumber)) line.newSerialNumbers.push(serialNumber);
      });
    }
  }

  return { lines: Array.from(linesBySku.values()), errors };
}
