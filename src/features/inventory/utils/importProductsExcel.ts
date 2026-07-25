/**
 * Bulk product upload — reads the two-sheet workbook produced by exportProductsExcel.ts
 * ("Products" = master fields, "Variants" = per-SKU fields, joined by "Product Name") and turns
 * it into an upsert plan: a product whose Name matches an existing one is updated in place (and
 * its variants matched/updated by SKU, new SKUs added) — no Product ID column needed anywhere,
 * matching is by name/SKU. A product whose Name has no match is created fresh.
 */
import ExcelJS from 'exceljs';
import {
  IndustryType,
  ItemType,
  ProductType,
  type CreateInventoryItemRequest,
  type CreateInventoryVariantLine,
  type CreateVariantRequest,
  type InventoryItem,
  type InventoryVariant,
  type UpdateInventoryItemRequest,
  type UpdateVariantRequest,
} from '@/services/inventory.service';

export interface ProductImportRowError {
  row: number;
  productName: string;
  message: string;
}

interface ParsedVariantRow {
  row: number;
  sku: string;
  line: CreateInventoryVariantLine;
}

interface ParsedProductGroup {
  productName: string;
  row: number;
  itemFields: Omit<CreateInventoryItemRequest, 'variants'>;
  variants: ParsedVariantRow[];
}

export interface ProductImportParseResult {
  groups: ParsedProductGroup[];
  errors: ProductImportRowError[];
}

/** One product's worth of API calls to run, resolved against the live catalog. */
export type ProductImportPlan =
  | { action: 'create'; productName: string; row: number; request: CreateInventoryItemRequest }
  | {
      action: 'update';
      productName: string;
      row: number;
      itemId: string;
      itemUpdate: UpdateInventoryItemRequest;
      variantUpdates: Array<{ variantId: string; sku: string; update: UpdateVariantRequest }>;
      variantCreates: Array<{ sku: string; request: CreateVariantRequest }>;
    };

export interface ProductImportResult {
  productsCreated: number;
  productsUpdated: number;
  variantsCreated: number;
  variantsUpdated: number;
  errors: ProductImportRowError[];
}

function toBool(value: ExcelJS.CellValue): boolean {
  const s = String(value ?? '').trim().toLowerCase();
  return s === 'yes' || s === 'true' || s === '1' || s === 'y';
}

function toNum(value: ExcelJS.CellValue): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function toStr(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'text' in (value as any)) return String((value as any).text ?? '').trim();
  return String(value).trim();
}

const INDUSTRY_TYPES = new Set<string>(Object.values(IndustryType));
const PRODUCT_TYPES = new Set<string>(Object.values(ProductType));
const ITEM_TYPES = new Set<string>(Object.values(ItemType));

/** Maps a sheet's header row (row 1) to column index by header text — order-independent. */
function headerIndex(sheet: ExcelJS.Worksheet): Map<string, number> {
  const map = new Map<string, number>();
  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell, colNumber) => {
    map.set(toStr(cell.value), colNumber);
  });
  return map;
}

function cellAt(row: ExcelJS.Row, headers: Map<string, number>, name: string): ExcelJS.CellValue {
  const idx = headers.get(name);
  if (idx == null) return null;
  return row.getCell(idx).value;
}

