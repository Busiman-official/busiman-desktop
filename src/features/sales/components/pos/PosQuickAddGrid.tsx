import React, { useCallback, useEffect, useState } from 'react';
import { inventoryService, type InventoryItem, type InventoryVariant } from '@/services/inventory.service';
import { usePriceResolver } from '../../hooks/usePriceResolver';
import './PosQuickAddGrid.css';

export interface PosQuickAddGridProps {
  branchId: string;
  salesPointId: string | null;
  customerId: string | null;
  locationId: string | null;
  /** Increment/change to trigger a stock refresh. */
  refreshToken?: number | string;
  disabled?: boolean;
  categoryChip: string | null;
  onCategoryChipChange: (c: string | null) => void;
  inStockOnly: boolean;
  onInStockOnlyChange: (v: boolean) => void;
  /** Single-variant adds immediately; multi-variant opens picker in parent. */
  onActivateProduct: (item: InventoryItem, variants: InventoryVariant[]) => void | Promise<void>;
}

type GridRowSingle = {
  kind: 'single';
  item: InventoryItem;
  variant: InventoryVariant;
  price: number;
  stock: number;
  label: string;
};

type GridRowMulti = {
  kind: 'multi';
  item: InventoryItem;
  variants: InventoryVariant[];
  minPrice: number;
  maxPrice: number;
  stock: number;
};

type GridRow = GridRowSingle | GridRowMulti;

export const PosQuickAddGrid: React.FC<PosQuickAddGridProps> = ({
  branchId,
  salesPointId,
  customerId,
  locationId,
  refreshToken,
  disabled,
  categoryChip,
  onCategoryChipChange: _onCategoryChipChange,
  inStockOnly,
  onInStockOnlyChange: _onInStockOnlyChange,
  onActivateProduct,
}) => {
  const resolvePrice = usePriceResolver(branchId);
  const [rows, setRows] = useState<GridRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [activatingKey, setActivatingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!salesPointId) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const items = await inventoryService.getAllItems({
        isActive: true,
        ...(categoryChip ? { category: categoryChip } : {}),
      });
      const slice = items.slice(0, 40);
      const built = await Promise.all(
        slice.map(async (item): Promise<GridRow | null> => {
          try {
            const variants = await inventoryService.getVariantsByItem(item.id);
            const useVariants = variants.filter((v) => v.isActive !== false);
            const list = useVariants.length > 0 ? useVariants : variants;
            if (list.length === 0) return null;

            let stock = 0;
            if (locationId) {
              try {
                const stockRows = await inventoryService.getStockByItem(item.id);
                stock = stockRows
                  .filter((row) => row.locationId === locationId || row.location?.id === locationId)
                  .reduce((sum, row) => sum + row.availableQuantity, 0);
              } catch {
                stock = 0;
              }
            }

            if (list.length === 1) {
              const v = list[0];
              const pr = await resolvePrice(v.id, { salesPointId, customerId: customerId || undefined });
              return {
                kind: 'single',
                item,
                variant: v,
                price: pr.price,
                stock,
                label: `${item.name} - ${v.name}`,
              };
            }

            const priceResults = await Promise.all(
              list.map((v) => resolvePrice(v.id, { salesPointId, customerId: customerId || undefined }))
            );
            const nums = priceResults.map((p) => p.price);
            const minPrice = Math.min(...nums);
            const maxPrice = Math.max(...nums);
            return {
              kind: 'multi',
              item,
              variants: list,
              minPrice,
              maxPrice,
              stock,
            };
          } catch {
            return null;
          }
        })
      );
      let list = built.filter((x): x is GridRow => x !== null);
      if (inStockOnly) list = list.filter((r) => r.stock > 0);
      setRows(list.slice(0, 32));
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [salesPointId, customerId, locationId, categoryChip, inStockOnly, resolvePrice, refreshToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCard = async (row: GridRow) => {
    if (disabled || !salesPointId) return;
    const key = row.kind === 'single' ? row.variant.id : row.item.id;
    setActivatingKey(key);
    try {
      if (row.kind === 'single') {
        await onActivateProduct(row.item, [row.variant]);
      } else {
        await onActivateProduct(row.item, row.variants);
      }
    } finally {
      setActivatingKey(null);
    }
  };

  return (
    <div className="pos-quick-add">
      <div className="pos-quick-add__grid" aria-busy={loading}>
        {loading ? (
          <p className="pos-quick-add__hint">Loading products…</p>
        ) : (
          rows.map((row) => {
            const key = row.kind === 'single' ? row.variant.id : row.item.id;
            const busy = activatingKey === key;
            const title = row.kind === 'single' ? row.item.name : row.item.name;
            const priceLabel =
              row.kind === 'single'
                ? `₹${row.price.toFixed(2)}`
                : row.minPrice === row.maxPrice
                  ? `₹${row.minPrice.toFixed(2)}`
                  : `From ₹${row.minPrice.toFixed(2)}`;

            return (
              <button
                key={key}
                type="button"
                className="pos-product-card"
                disabled={disabled || busy}
                onClick={() => handleCard(row)}
              >
                <div className="pos-product-card__head">
                  <span className="pos-product-card__name">{title}</span>
                  {row.kind === 'multi' ? (
                    <span className="pos-product-card__variants-hint">{row.variants.length} variants</span>
                  ) : null}
                </div>
                <span className="pos-product-card__price">{priceLabel}</span>
                <span className="pos-product-card__stock">Stock: {locationId ? row.stock : '—'}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
