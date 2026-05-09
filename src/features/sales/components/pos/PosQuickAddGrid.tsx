import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  inventoryService,
  type InventoryItem,
  type InventoryVariant,
} from '@/services/inventory.service';
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
  onActivateProduct: (
    item: InventoryItem,
    variants: InventoryVariant[],
    options?: { highlightVariantId?: string }
  ) => void | Promise<void>;
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

/** Sum available qty per item for the POS location (one HTTP call vs N× getStockByItem). */
async function stockTotalsByItemForLocation(locationId: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const stockRows = await inventoryService.getStockByLocation(locationId);
    for (const row of stockRows) {
      const iid = row.item?.id || row.itemId;
      if (!iid) continue;
      const q = Number(row.availableQuantity) || 0;
      map.set(iid, (map.get(iid) || 0) + q);
    }
  } catch {
    /* keep empty map */
  }
  return map;
}

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
  const [refreshing, setRefreshing] = useState(false);
  const [activatingKey, setActivatingKey] = useState<string | null>(null);

  const rowsRef = useRef<GridRow[]>([]);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const variantsCacheRef = useRef<Map<string, InventoryVariant[]>>(new Map());
  useEffect(() => {
    variantsCacheRef.current.clear();
  }, [branchId, salesPointId, categoryChip, inStockOnly]);

  const refreshTokenRef = useRef(refreshToken);
  refreshTokenRef.current = refreshToken;

  const lastHandledRefreshRef = useRef<number | string | undefined>(undefined);

  const gridStructureKey = `${branchId}|${salesPointId}|${categoryChip}|${inStockOnly}`;
  const prevStructureKeyRef = useRef<string | null>(null);

  const getVariantsCached = async (itemId: string): Promise<InventoryVariant[]> => {
    const cache = variantsCacheRef.current;
    const hit = cache.get(itemId);
    if (hit) return hit;
    const variants = await inventoryService.getVariantsByItem(itemId);
    cache.set(itemId, variants);
    return variants;
  };

  const applyInStockFilter = useCallback((list: GridRow[]): GridRow[] => {
    let out = list;
    if (inStockOnly) out = out.filter((r) => r.stock > 0);
    return out.slice(0, 32);
  }, [inStockOnly]);

  const softRefresh = useCallback(async () => {
    if (!salesPointId) return;
    const prev = rowsRef.current;
    if (prev.length === 0) return;

    setRefreshing(true);
    try {
      const stockMap = locationId ? await stockTotalsByItemForLocation(locationId) : new Map();
      const updated = await Promise.all(
        prev.map(async (row): Promise<GridRow> => {
          const stock = stockMap.get(row.item.id) ?? 0;
          if (row.kind === 'single') {
            const pr = await resolvePrice(row.variant.id, {
              salesPointId,
              customerId: customerId || undefined,
            });
            return { ...row, stock, price: pr.price };
          }
          const priceResults = await Promise.all(
            row.variants.map((v) =>
              resolvePrice(v.id, { salesPointId, customerId: customerId || undefined })
            )
          );
          const nums = priceResults.map((p) => p.price);
          return {
            ...row,
            stock,
            minPrice: Math.min(...nums),
            maxPrice: Math.max(...nums),
          };
        })
      );
      setRows(applyInStockFilter(updated));
    } finally {
      setRefreshing(false);
    }
  }, [applyInStockFilter, customerId, locationId, resolvePrice, salesPointId]);

  const loadFullGrid = useCallback(async () => {
    if (!salesPointId) {
      setRows([]);
      lastHandledRefreshRef.current = refreshTokenRef.current;
      prevStructureKeyRef.current = gridStructureKey;
      return;
    }

    const isFirstStructure = prevStructureKeyRef.current === null;
    const structureChanged = !isFirstStructure && prevStructureKeyRef.current !== gridStructureKey;
    prevStructureKeyRef.current = gridStructureKey;

    if (structureChanged) {
      setRows([]);
    }

    const blocking = structureChanged ? true : rowsRef.current.length === 0;
    if (blocking) setLoading(true);
    else setRefreshing(true);

    try {
      const [items, stockMap] = await Promise.all([
        inventoryService.getAllItems({
          branchId,
          isActive: true,
          excludeNonStock: true,
          ...(categoryChip ? { category: categoryChip } : {}),
        }),
        locationId ? stockTotalsByItemForLocation(locationId) : Promise.resolve(new Map<string, number>()),
      ]);

      const stockProducts = items.filter((item) => item.isMisc !== true);
      const slice = stockProducts.slice(0, 40);

      const built = await Promise.all(
        slice.map(async (item): Promise<GridRow | null> => {
          try {
            const variants = await getVariantsCached(item.id);
            const useVariants = variants.filter((v) => v.isActive !== false);
            const list = useVariants.length > 0 ? useVariants : variants;
            if (list.length === 0) return null;

            const stock = stockMap.get(item.id) ?? 0;

            if (list.length === 1) {
              const v = list[0];
              const pr = await resolvePrice(v.id, {
                salesPointId,
                customerId: customerId || undefined,
              });
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
              list.map((v) =>
                resolvePrice(v.id, { salesPointId, customerId: customerId || undefined })
              )
            );
            const nums = priceResults.map((p) => p.price);
            return {
              kind: 'multi',
              item,
              variants: list,
              minPrice: Math.min(...nums),
              maxPrice: Math.max(...nums),
              stock,
            };
          } catch {
            return null;
          }
        })
      );

      let list = built.filter((x): x is GridRow => x !== null);
      setRows(applyInStockFilter(list));
    } catch {
      setRows([]);
    } finally {
      if (blocking) setLoading(false);
      else setRefreshing(false);
      lastHandledRefreshRef.current = refreshTokenRef.current;
    }
  }, [applyInStockFilter, branchId, categoryChip, customerId, gridStructureKey, locationId, resolvePrice, salesPointId]);

  useEffect(() => {
    void loadFullGrid();
  }, [loadFullGrid]);

  useEffect(() => {
    if (refreshToken === undefined) return;
    if (!salesPointId) return;
    if (rowsRef.current.length === 0) return;
    if (lastHandledRefreshRef.current === refreshToken) return;
    lastHandledRefreshRef.current = refreshToken;
    void softRefresh();
  }, [refreshToken, salesPointId, softRefresh]);

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

  const showInitialSpinner = loading && rows.length === 0;
  const busy = showInitialSpinner || (refreshing && rows.length === 0);

  return (
    <div className="pos-quick-add">
      <div
        className={`pos-quick-add__grid${refreshing && rows.length > 0 ? ' pos-quick-add__grid--refreshing' : ''}`}
        aria-busy={busy || (refreshing && rows.length > 0)}
      >
        {showInitialSpinner ? (
          <p className="pos-quick-add__hint">Loading products…</p>
        ) : (
          rows.map((row) => {
            const key = row.kind === 'single' ? row.variant.id : row.item.id;
            const cardBusy = activatingKey === key;
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
                disabled={disabled || cardBusy}
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