export async function parseProductsWorkbook(buffer: ArrayBuffer): Promise<ProductImportParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const productsSheet = workbook.getWorksheet('Products');
  const variantsSheet = workbook.getWorksheet('Variants');
  const errors: ProductImportRowError[] = [];

  if (!productsSheet || !variantsSheet) {
    return {
      groups: [],
      errors: [
        {
          row: 0,
          productName: '',
          message: 'This file is missing the "Products" and/or "Variants" sheet — use the exported template.',
        },
      ],
    };
  }

  const productHeaders = headerIndex(productsSheet);
  const itemFieldsByName = new Map<string, { row: number; fields: Omit<CreateInventoryItemRequest, 'variants'> }>();
  productsSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const name = toStr(cellAt(row, productHeaders, 'Product Name'));
    if (!name) return;

    const industryTypeRaw = toStr(cellAt(row, productHeaders, 'Industry Type')).toLowerCase();
    const productTypeRaw = toStr(cellAt(row, productHeaders, 'Product Type')).toUpperCase();
    const itemTypeRaw = toStr(cellAt(row, productHeaders, 'Item Type')).toUpperCase();
    const weightVal = toNum(cellAt(row, productHeaders, 'Weight'));
    const dimsRaw = toStr(cellAt(row, productHeaders, 'Dimensions (L×W×H)'));
    const dimsMatch = dimsRaw.match(/^([\d.]+)\D+([\d.]+)\D+([\d.]+)\s*(.*)$/);
    const tagsRaw = toStr(cellAt(row, productHeaders, 'Tags'));

    itemFieldsByName.set(name, {
      row: rowNumber,
      fields: {
        name,
        description: toStr(cellAt(row, productHeaders, 'Description')) || undefined,
        category: toStr(cellAt(row, productHeaders, 'Category')) || undefined,
        productType: PRODUCT_TYPES.has(productTypeRaw) ? (productTypeRaw as ProductType) : undefined,
        itemType: ITEM_TYPES.has(itemTypeRaw) ? (itemTypeRaw as ItemType) : undefined,
        isMisc: toBool(cellAt(row, productHeaders, 'Is Misc')),
        serviceable: toBool(cellAt(row, productHeaders, 'Serviceable (default)')),
        unitOfMeasure: toStr(cellAt(row, productHeaders, 'Base Unit')) || undefined,
        industryFlags: {
          industryType: INDUSTRY_TYPES.has(industryTypeRaw) ? (industryTypeRaw as IndustryType) : IndustryType.WAREHOUSE,
          isHighValue: toBool(cellAt(row, productHeaders, 'High Value')),
          requiresBatchTracking: toBool(cellAt(row, productHeaders, 'Batch Tracked')),
          requiresSerialTracking: toBool(cellAt(row, productHeaders, 'Serial Tracked')),
          serialOptional: toBool(cellAt(row, productHeaders, 'Serial Optional')),
          hasExpiryDate: toBool(cellAt(row, productHeaders, 'Has Expiry')),
          isPerishable: toBool(cellAt(row, productHeaders, 'Perishable')),
        },
        weight: weightVal != null ? { value: weightVal, unit: toStr(cellAt(row, productHeaders, 'Weight')).replace(/[\d.\s]/g, '') || 'kg' } : undefined,
        dimensions: dimsMatch
          ? { length: Number(dimsMatch[1]), width: Number(dimsMatch[2]), height: Number(dimsMatch[3]), unit: dimsMatch[4] || 'cm' }
          : undefined,
        tags: tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      },
    });
  });

  const variantHeaders = headerIndex(variantsSheet);
  if (!variantHeaders.has('Product Name') || !variantHeaders.has('Variant SKU')) {
    return {
      groups: [],
      errors: [
        {
          row: 0,
          productName: '',
          message: 'The "Variants" sheet is missing the "Product Name" and/or "Variant SKU" columns.',
        },
      ],
    };
  }

  const groupsByName = new Map<string, ParsedProductGroup>();

  variantsSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const productName = toStr(cellAt(row, variantHeaders, 'Product Name'));
    const sku = toStr(cellAt(row, variantHeaders, 'Variant SKU'));
    if (!productName && !sku) return; // blank row

    if (!productName) {
      errors.push({ row: rowNumber, productName: '', message: 'Missing Product Name' });
      return;
    }
    if (!sku || sku === '(no variants)') {
      return; // placeholder row for a variant-less product, or genuinely blank SKU
    }

    const productMeta = itemFieldsByName.get(productName);
    if (!productMeta) {
      errors.push({
        row: rowNumber,
        productName,
        message: 'No matching row for this product on the "Products" sheet — add one first.',
      });
      return;
    }

    const variantLine: CreateInventoryVariantLine = {
      sku,
      name: toStr(cellAt(row, variantHeaders, 'Variant Name')) || productName,
      isDefault: toBool(cellAt(row, variantHeaders, 'Default Variant')),
      barcode: toStr(cellAt(row, variantHeaders, 'Barcode')) || undefined,
      hsn: toStr(cellAt(row, variantHeaders, 'HSN')) || undefined,
      unitOfMeasure: toStr(cellAt(row, variantHeaders, 'Unit Override')) || undefined,
      costPrice: toNum(cellAt(row, variantHeaders, 'Cost Price')),
      sellingPrice: toNum(cellAt(row, variantHeaders, 'Selling Price')),
      mrp: toNum(cellAt(row, variantHeaders, 'MRP')),
      tax: toNum(cellAt(row, variantHeaders, 'Tax %')),
      reorderLevel: toNum(cellAt(row, variantHeaders, 'Reorder Level')),
      minStock: toNum(cellAt(row, variantHeaders, 'Min Stock')),
      maxStock: toNum(cellAt(row, variantHeaders, 'Max Stock')),
      allowBackorder: toBool(cellAt(row, variantHeaders, 'Allow Backorder')),
      trackSerialOverride: toBool(cellAt(row, variantHeaders, 'Serial Tracked (override)')),
      trackBatchOverride: toBool(cellAt(row, variantHeaders, 'Batch Tracked (override)')),
      serialOptionalOverride: toBool(cellAt(row, variantHeaders, 'Serial Optional (override)')),
      serviceable: toBool(cellAt(row, variantHeaders, 'Serviceable')),
      weightOverride: toNum(cellAt(row, variantHeaders, 'Weight Override')),
      packSize: toNum(cellAt(row, variantHeaders, 'Pack Size')),
      unitsPerBox: toNum(cellAt(row, variantHeaders, 'Units Per Box')),
      shelfLifeDaysOverride: toNum(cellAt(row, variantHeaders, 'Shelf Life (days)')),
    };

    const existingGroup = groupsByName.get(productName);
    if (existingGroup) {
      existingGroup.variants.push({ row: rowNumber, sku, line: variantLine });
      return;
    }

    groupsByName.set(productName, {
      productName,
      row: productMeta.row,
      itemFields: productMeta.fields,
      variants: [{ row: rowNumber, sku, line: variantLine }],
    });
  });

  return { groups: Array.from(groupsByName.values()), errors };
}

