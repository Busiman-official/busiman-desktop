/**
 * Full-fidelity product export — a real styled .xlsx workbook (not a flat CSV dump), with the
 * product master and its variants properly separated:
 *   - "Products" sheet: one row per product, master-level fields only.
 *   - "Variants" sheet: one row per variant, linked back to its product via "Product Name" +
 *     "Product ID" columns, variant-level fields only.
 * This mirrors the actual data model (a product has many variants) instead of repeating every
 * master field on every variant row. Column layout matches importProductsExcel.ts's expectations
 * so a lightly-edited export can be re-uploaded.
 */
import ExcelJS from 'exceljs';
import { IndustryType, ItemType, ProductType, type InventoryItem, type InventoryVariant } from '@/services/inventory.service';

const BRAND_HEADER_FILL = 'FF1F4E78'; // dark blue
const BRAND_HEADER_FONT = 'FFFFFFFF'; // white
const STRIPE_FILL = 'FFF2F7FC'; // faint blue, alternating rows
const SUMMARY_FILL = 'FFEFF6EC';

const YES_NO = ['Yes', 'No'];
const PRODUCT_TYPE_OPTIONS = Object.values(ProductType);
const ITEM_TYPE_OPTIONS = Object.values(ItemType);
const INDUSTRY_TYPE_OPTIONS = Object.values(IndustryType);

/** Rows to pre-fill with a dropdown beyond the current data, so pasting/adding new product rows
 * still gets the picker instead of falling off the edge of validated cells. */
const EXTRA_BLANK_ROWS = 200;

function bool(value: boolean | undefined): string {
  return value ? 'Yes' : 'No';
}

/** Adds an Excel "pick from list" dropdown to every cell in a column, from row 2 through
 * `lastDataRow + EXTRA_BLANK_ROWS`. Excel's inline-list validation is capped at 255 characters,
 * which every list here comfortably fits under. */
function applyListValidation(sheet: ExcelJS.Worksheet, key: string, options: string[], lastDataRow: number): void {
  const colNumber = sheet.getColumn(key).number;
  if (!colNumber) return;
  const formula = `"${options.join(',')}"`;
  const lastRow = lastDataRow + EXTRA_BLANK_ROWS;
  for (let r = 2; r <= lastRow; r++) {
    sheet.getCell(r, colNumber).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [formula],
      showErrorMessage: true,
      errorStyle: 'warning',
      errorTitle: 'Not a listed option',
      error: `Pick one of: ${options.join(', ')} (or leave blank).`,
    };
  }
}

function styleHeaderRow(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: BRAND_HEADER_FONT }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_HEADER_FILL } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFB0C4DE' } } };
  });
  row.height = 22;
}

function autoFitColumns(sheet: ExcelJS.Worksheet, minWidth = 10, maxWidth = 40): void {
  sheet.columns.forEach((column) => {
    let longest = minWidth;
    column.eachCell?.({ includeEmpty: false }, (cell) => {
      const len = String(cell.value ?? '').length;
      if (len > longest) longest = len;
    });
    column.width = Math.min(longest + 2, maxWidth);
  });
}

