import {
  inventoryService,
  type CatalogVariantRow,
  type InventoryItem,
  type InventoryVariant,
} from '@/services/inventory.service';

export type PurchaseDraftLineSeed = {
  variantId: string;
  itemId: string;
  productName: string;
  variantName: string;
  sku: string;
  quantityOrdered: number;
  unitId: string;
  unitOptions: PurchaseLineUnitOption[];
  expectedPrice: number;
  taxPercent: number;
  discountPercent: number;
};

export type PurchaseLineUnitOption = {
  unitCode: string;
  factorToBase: number;
};

export function resolvePurchaseLineUnits(
  item: InventoryItem,
  variant: InventoryVariant
): { defaultPurchaseUnit: string; unitOptions: PurchaseLineUnitOption[] } {
  const masterCfg = item.unitConfig;
  const overrideCfg = variant.unitConfigOverride;
  const useMaster = variant.usesMasterUnitConfig !== false;
  const cfg = useMaster ? masterCfg : overrideCfg || masterCfg;
  const fallback = (variant.unitOfMeasureOverride || item.unitOfMeasure || 'pcs').trim().toLowerCase();
  const baseUnit = (cfg?.baseUnit || fallback).trim().toLowerCase();
  const alt = (cfg?.alternateUnits || [])
    .map((u) => ({
      unitCode: String(u.unitCode || '').trim().toLowerCase(),
      factorToBase: Number(u.factorToBase || 0),
      isDefaultPurchase: Boolean(u.isDefaultPurchase),
      isActive: u.isActive !== false,
    }))
    .filter(
      (u) =>
        u.isActive &&
        u.unitCode &&
        Number.isFinite(u.factorToBase) &&
        u.factorToBase > 0 &&
        u.unitCode !== baseUnit
    );
  const unitOptions: PurchaseLineUnitOption[] = [
    { unitCode: baseUnit, factorToBase: 1 },
    ...alt.map((u) => ({ unitCode: u.unitCode, factorToBase: u.factorToBase })),
  ];
  const purchaseDefault =
    alt.find((u) => u.isDefaultPurchase)?.unitCode ||
    variant.unitOfMeasureOverride?.trim().toLowerCase() ||
    baseUnit;
  const defaultPurchaseUnit = unitOptions.some((u) => u.unitCode === purchaseDefault)
    ? purchaseDefault
    : baseUnit;
  return { defaultPurchaseUnit, unitOptions };
}

/** Cost for PO lines: variant override → product master → catalog row. */
export function resolvePurchaseUnitPrice(
  item: InventoryItem,
  variant: InventoryVariant,
  catalogCost?: number
): number {
  const variantCost = variant.costPriceOverride;
  if (variantCost != null && Number.isFinite(variantCost) && variantCost >= 0) {
    return variantCost;
  }
  const itemCost = item.costPrice;
  if (itemCost != null && Number.isFinite(itemCost) && itemCost >= 0) {
    return itemCost;
  }
  if (catalogCost != null && Number.isFinite(catalogCost) && catalogCost >= 0) {
    return catalogCost;
  }
  return 0;
}

export function catalogCostPrice(row: CatalogVariantRow): number {
  const n = row.costPrice;
  return n != null && Number.isFinite(n) && n >= 0 ? n : 0;
}

export type EnrichPurchaseLineOptions = {
  /** Keep line.expectedPrice when &gt; 0 (e.g. CSV import with explicit unit price). */
  keepExpectedPrice?: boolean;
};

export async function enrichPurchaseLine<T extends PurchaseDraftLineSeed>(
  line: T,
  catalogRow?: Pick<CatalogVariantRow, 'costPrice'>,
  options?: EnrichPurchaseLineOptions
): Promise<T> {
  const [item, variant] = await Promise.all([
    inventoryService.getItemById(line.itemId),
    inventoryService.getVariantById(line.variantId),
  ]);
  const { defaultPurchaseUnit, unitOptions } = resolvePurchaseLineUnits(item, variant);
  const unitId = unitOptions.some((u) => u.unitCode === line.unitId) ? line.unitId : defaultPurchaseUnit;
  const costFromInventory = resolvePurchaseUnitPrice(item, variant, catalogRow?.costPrice);
  const expectedPrice =
    options?.keepExpectedPrice && line.expectedPrice > 0 ? line.expectedPrice : costFromInventory;
  return { ...line, unitOptions, unitId, expectedPrice };
}
