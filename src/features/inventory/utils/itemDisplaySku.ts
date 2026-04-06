import type { InventoryItem } from "@/services/inventory.service";

/** Minimal variant shape for resolving a display SKU (grid options, serial joins, etc.). */
export type VariantSkuLike = {
  isDefault?: boolean;
  sku?: string;
  code?: string;
};

/**
 * Label for pickers and lists: default variant SKU when available, else legacy item.sku.
 */
export function itemDisplaySku(
  item: Pick<InventoryItem, "displaySku" | "sku" | "name">,
  variants?: VariantSkuLike[],
): string {
  if (item.displaySku) return item.displaySku;
  if (variants && variants.length > 0) {
    const def = variants.find((v) => v.isDefault) || variants[0];
    return def.sku || def.code || item.sku || "—";
  }
  return item.sku || "—";
}

/** Prefer variant code from serial payload; falls back to nested item sku. */
export function serialLineSku(serial: {
  variant?: { code?: string };
  item?: { sku?: string };
}): string {
  return serial.variant?.code || serial.item?.sku || "—";
}
