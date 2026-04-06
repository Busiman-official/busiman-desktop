/**
 * Canonical catalog categories and inventory behavior helpers for inventory forms.
 */

import {
  IndustryType,
  ItemType,
  ProductType,
} from '@/services/inventory.service';

export const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'electronics', label: 'Electronics' },
  { value: 'clothing', label: 'Clothing' },
  { value: 'raw_material', label: 'Raw Material' },
  { value: 'services', label: 'Services' },
  { value: 'packaging', label: 'Packaging' },
  { value: 'spare_parts', label: 'Spare Parts' },
  { value: 'general', label: 'General' },
];

export const PRODUCT_TYPE_OPTIONS: { value: ProductType; label: string }[] = [
  { value: ProductType.STOCK_ITEM, label: 'Stock Item' },
  { value: ProductType.NON_STOCK_ITEM, label: 'Non-Stock Item' },
  { value: ProductType.ASSET, label: 'Asset' },
];

export function normalizeCategoryKey(raw: string): string {
  const t = raw.trim().toLowerCase().replace(/\s+/g, '_');
  if (t === 'raw' || t === 'rawmaterial') return 'raw_material';
  if (t === 'spare' || t === 'spareparts') return 'spare_parts';
  return t;
}

export function getCategoryHint(categoryKey: string): string {
  const k = normalizeCategoryKey(categoryKey);
  const hints: Record<string, string> = {
    electronics: 'Electronics catalog grouping for reporting and search.',
    clothing: 'Apparel grouping for reporting and search.',
    raw_material: 'Manufacturing/raw material grouping.',
    services: 'Service grouping for reporting; stock behavior is controlled separately.',
    packaging: 'Packaging and consumables grouping.',
    spare_parts: 'Spare parts grouping for reporting and search.',
    general: 'General catalog grouping.',
  };
  return hints[k] || '';
}

export function getProductTypeHint(productType: ProductType): string {
  switch (productType) {
    case ProductType.NON_STOCK_ITEM:
      return 'No inventory tracking. This item affects ledger/accounting only.';
    case ProductType.ASSET:
      return 'Long-term business asset. Tracked but not for sale.';
    case ProductType.STOCK_ITEM:
    default:
      return 'Inventory is tracked. Stock increases on receipt and decreases on sale.';
  }
}

export type ResolvedInventoryBehavior = {
  productType: ProductType;
  isMisc: boolean;
  itemType: ItemType;
  stockManaged: boolean;
  ledgerOnly: boolean;
  allowNegativeCandidate: boolean;
  isAsset: boolean;
  trackingAllowed: boolean;
  helperText: string;
};

export function normalizeProductType(value?: ProductType | string): ProductType {
  switch (value) {
    case ProductType.NON_STOCK_ITEM:
      return ProductType.NON_STOCK_ITEM;
    case ProductType.ASSET:
      return ProductType.ASSET;
    case ProductType.STOCK_ITEM:
    default:
      return ProductType.STOCK_ITEM;
  }
}

export function resolveInventoryBehavior(input: {
  productType?: ProductType | string;
  isMisc?: boolean;
  itemType?: ItemType | string;
}): ResolvedInventoryBehavior {
  const productType = normalizeProductType(input.productType);
  const isMisc = input.isMisc ?? false;

  const isAsset = productType === ProductType.ASSET;
  const stockManaged = !isAsset && productType === ProductType.STOCK_ITEM;

  const itemType = isMisc
    ? (stockManaged ? ItemType.MISC_INVENTORY : ItemType.MISC_NON_STOCK)
    : (stockManaged ? ItemType.STOCK : ItemType.MISC_NON_STOCK);

  const ledgerOnly = !stockManaged;
  const allowNegativeCandidate = isMisc && stockManaged;
  const trackingAllowed = stockManaged && !isMisc;

  let helperText = '';
  if (isAsset) {
    helperText = 'This item is tracked as an asset, not regular inventory';
  } else if (ledgerOnly || (isMisc && !stockManaged)) {
    helperText = 'This item is ledger-only';
  }

  return {
    productType,
    isMisc,
    itemType,
    stockManaged,
    ledgerOnly,
    allowNegativeCandidate,
    isAsset,
    trackingAllowed,
    helperText,
  };
}

export type CategoryPreset = Partial<{
  industryType: IndustryType;
  requiresBatchTracking: boolean;
  requiresSerialTracking: boolean;
  hasExpiryDate: boolean;
  category: string;
}>;

export function getPresetForCategory(categoryValue: string): CategoryPreset {
  const k = normalizeCategoryKey(categoryValue);
  switch (k) {
    case 'electronics':
      return { category: 'electronics', industryType: IndustryType.ELECTRONICS };
    case 'clothing':
      return { category: 'clothing', industryType: IndustryType.FMCG };
    case 'raw_material':
      return { category: 'raw_material', industryType: IndustryType.MANUFACTURING };
    case 'services':
      return { category: 'services' };
    case 'packaging':
      return { category: 'packaging', industryType: IndustryType.WAREHOUSE };
    case 'spare_parts':
      return { category: 'spare_parts', industryType: IndustryType.MANUFACTURING };
    case 'general':
      return { category: 'general' };
    default:
      return { category: categoryValue.trim() };
  }
}
