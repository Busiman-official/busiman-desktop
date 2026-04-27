import { inventoryService, type InventoryItem, type InventoryVariant } from '@/services/inventory.service';
import { resolveInventoryBehavior } from '@/features/inventory/constants/productCatalog';

export interface PosResolvedLineMeta {
  variantId: string;
  itemId: string;
  sku: string;
  label: string;
  isNonStock?: boolean;
  /** MISC + stock-managed: server allows negative on hand; POS must not block checkout on zero stock. */
  allowNegativeStock?: boolean;
  /** True when serial/batch tracking applies; POS capture is Phase 2. */
  serialWarning?: boolean;
  batchWarning?: boolean;
  baseUnit: string;
  defaultSalesUnit: string;
  unitOptions: Array<{ unitCode: string; factorToBase: number }>;
}

function resolveLineUnits(item: InventoryItem, variant: InventoryVariant): {
  baseUnit: string;
  defaultSalesUnit: string;
  unitOptions: Array<{ unitCode: string; factorToBase: number }>;
} {
  const masterCfg = item.unitConfig;
  const overrideCfg = variant.unitConfigOverride;
  const useMaster = variant.usesMasterUnitConfig !== false;
  const cfg = useMaster ? masterCfg : (overrideCfg || masterCfg);
  const fallback = (variant.unitOfMeasureOverride || item.unitOfMeasure || 'pcs').trim().toLowerCase();
  const baseUnit = (cfg?.baseUnit || fallback).trim().toLowerCase();
  const alt = (cfg?.alternateUnits || [])
    .map((u) => ({
      unitCode: String(u.unitCode || '').trim().toLowerCase(),
      factorToBase: Number(u.factorToBase || 0),
      isDefaultSales: Boolean(u.isDefaultSales),
    }))
    .filter((u) => u.unitCode && Number.isFinite(u.factorToBase) && u.factorToBase > 0 && u.unitCode !== baseUnit);
  const unitOptions = [{ unitCode: baseUnit, factorToBase: 1 }, ...alt.map((u) => ({ unitCode: u.unitCode, factorToBase: u.factorToBase }))];
  const salesDefault = alt.find((u) => u.isDefaultSales)?.unitCode || variant.unitOfMeasureOverride?.trim().toLowerCase() || baseUnit;
  return { baseUnit, defaultSalesUnit: salesDefault, unitOptions };
}

function serialBatchWarnings(item: InventoryItem, v: InventoryVariant): { serial?: boolean; batch?: boolean } {
  const serial =
    item.industryFlags?.requiresSerialTracking === true || v.trackSerialOverride === true;
  const batch =
    item.industryFlags?.requiresBatchTracking === true || v.trackBatchOverride === true;
  if (!serial && !batch) return {};
  return { ...(serial ? { serial: true } : {}), ...(batch ? { batch: true } : {}) };
}

/** POS stock policy for an item (variant picker, scan, cart meta). */
export function posLineStockFlagsFromItem(item: InventoryItem): {
  isNonStock: boolean;
  allowNegativeStock: boolean;
} {
  const behavior = resolveInventoryBehavior({
    productType: item.productType,
    isMisc: item.isMisc,
    itemType: item.itemType,
  });
  return {
    isNonStock: behavior.ledgerOnly,
    allowNegativeStock: behavior.allowNegativeCandidate,
  };
}

/**
 * Resolve barcode scan to a variant + display flags for POS lines.
 */
export async function resolveBarcodeForPos(barcode: string): Promise<PosResolvedLineMeta | null> {
  const trimmed = barcode.trim();
  if (!trimmed) return null;
  try {
    const item = await inventoryService.getItemByBarcode(trimmed);
    let variantId = item.variantId;
    let variant: InventoryVariant | null = null;
    if (!variantId) {
      const variants = await inventoryService.getVariantsByItem(item.id);
      variant = variants.find((v) => v.isDefault) || variants[0] || null;
      if (!variant) return null;
      variantId = variant.id;
    } else {
      variant = await inventoryService.getVariantById(variantId);
    }
    const fullItem = item.industryFlags ? item : await inventoryService.getItemById(item.id);
    const w = serialBatchWarnings(fullItem, variant);
    const flags = posLineStockFlagsFromItem(fullItem);
    const sku =
      (variant.sku || variant.code || '').trim() || fullItem.displaySku?.trim() || fullItem.sku?.trim() || '';
    return {
      variantId,
      itemId: item.id,
      sku,
      label: `${item.name} - ${variant.name}`,
      isNonStock: flags.isNonStock,
      allowNegativeStock: flags.allowNegativeStock,
      serialWarning: w.serial,
      batchWarning: w.batch,
      ...resolveLineUnits(fullItem, variant),
    };
  } catch {
    return null;
  }
}

/**
 * Build line meta from a chosen item + variant (e.g. search pick).
 */
export function buildLineMetaFromItemVariant(
  item: InventoryItem,
  variant: InventoryVariant
): PosResolvedLineMeta {
  const w = serialBatchWarnings(item, variant);
  const flags = posLineStockFlagsFromItem(item);
  const sku = (variant.sku || variant.code || '').trim() || item.displaySku?.trim() || item.sku?.trim() || '';
  return {
    variantId: variant.id,
    itemId: item.id,
    sku,
    label: `${item.name} - ${variant.name}`,
    isNonStock: flags.isNonStock,
    allowNegativeStock: flags.allowNegativeStock,
    serialWarning: w.serial,
    batchWarning: w.batch,
    ...resolveLineUnits(item, variant),
  };
}

/** Resolve a variant id (e.g. from an order line) to POS line meta for cart hydration. */
export async function resolveVariantIdForPos(variantId: string): Promise<PosResolvedLineMeta | null> {
  if (!variantId?.trim()) return null;
  try {
    const variant = await inventoryService.getVariantById(variantId.trim());
    const item = await inventoryService.getItemById(variant.itemId);
    return buildLineMetaFromItemVariant(item, variant);
  } catch {
    return null;
  }
}
