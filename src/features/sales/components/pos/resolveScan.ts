import { inventoryService, type InventoryItem, type InventoryVariant } from '@/services/inventory.service';

export interface PosResolvedLineMeta {
  variantId: string;
  itemId: string;
  sku: string;
  label: string;
  /** True when serial/batch tracking applies — POS capture is Phase 2; see PosCartLineCard. */
  serialWarning?: boolean;
  batchWarning?: boolean;
}

function serialBatchWarnings(item: InventoryItem, v: InventoryVariant): { serial?: boolean; batch?: boolean } {
  const serial = item.industryFlags.requiresSerialTracking === true || v.trackSerialOverride === true;
  const batch = item.industryFlags.requiresBatchTracking === true || v.trackBatchOverride === true;
  if (!serial && !batch) return {};
  return { ...(serial ? { serial: true } : {}), ...(batch ? { batch: true } : {}) };
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
    return {
      variantId,
      itemId: item.id,
      sku: variant.code,
      label: `${item.name} - ${variant.name}`,
      serialWarning: w.serial,
      batchWarning: w.batch,
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
  return {
    variantId: variant.id,
    itemId: item.id,
    sku: variant.code,
    label: `${item.name} - ${variant.name}`,
    serialWarning: w.serial,
    batchWarning: w.batch,
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
