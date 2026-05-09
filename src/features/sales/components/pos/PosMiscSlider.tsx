import React, { useCallback, useEffect, useRef, useState } from 'react';
import { inventoryService, type InventoryItem, type InventoryVariant } from '@/services/inventory.service';

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

export const PosMiscSlider: React.FC<PosMiscSliderProps> = ({
  branchId,
  salesPointId,
  disabled,
  onActivateProduct,
}) => {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({ left: false, right: false });

  const load = useCallback(async () => {
    if (!salesPointId || !branchId) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const data = await inventoryService.getMiscItems({ branchId });
      setItems(data.filter((item) => item.isMisc === true));
    } catch {
      setItems([]);
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
        const variants = await inventoryService.getVariantsByItem(item.id);
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
                className="pos-chip"
                onClick={() => handlePick(item)}
                disabled={disabled || activeItemId === item.id}
                role="listitem"
                title={item.name}
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
