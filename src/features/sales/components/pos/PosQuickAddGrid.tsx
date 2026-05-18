import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  inventoryService,
  catalogRows,
  ItemType,
  ProductType,
  type CatalogVariantRow,
  type InventoryItem,
  type InventoryVariant,
} from '@/services/inventory.service';
import { posLineStockFlagsFromItem } from './resolveScan';
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

function catalogRowToVariant(row: CatalogVariantRow): InventoryVariant {
  return {
    id: row.variantId,
    itemId: row.productId,
    sku: row.sku,
    code: row.sku,
    name: row.variantName,
    isDefault: row.isDefault,
    isActive: row.variantIsActive,
    sellingPriceOverride: row.sellingPrice,
    costPriceOverride: row.costPrice,
    createdAt: '',
    updatedAt: '',
  };
}

function catalogRowsToItem(rows: CatalogVariantRow[]): InventoryItem {
  const r = rows[0];
  return {
    id: r.productId,
    name: r.productName,
    category: r.category,
    hasVariants: rows.length > 1,
    isActive: r.isActive,
    productType: r.productType ?? ProductType.STOCK_ITEM,
    isMisc: r.isMisc ?? false,
    itemType: r.itemType ?? ItemType.STOCK,
    branchId: '',
    createdBy: { id: '', name: '', email: '' },
    updatedBy: { id: '', name: '', email: '' },
    createdAt: '',
    updatedAt: '',
  };
}

/** Preserve catalog row order (matches server item sort, then variant sort). */
function groupCatalogByProduct(rows: CatalogVariantRow[]): {
  productIds: string[];
  byProduct: Map<string, CatalogVariantRow[]>;
} {
  const productIds: string[] = [];
  const byProduct = new Map<string, CatalogVariantRow[]>();
  for (const row of rows) {
    if (!byProduct.has(row.productId)) {
      productIds.push(row.productId);
      byProduct.set(row.productId, []);
    }
    byProduct.get(row.productId)!.push(row);
  }
  return { productIds, byProduct };
}

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
  const { resolvePricesBatch } = usePriceResolver(branchId);
  const [rows, setRows] = useState<GridRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activatingKey, setActivatingKey] = useState<string | null>(null);

  const rowsRef = useRef<GridRow[]>([]);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const refreshTokenRef = useRef(refreshToken);
  refreshTokenRef.current = refreshToken;

  const lastHandledRefreshRef = useRef<number | string | undefined>(undefined);

  const gridStructureKey = `${branchId}|${salesPointId}|${categoryChip}|${inStockOnly}`;
  const prevStructureKeyRef = useRef<string | null>(null);

  const applyInStockFilter = useCallback((list: GridRow[]): GridRow[] => {
    let out = list;
    if (inStockOnly) {
      out = out.filter((r) => {
        const flags = posLineStockFlagsFromItem(r.item);
        return flags.isNonStock || flags.allowNegativeStock || r.stock > 0;
      });
    }
    return out.slice(0, 32);
  }, [inStockOnly]);

  const priceOpts = useCallback(
    () => ({
      salesPointId: salesPointId!,
      customerId: customerId || undefined,
    }),
    [salesPointId, customerId]
  );

  const applyPricesToRows = useCallback(
    async (draft: GridRow[], stockMap: Map<string, number>): Promise<GridRow[]> => {
      const variantIds = draft.flatMap((row) =>
        row.kind === 'single' ? [row.variant.id] : row.variants.map((v) => v.id)
      );
      let priceMap: Record<string, { price: number; currency: string; priceListId: string }> = {};
      if (variantIds.length > 0) {
        try {
          priceMap = await resolvePricesBatch(variantIds, priceOpts());
        } catch {
          /* show grid with catalog fallback prices */
        }
      }
      return draft.map((row): GridRow => {
        const stock = stockMap.get(row.item.id) ?? 0;
        if (row.kind === 'single') {
          const fallback = row.variant.sellingPriceOverride ?? row.price;
          return { ...row, stock, price: priceMap[row.variant.id]?.price ?? fallback };
        }
        const nums = row.variants.map(
          (v) => priceMap[v.id]?.price ?? v.sellingPriceOverride ?? 0
        );
        return {
          ...row,
          stock,
          minPrice: Math.min(...nums),
          maxPrice: Math.max(...nums),
        };
      });
    },
    [priceOpts, resolvePricesBatch]
  );

  const softRefresh = useCallback(async () => {
    if (!salesPointId) return;
    const prev = rowsRef.current;
    if (prev.length === 0) return;

    setRefreshing(true);
    try {
      const stockMap = locationId ? await stockTotalsByItemForLocation(locationId) : new Map();
      const updated = await applyPricesToRows(prev, stockMap);
      setRows(applyInStockFilter(updated));
    } finally {
      setRefreshing(false);
    }
  }, [applyInStockFilter, applyPricesToRows, locationId, salesPointId]);

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
      const [catalogData, stockMap] = await Promise.all([
        inventoryService.getCatalog({
          branchId,
          isActive: true,
          excludeNonStock: true,
          productLimit: 48,
          ...(categoryChip ? { category: categoryChip } : {}),
        }),
        locationId ? stockTotalsByItemForLocation(locationId) : Promise.resolve(new Map<string, number>()),
      ]);

      const catalog = catalogRows(catalogData);
      const { productIds, byProduct } = groupCatalogByProduct(catalog);
      const slice = productIds;

      const draft: GridRow[] = [];
      for (const productId of slice) {
        const catRows = byProduct.get(productId);
        if (!catRows?.length) continue;

        const variants = catRows.map(catalogRowToVariant);
        const useVariants = variants.filter((v) => v.isActive !== false);
        const list = useVariants.length > 0 ? useVariants : variants;
        if (list.length === 0) continue;

        const item = catalogRowsToItem(catRows);
        const stock = stockMap.get(productId) ?? 0;

        if (list.length === 1) {
          const v = list[0];
          draft.push({
            kind: 'single',
            item,
            variant: v,
            price: 0,
            stock,
            label: `${item.name} - ${v.name}`,
          });
        } else {
          draft.push({
            kind: 'multi',
            item,
            variants: list,
            minPrice: 0,
            maxPrice: 0,
            stock,
          });
        }
      }

      const priced = await applyPricesToRows(draft, stockMap);
      setRows(applyInStockFilter(priced));
    } catch {
      /* catalog/stock failed — keep prior rows if any */
    } finally {
      if (blocking) setLoading(false);
      else setRefreshing(false);
      lastHandledRefreshRef.current = refreshTokenRef.current;
    }
  }, [applyInStockFilter, applyPricesToRows, branchId, categoryChip, customerId, gridStructureKey, locationId, salesPointId]);

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
                <span className="pos-product-card__stock">
                  Stock:{' '}
                  {!locationId || posLineStockFlagsFromItem(row.item).isNonStock ? '—' : row.stock}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
