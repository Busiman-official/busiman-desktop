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

/**
 * Movement / transfer line item picker: avoids "— - ProductName" when master SKU is empty
 * but default variant code exists (API `displaySku` or loaded `variants`).
 */
export function movementItemPickerLabel(
  item: Pick<InventoryItem, "displaySku" | "sku" | "name" | "hasVariants">,
  variants?: VariantSkuLike[],
): string {
  const name = (item.name || "").trim() || "Unnamed product";
  const fromApi = item.displaySku?.trim();
  if (fromApi) return `${fromApi} · ${name}`;
  if (variants && variants.length > 0) {
    const def = variants.find((v) => v.isDefault) || variants[0];
    const code = (def.code || def.sku || "").trim();
    if (code) return `${code} · ${name}`;
  }
  const legacy = item.sku?.trim();
  if (legacy) return `${legacy} · ${name}`;
  return name;
}

/** Prefer variant code from serial payload; falls back to nested item sku. */
export function serialLineSku(serial: {
  variant?: { code?: string };
  item?: { sku?: string };
}): string {
  return serial.variant?.code || serial.item?.sku || "—";
}
