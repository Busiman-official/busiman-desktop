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

type MiscVariantChip = {
  item: InventoryItem;
  variant: InventoryVariant;
};

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

function catalogRowToItem(row: CatalogVariantRow): InventoryItem {
  return {
    id: row.productId,
    name: row.productName,
    category: row.category,
    hasVariants: true,
    isActive: row.isActive,
    productType: row.productType ?? ProductType.STOCK_ITEM,
    isMisc: row.isMisc ?? true,
    itemType: row.itemType ?? ItemType.MISC_INVENTORY,
    branchId: '',
    createdBy: { id: '', name: '', email: '' },
    updatedBy: { id: '', name: '', email: '' },
    createdAt: '',
    updatedAt: '',
  };
}

function miscCatalogToChips(rows: CatalogVariantRow[]): MiscVariantChip[] {
  return rows
    .filter((r) => r.variantIsActive !== false)
    .map((row) => ({
      item: catalogRowToItem(row),
      variant: catalogRowToVariant(row),
    }))
    .sort((a, b) => a.variant.name.localeCompare(b.variant.name));
}

export const PosMiscSlider: React.FC<PosMiscSliderProps> = ({
  branchId,
  salesPointId,
  disabled,
  onActivateProduct,
}) => {
  const [chips, setChips] = useState<MiscVariantChip[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({ left: false, right: false });

  const load = useCallback(async () => {
    if (!branchId) {
      setChips([]);
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
      setChips(miscCatalogToChips(catalogRows(catalogData)));
    } catch {
      setChips([]);
    } finally {
      setLoading(false);
    }
  }, [branchId]);

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
  }, [chips.length, loading, branchId]);

  const handlePick = useCallback(
    async (chip: MiscVariantChip) => {
      if (!branchId || disabled) return;
      setActiveVariantId(chip.variant.id);
      try {
        await onActivateProduct(chip.item, [chip.variant]);
      } finally {
        setActiveVariantId(null);
      }
    },
    [disabled, onActivateProduct, branchId]
  );

  if (!branchId || (!loading && chips.length === 0)) {
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
            chips.map((chip) => (
              <button
                key={chip.variant.id}
                type="button"
                className={`pos-chip${activeVariantId === chip.variant.id ? ' pos-chip--busy' : ''}`}
                disabled={disabled || activeVariantId === chip.variant.id}
                role="listitem"
                title={chip.item.name}
                onClick={() => void handlePick(chip)}
              >
                {chip.variant.name}
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
