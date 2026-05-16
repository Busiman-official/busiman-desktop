import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  inventoryService,
  catalogRows,
  ItemType,
  type CatalogVariantRow,
  type InventoryItem,
  type InventoryVariant,
} from '@/services/inventory.service';

interface PosMiscSliderProps {
  branchId: string;
  salesPointId: string | null;
  disabled?: boolean;
  onActivateProduct: (
    item: InventoryItem,
    variants: InventoryVariant[],
    options?: { highlightVariantId?: string }
  ) => void | Promise<void>;
}

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
    isMisc: true,
    itemType: ItemType.STOCK,
    branchId: '',
    createdBy: { id: '', name: '', email: '' },
    updatedBy: { id: '', name: '', email: '' },
    createdAt: '',
    updatedAt: '',
  };
}

function groupMiscCatalog(rows: CatalogVariantRow[]): {
  items: InventoryItem[];
  variantsByProductId: Map<string, InventoryVariant[]>;
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
  const variantsByProductId = new Map<string, InventoryVariant[]>();
  const items = productIds.map((productId) => {
    const catRows = byProduct.get(productId)!;
    variantsByProductId.set(productId, catRows.map(catalogRowToVariant));
    return catalogRowsToItem(catRows);
  });
  return { items, variantsByProductId };
}

export const PosMiscSlider: React.FC<PosMiscSliderProps> = ({
  branchId,
  salesPointId,
  disabled,
  onActivateProduct,
}) => {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const variantsByProductRef = useRef<Map<string, InventoryVariant[]>>(new Map());
  const [loading, setLoading] = useState(false);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({ left: false, right: false });

  const load = useCallback(async () => {
    if (!salesPointId || !branchId) {
      setItems([]);
      variantsByProductRef.current = new Map();
      return;
    }
    setLoading(true);
    try {
      const catalogData = await inventoryService.getCatalog({
        branchId,
        isActive: true,
        isMisc: true,
        productLimit: 80,
      });
      const { items: miscItems, variantsByProductId } = groupMiscCatalog(catalogRows(catalogData));
      variantsByProductRef.current = variantsByProductId;
      setItems(miscItems);
    } catch {
      setItems([]);
      variantsByProductRef.current = new Map();
    } finally {
      setLoading(false);
    }
  }, [branchId, salesPointId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 2;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      setScrollState({ left, right });
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update as EventListener);
      window.removeEventListener('resize', update);
    };
  }, [items.length, loading, salesPointId, branchId]);

  const handlePick = useCallback(
    async (item: InventoryItem) => {
      if (!salesPointId || disabled) return;
      setActiveItemId(item.id);
      try {
        let variants = variantsByProductRef.current.get(item.id);
        if (!variants?.length) {
          variants = await inventoryService.getVariantsByItem(item.id);
        }
        const activeVariants = variants.filter((variant) => variant.isActive !== false);
        const list = activeVariants.length > 0 ? activeVariants : variants;
        if (list.length === 0) return;
        await onActivateProduct(item, list);
      } finally {
        setActiveItemId(null);
      }
    },
    [disabled, onActivateProduct, salesPointId]
  );

  if (!salesPointId || !branchId || (!loading && items.length === 0)) {
    return null;
  }

  return (
    <div className="pos-recent" aria-label="Miscellaneous items">
      <div className="pos-recent-scroll">
        <button
          type="button"
          className="pos-recent-arrow pos-recent-arrow--left"
          onClick={() => scrollRef.current?.scrollBy({ left: -280, behavior: 'smooth' })}
          disabled={!scrollState.left}
          aria-label="Scroll misc left"
        >
          ‹
        </button>
        <div ref={scrollRef} className="pos-recent-chips" role="list">
          {loading ? (
            <button type="button" className="pos-chip" disabled role="listitem">
              Loading MISC items...
            </button>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`pos-chip${activeItemId === item.id ? ' pos-chip--busy' : ''}`}
                disabled={disabled || activeItemId === item.id}
                role="listitem"
                onClick={() => void handlePick(item)}
              >
                {item.name}
              </button>
            ))
          )}
        </div>
        <button
          type="button"
          className="pos-recent-arrow pos-recent-arrow--right"
          onClick={() => scrollRef.current?.scrollBy({ left: 280, behavior: 'smooth' })}
          disabled={!scrollState.right}
          aria-label="Scroll misc right"
        >
          ›
        </button>
      </div>
    </div>
  );
};