export async function buildProductsWorkbook(
  items: InventoryItem[],
  variantsByItemId: Map<string, InventoryVariant[]>,
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Busiman';
  workbook.created = new Date();

  // ── Summary sheet — quick orientation, not required for re-import ──────────────────
  const summary = workbook.addWorksheet('Summary', { properties: { tabColor: { argb: BRAND_HEADER_FILL } } });
  summary.mergeCells('A1:B1');
  summary.getCell('A1').value = 'Busiman — Product Catalog Export';
  summary.getCell('A1').font = { bold: true, size: 16, color: { argb: BRAND_HEADER_FONT } };
  summary.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_HEADER_FILL } };
  summary.getCell('A1').alignment = { vertical: 'middle' };
  summary.getRow(1).height = 28;

  const totalVariants = Array.from(variantsByItemId.values()).reduce((n, v) => n + v.length, 0);
  const summaryRows: Array<[string, string | number]> = [
    ['Exported', new Date().toLocaleString()],
    ['Products', items.length],
    ['Variants', totalVariants],
    ['', ''],
    ['How to read this file', ''],
    ['Products sheet', 'One row per product — name, category, tracking rules, defaults.'],
    ['Variants sheet', 'One row per sellable SKU — pricing, stock limits, HSN, etc. "Product Name" links it back to its product.'],
    ['Re-uploading', 'Matched by Product Name and Variant SKU (no ID needed). A name that already exists is updated in place; its variants are matched by SKU and updated, or added if the SKU is new. A name with no match is created fresh.'],
  ];
  summaryRows.forEach(([label, value], i) => {
    const r = summary.getRow(i + 3);
    r.getCell(1).value = label;
    r.getCell(2).value = value;
    r.getCell(1).font = { bold: i < 3 || label === 'How to read this file' };
    if (label === 'How to read this file') {
      r.getCell(1).font = { bold: true, italic: true };
      r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUMMARY_FILL } };
    }
  });
  summary.getColumn(1).width = 22;
  summary.getColumn(2).width = 70;
  summary.getColumn(2).alignment = { wrapText: true };

  // ── Products sheet ───────────────────────────────────────────────────────────────
  const productsSheet = workbook.addWorksheet('Products', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { tabColor: { argb: BRAND_HEADER_FILL } },
  });
  productsSheet.columns = [
    { header: 'Product Name', key: 'name' },
    { header: 'Description', key: 'description' },
    { header: 'Category', key: 'category' },
    { header: 'Product Type', key: 'productType' },
    { header: 'Item Type', key: 'itemType' },
    { header: 'Is Misc', key: 'isMisc' },
    { header: 'Serviceable (default)', key: 'serviceable' },
    { header: 'Has Variants', key: 'hasVariants' },
    { header: 'Active', key: 'isActive' },
    { header: 'Base Unit', key: 'baseUnit' },
    { header: 'Alternate Units', key: 'altUnits' },
    { header: 'Industry Type', key: 'industryType' },
    { header: 'High Value', key: 'isHighValue' },
    { header: 'Batch Tracked', key: 'requiresBatch' },
    { header: 'Serial Tracked', key: 'requiresSerial' },
    { header: 'Serial Optional', key: 'serialOptional' },
    { header: 'Has Expiry', key: 'hasExpiry' },
    { header: 'Perishable', key: 'isPerishable' },
    { header: 'Cost Price (default)', key: 'costPrice' },
    { header: 'Selling Price (default)', key: 'sellingPrice' },
    { header: 'Margin %', key: 'margin' },
    { header: 'Weight', key: 'weight' },
    { header: 'Dimensions (L×W×H)', key: 'dims' },
    { header: 'Tags', key: 'tags' },
    { header: 'Barcode', key: 'barcode' },
    { header: 'Created By', key: 'createdBy' },
    { header: 'Created At', key: 'createdAt' },
    { header: 'Updated By', key: 'updatedBy' },
    { header: 'Updated At', key: 'updatedAt' },
  ];
  styleHeaderRow(productsSheet.getRow(1));

  items.forEach((item, i) => {
    const row = productsSheet.addRow({
      name: item.name ?? '',
      description: item.description ?? '',
      category: item.category ?? '',
      productType: item.productType ?? '',
      itemType: item.itemType ?? '',
      isMisc: bool(item.isMisc),
      serviceable: bool(item.serviceable),
      hasVariants: bool(item.hasVariants),
      isActive: bool(item.isActive),
      baseUnit: item.unitConfig?.baseUnit ?? item.unitOfMeasure ?? '',
      altUnits: (item.unitConfig?.alternateUnits ?? []).map((u) => `${u.unitCode}:${u.factorToBase}`).join(', '),
      industryType: item.industryClassification?.industryType ?? item.industryFlags?.industryType ?? '',
      isHighValue: bool(item.industryClassification?.isHighValue ?? item.industryFlags?.isHighValue),
      requiresBatch: bool(item.industryFlags?.requiresBatchTracking),
      requiresSerial: bool(item.industryFlags?.requiresSerialTracking),
      serialOptional: bool(item.industryFlags?.serialOptional),
      hasExpiry: bool(item.industryFlags?.hasExpiryDate),
      isPerishable: bool(item.industryFlags?.isPerishable),
      costPrice: item.costPrice ?? '',
      sellingPrice: item.sellingPrice ?? '',
      margin: item.margin ?? '',
      weight: item.weight ? `${item.weight.value} ${item.weight.unit}` : '',
      dims: item.dimensions ? `${item.dimensions.length}×${item.dimensions.width}×${item.dimensions.height} ${item.dimensions.unit}` : '',
      tags: (item.tags ?? []).join(', '),
      barcode: item.barcode ?? '',
      createdBy: item.createdBy?.name ?? '',
      createdAt: item.createdAt ? new Date(item.createdAt).toLocaleString() : '',
      updatedBy: item.updatedBy?.name ?? '',
      updatedAt: item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '',
    });
    if (i % 2 === 1) {
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STRIPE_FILL } };
      });
    }
  });
  productsSheet.autoFilter = { from: 'A1', to: { row: 1, column: productsSheet.columns.length } };
  applyListValidation(productsSheet, 'productType', PRODUCT_TYPE_OPTIONS, items.length + 1);
  applyListValidation(productsSheet, 'itemType', ITEM_TYPE_OPTIONS, items.length + 1);
  applyListValidation(productsSheet, 'industryType', INDUSTRY_TYPE_OPTIONS, items.length + 1);
  for (const key of ['isMisc', 'serviceable', 'hasVariants', 'isActive', 'isHighValue', 'requiresBatch', 'requiresSerial', 'serialOptional', 'hasExpiry', 'isPerishable']) {
    applyListValidation(productsSheet, key, YES_NO, items.length + 1);
  }
  autoFitColumns(productsSheet);

  // ── Variants sheet ───────────────────────────────────────────────────────────────
  const variantsSheet = workbook.addWorksheet('Variants', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { tabColor: { argb: '2E7D32' } },
  });
  variantsSheet.columns = [
    { header: 'Product Name', key: 'productName' },
    { header: 'Variant SKU', key: 'sku' },
    { header: 'Variant Name', key: 'variantName' },
    { header: 'Default Variant', key: 'isDefault' },
    { header: 'Barcode', key: 'barcode' },
    { header: 'HSN', key: 'hsn' },
    { header: 'Unit Override', key: 'unitOverride' },
    { header: 'Cost Price', key: 'costPrice' },
    { header: 'Selling Price', key: 'sellingPrice' },
    { header: 'MRP', key: 'mrp' },
    { header: 'Tax %', key: 'tax' },
    { header: 'Reorder Level', key: 'reorderLevel' },
    { header: 'Min Stock', key: 'minStock' },
    { header: 'Max Stock', key: 'maxStock' },
    { header: 'Allow Backorder', key: 'allowBackorder' },
    { header: 'Serial Tracked (override)', key: 'trackSerial' },
    { header: 'Batch Tracked (override)', key: 'trackBatch' },
    { header: 'Serial Optional (override)', key: 'serialOptional' },
    { header: 'Discontinued', key: 'isDiscontinued' },
    { header: 'Serviceable', key: 'serviceable' },
    { header: 'Weight Override', key: 'weightOverride' },
    { header: 'Dimensions Override (L×W×H)', key: 'dimsOverride' },
    { header: 'Pack Size', key: 'packSize' },
    { header: 'Units Per Box', key: 'unitsPerBox' },
    { header: 'Shelf Life (days)', key: 'shelfLife' },
    { header: 'Active', key: 'isActive' },
    { header: 'Created At', key: 'createdAt' },
    { header: 'Updated At', key: 'updatedAt' },
  ];
  styleHeaderRow(variantsSheet.getRow(1));

  let productStripe = false;
  for (const item of items) {
    const itemVariants = variantsByItemId.get(item.id) ?? [];
    productStripe = !productStripe;
    for (const v of itemVariants) {
      const row = variantsSheet.addRow({
        productName: item.name ?? '',
        sku: v.code ?? v.sku ?? '',
        variantName: v.name ?? '',
        isDefault: bool(v.isDefault),
        barcode: v.barcode ?? '',
        hsn: v.hsn ?? '',
        unitOverride: v.usesMasterUnitConfig ? '' : (v.unitOfMeasureOverride ?? ''),
        costPrice: v.costPriceOverride ?? '',
        sellingPrice: v.sellingPriceOverride ?? '',
        mrp: v.mrpOverride ?? '',
        tax: v.taxOverride ?? '',
        reorderLevel: v.reorderLevel ?? '',
        minStock: v.minStock ?? '',
        maxStock: v.maxStock ?? '',
        allowBackorder: bool(v.allowBackorder),
        trackSerial: bool(v.trackSerialOverride),
        trackBatch: bool(v.trackBatchOverride),
        serialOptional: bool(v.serialOptionalOverride),
        isDiscontinued: bool(v.isDiscontinued),
        serviceable: bool(v.serviceable),
        weightOverride: v.weightOverride ?? '',
        dimsOverride: v.dimensionsOverride
          ? `${v.dimensionsOverride.length ?? ''}×${v.dimensionsOverride.width ?? ''}×${v.dimensionsOverride.height ?? ''}`
          : '',
        packSize: v.packSize ?? '',
        unitsPerBox: v.unitsPerBox ?? '',
        shelfLife: v.shelfLifeDaysOverride ?? '',
        isActive: bool(v.isActive),
        createdAt: v.createdAt ? new Date(v.createdAt).toLocaleString() : '',
        updatedAt: v.updatedAt ? new Date(v.updatedAt).toLocaleString() : '',
      });
      // Stripe by PRODUCT (every variant of the same product shares a shade), not by row —
      // makes it visually obvious at a glance where one product's variants end and the next begin.
      if (productStripe) {
        row.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STRIPE_FILL } };
        });
      }
    }
    if (itemVariants.length === 0) {
      const row = variantsSheet.addRow({ productName: item.name ?? '', sku: '(no variants)' });
      row.getCell('sku').font = { italic: true, color: { argb: 'FF999999' } };
      if (productStripe) {
        row.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STRIPE_FILL } };
        });
      }
    }
  }
  variantsSheet.autoFilter = { from: 'A1', to: { row: 1, column: variantsSheet.columns.length } };
  for (const key of ['isDefault', 'allowBackorder', 'trackSerial', 'trackBatch', 'serialOptional', 'isDiscontinued', 'serviceable', 'isActive']) {
    applyListValidation(variantsSheet, key, YES_NO, variantsSheet.rowCount);
  }
  autoFitColumns(variantsSheet);

  return workbook;
}

export async function downloadProductsWorkbook(workbook: ExcelJS.Workbook, fileName?: string): Promise<void> {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName || `products_export_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
