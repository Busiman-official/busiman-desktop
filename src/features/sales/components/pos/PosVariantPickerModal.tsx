import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/components/modals/Modal';
import { Button } from '@/shared/components/ui';
import { inventoryService, type InventoryItem, type InventoryVariant } from '@/services/inventory.service';
import {
  buildLineMetaFromItemVariant,
  posLineStockFlagsFromItem,
  type PosResolvedLineMeta,
} from './resolveScan';
import { PosQuantityStepper } from './PosQuantityStepper';
import { roundPosQuantity } from './posQuantity';
import './PosVariantPickerModal.css';

export type PosVariantPickerLine = {
  meta: PosResolvedLineMeta;
  quantity: number;
  unitPrice: number;
};

export interface PosVariantPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: InventoryItem | null;
  variants: InventoryVariant[];
  locationId: string | null;
  salesPointId: string | null;
  customerId: string | null;
  /** Row to accent (must be one of `variants` when provided). */
  highlightVariantId?: string | null;
  resolvePrice: (
    variantId: string,
    opts?: { customerId?: string; salesPointId?: string }
  ) => Promise<{ price: number; currency: string }>;
  resolvePricesBatch?: (
    variantIds: string[],
    opts?: { customerId?: string; salesPointId?: string }
  ) => Promise<Record<string, { price: number; currency: string }>>;
  /** When true, POS allows exceeding on-hand (matches cart / checkout). */
  allowNegativePos?: boolean;
  /** When true, never block on zero stock (e.g. purchase goods receipt). */
  ignoreStockLimits?: boolean;
  onConfirm: (lines: PosVariantPickerLine[]) => void;
}

type StockLevel = 'in' | 'low' | 'out';

/** Upper bound for stepper when stock is not enforced (misc / backorder / global oversell). */
const POS_PICKER_SOFT_QTY_CAP = 9999;

function formatMoney(n: number, currency = 'INR'): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

function primaryImageUrl(item: InventoryItem): string | undefined {
  const imgs = item.images;
  if (!imgs?.length) return undefined;
  const primary = imgs.find((i) => i.isPrimary) || imgs[0];
  return primary?.url;
}

function stockStatus(available: number, lowThreshold: number): StockLevel {
  if (available <= 0) return 'out';
  if (available <= lowThreshold) return 'low';
  return 'in';
}

function lowThresholdForVariant(v: InventoryVariant): number {
  const t = v.reorderLevel ?? v.minStock;
  if (typeof t === 'number' && t > 0) return Math.floor(t);
  return 5;
}

function PlaceholderIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" fill="currentColor" stroke="none" />
      <path d="M21 17l-5-5-4 4-2-2-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
      <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export const PosVariantPickerModal: React.FC<PosVariantPickerModalProps> = ({
  isOpen,
  onClose,
  item,
  variants,
  locationId,
  salesPointId,
  customerId,
  highlightVariantId,
  resolvePrice,
  resolvePricesBatch,
  allowNegativePos = false,
  ignoreStockLimits = false,
  onConfirm,
}) => {
  const [loading, setLoading] = useState(true);
  const [stockByVariant, setStockByVariant] = useState<Record<string, number>>({});
  const [priceByVariant, setPriceByVariant] = useState<Record<string, number>>({});
  const [currency, setCurrency] = useState('INR');
  const [draftQty, setDraftQty] = useState<Record<string, number>>({});
  const [sessionLines, setSessionLines] = useState<PosVariantPickerLine[]>([]);
  const [addedFlash, setAddedFlash] = useState<Record<string, boolean>>({});

  const sortedVariants = useMemo(() => {
    return [...variants].sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [variants]);

  const stockFlags = useMemo(() => (item ? posLineStockFlagsFromItem(item) : null), [item]);

  const variantIgnoresOnHand = useCallback(
    (v: InventoryVariant) => {
      if (!stockFlags) return false;
      if (ignoreStockLimits) return true;
      if (allowNegativePos) return true;
      if (stockFlags.isNonStock) return true;
      if (stockFlags.allowNegativeStock) return true;
      if (v.allowBackorder === true) return true;
      return false;
    },
    [allowNegativePos, ignoreStockLimits, stockFlags]
  );

  useEffect(() => {
    if (!isOpen || !item || sortedVariants.length === 0) return;

    let cancelled = false;
    setLoading(true);
    setSessionLines([]);
    setAddedFlash({});
    const initialDraft: Record<string, number> = {};
    sortedVariants.forEach((v) => {
      initialDraft[v.id] = 1;
    });
    setDraftQty(initialDraft);

    (async () => {
      const stock: Record<string, number> = {};
      const prices: Record<string, number> = {};
      let cur = 'INR';

      const stockResults = locationId
        ? await Promise.all(
            sortedVariants.map(async (v) => {
              try {
                const b = await inventoryService.getStockBalance(item.id, locationId, undefined, v.id);
                return [v.id, b.available] as const;
              } catch {
                return [v.id, 0] as const;
              }
            })
          )
        : sortedVariants.map((v) => [v.id, 0] as const);
      for (const [id, avail] of stockResults) stock[id] = avail;

      const variantIds = sortedVariants.map((v) => v.id);
      const priceOpts = salesPointId
        ? { salesPointId, customerId: customerId || undefined }
        : undefined;
      if (salesPointId || resolvePricesBatch || resolvePrice) {
        const priceMap = resolvePricesBatch
          ? await resolvePricesBatch(variantIds, priceOpts)
          : Object.fromEntries(
              await Promise.all(
                variantIds.map(async (id) => {
                  try {
                    const pr = await resolvePrice(id, priceOpts);
                    return [id, pr] as const;
                  } catch {
                    return [id, { price: 0, currency: 'INR' }] as const;
                  }
                })
              )
            );
        for (const v of sortedVariants) {
          const pr = priceMap[v.id];
          prices[v.id] = pr?.price ?? v.costPriceOverride ?? v.sellingPriceOverride ?? 0;
          if (pr?.currency) cur = pr.currency;
        }
      }

      if (!cancelled) {
        setStockByVariant(stock);
        setPriceByVariant(prices);
        setCurrency(cur);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, item, sortedVariants, locationId, salesPointId, customerId, resolvePrice, resolvePricesBatch]);

  const subtitle = useMemo(() => {
    if (!item) return '';
    const cat = item.category?.trim() || '—';
    const masterSku =
      [item.sku, item.displaySku].map((s) => (typeof s === 'string' ? s.trim() : '')).find(Boolean) || '—';
    return `SKU: ${masterSku} · ${cat} · ${item.unitOfMeasure || 'pcs'}`;
  }, [item]);

  const imgUrl = item ? primaryImageUrl(item) : undefined;
  const [imgBroken, setImgBroken] = useState(false);
  useEffect(() => {
    setImgBroken(false);
  }, [item?.id, imgUrl]);

  const sessionTotals = useMemo(() => {
    const units = sessionLines.reduce((s, l) => s + l.quantity, 0);
    const total = sessionLines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    return { units, total, variantCount: sessionLines.length };
  }, [sessionLines]);

  const commitDraftQty = useCallback(
    (variantId: string, value: number, maxStock: number, unlimited: boolean) => {
      setDraftQty((prev) => {
        let next = roundPosQuantity(Math.max(0, value));
        if (!Number.isFinite(next)) return prev;
        if (unlimited) next = Math.min(next, POS_PICKER_SOFT_QTY_CAP);
        else next = maxStock > 0 ? Math.min(next, maxStock) : next;
        return { ...prev, [variantId]: next };
      });
    },
    []
  );

  const handleAddVariant = useCallback(
    (v: InventoryVariant) => {
      if (v.isActive === false) return;
      const avail = stockByVariant[v.id] ?? 0;
      const qty = draftQty[v.id] ?? 0;
      const price = priceByVariant[v.id] ?? 0;
      const unlimited = variantIgnoresOnHand(v);
      if (!item || qty <= 0) return;
      if (!unlimited && avail <= 0) return;

      const meta = buildLineMetaFromItemVariant(item, v);
      setSessionLines((prev) => {
        const i = prev.findIndex((l) => l.meta.variantId === v.id);
        if (i >= 0) {
          const next = [...prev];
          next[i] = {
            ...next[i],
            quantity: next[i].quantity + qty,
            unitPrice: price,
          };
          return next;
        }
        return [...prev, { meta, quantity: qty, unitPrice: price }];
      });

      setAddedFlash((f) => ({ ...f, [v.id]: true }));
      window.setTimeout(() => {
        setAddedFlash((f) => ({ ...f, [v.id]: false }));
      }, 1400);

      setDraftQty((prev) => ({ ...prev, [v.id]: 1 }));
    },
    [item, draftQty, stockByVariant, priceByVariant, variantIgnoresOnHand]
  );

  const handleConfirm = useCallback(() => {
    if (sessionLines.length === 0) return;
    onConfirm(sessionLines);
  }, [sessionLines, onConfirm]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const highlightId =
    highlightVariantId && sortedVariants.some((x) => x.id === highlightVariantId)
      ? highlightVariantId
      : sortedVariants.find((x) => x.isDefault)?.id || sortedVariants[0]?.id;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} className="pos-variant-picker-modal">
      <div className="pos-variant-picker__shell">
        <header className="pos-variant-picker__header">
          <div className="pos-variant-picker__thumb-wrap" aria-hidden>
            {imgUrl && !imgBroken ? (
              <img
                src={imgUrl}
                alt=""
                className="pos-variant-picker__thumb"
                onError={() => setImgBroken(true)}
              />
            ) : (
              <span className="pos-variant-picker__thumb-placeholder">
                <PlaceholderIcon />
              </span>
            )}
          </div>
          <div className="pos-variant-picker__title-block">
            <h2 className="pos-variant-picker__title" id="pos-variant-picker-title">
              {item?.name ?? 'Product'}
            </h2>
            <p className="pos-variant-picker__subtitle">{subtitle}</p>
          </div>
          <button
            type="button"
            className="pos-variant-picker__close"
            onClick={handleClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="pos-variant-picker__divider" />
        <p className="pos-variant-picker__section-label">All variants</p>

        <div className="pos-variant-picker__body" role="region" aria-labelledby="pos-variant-picker-title">
          {loading ? (
            <p className="pos-variant-picker__loading">Loading variants…</p>
          ) : (
            sortedVariants.map((v) => {
              const avail = stockByVariant[v.id] ?? 0;
              const low = lowThresholdForVariant(v);
              const status = stockStatus(avail, low);
              const price = priceByVariant[v.id] ?? 0;
              const qty = draftQty[v.id] ?? 0;
              const highlight = highlightId === v.id;
              const unlimited = variantIgnoresOnHand(v);
              const oos = avail <= 0 && !unlimited;
              const variantInactive = v.isActive === false;
              const maxCap = unlimited ? POS_PICKER_SOFT_QTY_CAP : Math.max(avail, 0);

              const showSellableZero = avail <= 0 && unlimited && stockFlags && !variantInactive;

              let badge: React.ReactNode;
              let stockClass: string;
              if (variantInactive) {
                badge = (
                  <span className="pos-variant-card__badge pos-variant-card__badge--out">Inactive</span>
                );
                stockClass =
                  status === 'in'
                    ? 'pos-variant-card__stock--in'
                    : status === 'low'
                      ? 'pos-variant-card__stock--low'
                      : 'pos-variant-card__stock--out';
              } else if (showSellableZero) {
                if (ignoreStockLimits) {
                  badge = (
                    <span className="pos-variant-card__badge pos-variant-card__badge--neutral">
                      {avail <= 0 ? '0 on hand' : status === 'low' ? 'Low stock' : 'In stock'}
                    </span>
                  );
                  stockClass =
                    status === 'in'
                      ? 'pos-variant-card__stock--in'
                      : status === 'low'
                        ? 'pos-variant-card__stock--low'
                        : 'pos-variant-card__stock--out';
                } else if (stockFlags.isNonStock) {
                  badge = (
                    <span className="pos-variant-card__badge pos-variant-card__badge--neutral">Non-stock</span>
                  );
                  stockClass = 'pos-variant-card__stock--neutral';
                } else if (stockFlags.allowNegativeStock) {
                  badge = (
                    <span className="pos-variant-card__badge pos-variant-card__badge--info">Misc — not qty-limited</span>
                  );
                  stockClass = 'pos-variant-card__stock--neutral';
                } else if (v.allowBackorder === true) {
                  badge = (
                    <span className="pos-variant-card__badge pos-variant-card__badge--info">Backorder OK</span>
                  );
                  stockClass = 'pos-variant-card__stock--neutral';
                } else if (allowNegativePos) {
                  badge = (
                    <span className="pos-variant-card__badge pos-variant-card__badge--info">Oversell (POS)</span>
                  );
                  stockClass = 'pos-variant-card__stock--neutral';
                } else {
                  badge = (
                    <span className="pos-variant-card__badge pos-variant-card__badge--out">Out of stock</span>
                  );
                  stockClass = 'pos-variant-card__stock--out';
                }
              } else {
                badge =
                  status === 'in' ? (
                    <span className="pos-variant-card__badge pos-variant-card__badge--in">In stock</span>
                  ) : status === 'low' ? (
                    <span className="pos-variant-card__badge pos-variant-card__badge--low">Low stock</span>
                  ) : (
                    <span className="pos-variant-card__badge pos-variant-card__badge--out">Out of stock</span>
                  );
                stockClass =
                  status === 'in'
                    ? 'pos-variant-card__stock--in'
                    : status === 'low'
                      ? 'pos-variant-card__stock--low'
                      : 'pos-variant-card__stock--out';
              }

              const stockOnHandDisplay =
                !locationId || stockFlags?.isNonStock ? '—' : avail;
              const variantCode = (v.code || v.sku || '').trim() || '—';
              const barcode = (v.barcode || '—').trim() || '—';

              return (
                <article
                  key={v.id}
                  className={`pos-variant-card${highlight ? ' pos-variant-card--highlight' : ''}${oos || variantInactive ? ' pos-variant-card--oos' : ''}`}
                >
                  <div className="pos-variant-card__head">
                    <div>
                      <div className="pos-variant-card__name">{`${item!.name} - ${v.name}`}</div>
                      <span className="pos-variant-card__sku">SKU: {variantCode}</span>
                    </div>
                    {badge}
                  </div>
                  <div className="pos-variant-card__row">
                    <div className="pos-variant-card__meta">
                      <div>
                        <span>Stock</span>
                        <strong className={typeof stockOnHandDisplay === 'number' ? stockClass : 'pos-variant-card__stock--neutral'}>
                          {stockOnHandDisplay}
                        </strong>
                      </div>
                      <div>
                        <span>Price</span>
                        <strong>{formatMoney(price, currency)}</strong>
                      </div>
                      <div>
                        <span>Barcode</span>
                        <strong title={barcode}>{barcode.length > 14 ? `${barcode.slice(0, 14)}…` : barcode}</strong>
                      </div>
                    </div>

                    {variantInactive ? (
                      <div className="pos-variant-card__actions">
                        <button type="button" className="pos-variant-card__oos-btn" disabled>
                          Inactive
                        </button>
                      </div>
                    ) : oos ? (
                      <div className="pos-variant-card__actions">
                        <button type="button" className="pos-variant-card__oos-btn" disabled>
                          Out of stock
                        </button>
                      </div>
                    ) : (
                      <div className="pos-variant-card__actions">
                        <div className="pos-variant-card__stepper">
                          <PosQuantityStepper
                            quantity={qty}
                            onCommit={(n) => commitDraftQty(v.id, n, maxCap, unlimited)}
                            min={0}
                            max={unlimited ? POS_PICKER_SOFT_QTY_CAP : maxCap}
                            buttonClassName="pos-variant-card__step-btn"
                            inputClassName="pos-variant-card__step-val pos-qty-stepper__input"
                            inputAriaLabel={`Quantity for ${v.name}`}
                          />
                        </div>
                        <button
                          type="button"
                          className={`pos-variant-card__add${addedFlash[v.id] ? ' pos-variant-card__add--done' : ''}`}
                          disabled={qty <= 0 || (!salesPointId && !resolvePrice && !resolvePricesBatch)}
                          onClick={() => handleAddVariant(v)}
                        >
                          {addedFlash[v.id] ? (
                            <>
                              <CheckIcon />
                              Added
                            </>
                          ) : (
                            'Add'
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </div>

        <footer className="pos-variant-picker__footer">
          <div className="pos-variant-picker__summary">
            {sessionTotals.units === 0 ? (
              <span className="pos-variant-picker__summary--muted">No items added yet</span>
            ) : (
              <>
                <span>
                  {sessionTotals.units} {sessionTotals.units === 1 ? 'item' : 'items'} added
                  {sessionTotals.variantCount > 1
                    ? ` · ${sessionTotals.variantCount} variants`
                    : ''}{' '}
                  · Total:{' '}
                  <span className="pos-variant-picker__summary-total">
                    {formatMoney(sessionTotals.total, currency)}
                  </span>
                </span>
              </>
            )}
          </div>
          <div className="pos-variant-picker__footer-actions">
            <Button type="button" variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleConfirm}
              disabled={sessionLines.length === 0}
            >
              Add to cart
            </Button>
          </div>
        </footer>
      </div>
    </Modal>
  );
};