/**
 * Resolves parsed groups against the live catalog: a product name that already exists becomes an
 * "update" plan (item fields updated, variants matched/updated by SKU or created if new); a name
 * with no match becomes a "create" plan. Case-insensitive matching on both name and SKU.
 */
export function buildImportPlan(
  parsed: ProductImportParseResult,
  existingItems: InventoryItem[],
  existingVariantsByItemId: Map<string, InventoryVariant[]>,
): { plans: ProductImportPlan[]; errors: ProductImportRowError[] } {
  const errors = [...parsed.errors];
  const itemByNameLower = new Map<string, InventoryItem>();
  for (const item of existingItems) {
    itemByNameLower.set((item.name ?? '').trim().toLowerCase(), item);
  }
  const skuToItemAndVariant = new Map<string, { item: InventoryItem; variant: InventoryVariant }>();
  for (const item of existingItems) {
    for (const v of existingVariantsByItemId.get(item.id) ?? []) {
      const sku = (v.code || v.sku || '').trim().toUpperCase();
      if (sku) skuToItemAndVariant.set(sku, { item, variant: v });
    }
  }

  const plans: ProductImportPlan[] = [];

  for (const group of parsed.groups) {
    const existingItem = itemByNameLower.get(group.productName.trim().toLowerCase());

    if (!existingItem) {
      // Brand new product — every variant SKU must also be new; if one collides with a SKU
      // that belongs to a *different* existing product, that's a real conflict, not an update.
      const conflict = group.variants.find((v) => skuToItemAndVariant.has(v.sku.trim().toUpperCase()));
      if (conflict) {
        errors.push({
          row: conflict.row,
          productName: group.productName,
          message: `SKU "${conflict.sku}" already belongs to another product ("${skuToItemAndVariant.get(conflict.sku.trim().toUpperCase())!.item.name}") — fix the SKU or the Product Name.`,
        });
        continue;
      }
      plans.push({
        action: 'create',
        productName: group.productName,
        row: group.row,
        request: { ...group.itemFields, variants: group.variants.map((v) => v.line) },
      });
      continue;
    }

    const existingVariantsForItem = existingVariantsByItemId.get(existingItem.id) ?? [];
    const variantBySkuUpper = new Map(
      existingVariantsForItem.map((v) => [(v.code || v.sku || '').trim().toUpperCase(), v] as const),
    );

    const variantUpdates: Extract<ProductImportPlan, { action: 'update' }>['variantUpdates'] = [];
    const variantCreates: Extract<ProductImportPlan, { action: 'update' }>['variantCreates'] = [];

    for (const v of group.variants) {
      const skuUpper = v.sku.trim().toUpperCase();
      const matchOnThisItem = variantBySkuUpper.get(skuUpper);
      const matchElsewhere = skuToItemAndVariant.get(skuUpper);

      if (matchElsewhere && !matchOnThisItem) {
        errors.push({
          row: v.row,
          productName: group.productName,
          message: `SKU "${v.sku}" already belongs to a different product ("${matchElsewhere.item.name}") — skipped.`,
        });
        continue;
      }

      if (matchOnThisItem) {
        const { sku: _sku, ...update } = v.line;
        variantUpdates.push({ variantId: matchOnThisItem.id, sku: v.sku, update });
      } else {
        const { sku: _sku, ...rest } = v.line;
        variantCreates.push({ sku: v.sku, request: { ...rest, code: v.sku, itemId: existingItem.id } });
      }
    }

    const { name: _name, variants: _variants, ...itemUpdate } = group.itemFields as CreateInventoryItemRequest;
    plans.push({
      action: 'update',
      productName: group.productName,
      row: group.row,
      itemId: existingItem.id,
      itemUpdate,
      variantUpdates,
      variantCreates,
    });
  }

  return { plans, errors };
}
