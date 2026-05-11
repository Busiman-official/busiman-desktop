import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Input } from '@/shared/components/ui';
import { inventoryService, type InventoryItem, type InventoryVariant } from '@/services/inventory.service';
import { salesService, type SalesSettingsData, type SalesQuotation } from '@/services/sales.service';
import { searchService } from '@/features/inventory/services/search.service';
import type { ItemSearchResult } from '@/features/inventory/types/search.types';
import { usePriceResolver } from '../../hooks/usePriceResolver';
import { computePosCartTotals } from './posTotals';
import {
  linesForCheckoutPayload,
  linesForQuotationDraftOrder,
  normalizePosGstRatePercent,
  getLineTotalWithGst,
} from './posLineMath';
import { extractErrorMessage } from '@/utils/error';
import { Modal } from '@/shared/components/modals/Modal';
import {
  clearPosDraft,
  getRecentVariants,
  pushRecentVariant,
  savePosDraft,
  holdPosDraft,
  listHeldPosDrafts,
  discardHeldPosDraft,
  type PosHeldDraft,
  type PosRecentEntry,
} from './posStorage';
import {
  buildLineMetaFromItemVariant,
  resolveBarcodeForPos,
  resolveVariantIdForPos,
  type PosResolvedLineMeta,
} from './resolveScan';
import { PosCartLineListCard } from './PosCartLineListCard';
import { PosCartItemDetailPanel } from './PosCartItemDetailPanel';
import { usePosCart, type PosCartLine } from './usePosCart';
import { PosQuickAddGrid } from './PosQuickAddGrid';
import { PosMiscSlider } from './PosMiscSlider';
import { PosVariantPickerModal, type PosVariantPickerLine } from './PosVariantPickerModal';
import { QuotationFromOrderDrawer } from '../panels/QuotationFromOrderDrawer';
import { QuotationShareModal, type QuotationShareLinkState } from '../panels/QuotationShareModal';
import { QuotationPdfViewerScreen } from '../panels/QuotationPdfViewerScreen';
import { entityId } from '../../utils/ids';
import {
  PosCustomerSelectionModal,
  type PosNewCustomerPayload,
} from './PosCustomerSelectionModal';
import './PosShell.css';

type CustomerModalMode = 'sale' | 'quotation';

interface Props {
  branchId: string;
  salesPointId: string | null;
  locationId: string | null;
  customerId: string | null;
  salesPointSessionStatus?: 'open' | 'closed' | null;
  /** False when counter customer is known inactive (from branch customer list). */
  customerAllowsSale?: boolean;
  /** Sale / invoice calendar date (YYYY-MM-DD) sent with checkout and draft B2B orders. */
  invoiceDateYmd: string;
}

const DEBOUNCE_MS = 280;

function posSearchMatchBadge(searchMatch: ItemSearchResult['searchMatch']): {
  label: string;
  className: string;
  title: string;
} {
  const kind = searchMatch?.kind ?? 'master';
  if (kind === 'variant') {
    return {
      label: 'Variant',
      className: 'pos-suggest-badge--variant',
      title: 'Matched on variant code, name, barcode, or HSN',
    };
  }
  if (kind === 'both') {
    return {
      label: 'Product + variant',
      className: 'pos-suggest-badge--both',
      title: 'Matched on product fields and on a variant',
    };
  }
  return {
    label: 'Product',
    className: 'pos-suggest-badge--master',
    title: 'Matched on product name, SKU, barcode, category, tags, or description',
  };
}

function paymentOptionsFromSettings(s: SalesSettingsData | null) {
  if (!s?.paymentMethods?.length) {
    return [
      { value: 'cash', label: 'Cash' },
      { value: 'card', label: 'Card' },
      { value: 'upi', label: 'UPI' },
    ];
  }
  return [...s.paymentMethods]
    .filter((p) => p.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((p) => ({ value: p.code, label: p.label }));
}

const INACTIVE_CUSTOMER_MSG =
  'This customer is inactive. Switch to walk-in or an active customer to charge or create a quotation.';

export const PosShell: React.FC<Props> = ({
  branchId,
  salesPointId,
  locationId,
  customerId,
  salesPointSessionStatus,
  customerAllowsSale = true,
  invoiceDateYmd,
}) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const resolvePrice = usePriceResolver(branchId);
  const lookupInputRef = useRef<HTMLInputElement>(null);
  const lookupWrapRef = useRef<HTMLDivElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [settings, setSettings] = useState<SalesSettingsData | null>(null);
  const [lookupQuery, setLookupQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchSuggestionsLoading, setSearchSuggestionsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<ItemSearchResult[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null);
  const [paymentCode, setPaymentCode] = useState('cash');
  /** When set, POS checkout records the sale on the customer's outstanding balance (pay later). */
  const [holdPaymentForAccount, setHoldPaymentForAccount] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutErrorModal, setCheckoutErrorModal] = useState<string | null>(null);
  const [checkoutCustomerModal, setCheckoutCustomerModal] = useState(false);
  const [checkoutModalBusy, setCheckoutModalBusy] = useState(false);
  const [checkoutModalError, setCheckoutModalError] = useState<string | null>(null);
  const [counterCustomerName, setCounterCustomerName] = useState<string | null>(null);
  const [intentCustomerLabel, setIntentCustomerLabel] = useState<string | null>(null);
  const [checkoutSuccess, setCheckoutSuccess] = useState<{
    orderNumber: string;
    onAccount?: boolean;
  } | null>(null);
  const [customerModalMode, setCustomerModalMode] = useState<CustomerModalMode>('sale');
  const [quotationDrawerOpen, setQuotationDrawerOpen] = useState(false);
  const [quotationSourceOrder, setQuotationSourceOrder] = useState<Record<string, unknown> | null>(null);
  const [quotationShare, setQuotationShare] = useState<{
    quotation: SalesQuotation;
    customerName: string;
    customerPhone?: string;
    pdfWarning: string | null;
  } | null>(null);
  const [quotationShareLink, setQuotationShareLink] = useState<QuotationShareLinkState>({
    loading: false,
    error: null,
    data: null,
  });
  const [quotationPdfViewer, setQuotationPdfViewer] = useState<{ url: string; blob: Blob } | null>(null);
  const [quotationPdfOpening, setQuotationPdfOpening] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [pasteBarcode, setPasteBarcode] = useState('');
  const [recent, setRecent] = useState<PosRecentEntry[]>([]);
  const recentWrapRef = useRef<HTMLDivElement>(null);
  const [recentScroll, setRecentScroll] = useState({ left: false, right: false });
  const [heldDrafts, setHeldDrafts] = useState<PosHeldDraft[]>([]);
  const [availableByVariant, setAvailableByVariant] = useState<Record<string, number>>({});
  const [discountInput, setDiscountInput] = useState('0');
  const [categoryChip, setCategoryChip] = useState<string | null>(null);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [stockRefreshToken, setStockRefreshToken] = useState(0);
  const quotationUrlToastRef = useRef(false);
  const [posHydrateOrderBusy, setPosHydrateOrderBusy] = useState(false);

  const {
    lines,
    lastMergedVariantId,
    addOrMerge,
    removeLine,
    updateLine,
    clear,
    replaceLines,
  } = usePosCart();

  const [selectedDetailVariantId, setSelectedDetailVariantId] = useState<string | null>(null);

  const [variantPicker, setVariantPicker] = useState<{
    item: InventoryItem;
    variants: InventoryVariant[];
    highlightVariantId: string | null;
  } | null>(null);

  const getUnitFactor = useCallback((line: PosCartLine, unitOfMeasure?: string | null): number => {
    const unit = (unitOfMeasure || line.unitOfMeasure || line.baseUnit || '').trim().toLowerCase();
    const options = line.unitOptions || [];
    const matched = options.find((u) => u.unitCode === unit);
    const factor = matched?.factorToBase;
    return Number.isFinite(factor) && (factor as number) > 0 ? (factor as number) : 1;
  }, []);

  const discountAmount = useMemo(() => {
    const n = parseFloat(discountInput.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [discountInput]);

  useEffect(() => {
    if (!branchId) return;
    salesService.getSettings(branchId).then(setSettings).catch(() => { });
  }, [branchId]);

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setDebouncedSearch(lookupQuery.trim()), DEBOUNCE_MS);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [lookupQuery]);

  useEffect(() => {
    if (!checkoutCustomerModal || !customerId || !branchId) {
      setCounterCustomerName(null);
      return;
    }
    let cancelled = false;
    salesService
      .getCustomer(customerId, branchId)
      .then((c) => {
        if (!cancelled) setCounterCustomerName(c.name || null);
      })
      .catch(() => {
        if (!cancelled) setCounterCustomerName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [checkoutCustomerModal, customerId, branchId]);

  const posOrderForCustomerIntent = searchParams.get('posOrderForCustomer') === '1';

  useEffect(() => {
    if (!posOrderForCustomerIntent || !customerId || !branchId) {
      setIntentCustomerLabel(null);
      return;
    }
    let cancelled = false;
    salesService
      .getCustomer(customerId, branchId)
      .then((c) => {
        if (!cancelled) setIntentCustomerLabel(c.name?.trim() || 'Customer');
      })
      .catch(() => {
        if (!cancelled) setIntentCustomerLabel('Customer');
      });
    return () => {
      cancelled = true;
    };
  }, [posOrderForCustomerIntent, customerId, branchId]);

  useEffect(() => {
    const q = debouncedSearch.trim();
    if (!q) {
      setSuggestions([]);
      setSearchSuggestionsLoading(false);
      return;
    }
    let cancelled = false;
    setSearchSuggestionsLoading(true);
    searchService
      .search(q, { types: ['item'], branchId }, 12)
      .then((res) => {
        if (!cancelled) {
          let items = (res.items || []) as ItemSearchResult[];
          if (categoryChip) {
            items = items.filter(
              (it) => it.category?.toLowerCase() === categoryChip.toLowerCase()
            );
          }
          setSuggestions(items);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'Search canceled') return;
        setSuggestions([]);
      })
      .finally(() => {
        if (!cancelled) setSearchSuggestionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, categoryChip, branchId]);

  useEffect(() => {
    setHighlightIndex((i) => {
      if (suggestions.length === 0) return null;
      if (i === null) return null;
      return Math.min(i, suggestions.length - 1);
    });
  }, [suggestions]);

  const lookupDebouncing =
    lookupQuery.trim().length > 0 && lookupQuery.trim() !== debouncedSearch.trim();
  const suggestPanelLoading = searchSuggestionsLoading || lookupDebouncing;
  const showSuggestPanel =
    suggestOpen && Boolean(salesPointId) && lookupQuery.trim().length > 0;

  useEffect(() => {
    const onDoc = (ev: MouseEvent) => {
      if (!lookupWrapRef.current?.contains(ev.target as Node)) {
        setSuggestOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    if (!locationId || lines.length === 0) {
      setAvailableByVariant({});
      return;
    }
    let cancelled = false;
    (async () => {
      const next: Record<string, number> = {};
      for (const line of lines) {
        if (line.isNonStock) {
          continue;
        }
        try {
          const b = await inventoryService.getStockBalance(line.itemId, locationId, undefined, line.variantId);
          if (!cancelled) next[line.variantId] = b.available;
        } catch {
          if (!cancelled) next[line.variantId] = 0;
        }
      }
      if (!cancelled) setAvailableByVariant(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [lines, locationId]);

  useEffect(() => {
    if (!branchId || !salesPointId) return;
    setRecent(getRecentVariants(branchId, salesPointId));
    setHeldDrafts(listHeldPosDrafts(branchId, salesPointId));
  }, [branchId, salesPointId]);

  useEffect(() => {
    const el = recentWrapRef.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 2;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      setRecentScroll({ left, right });
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update as any);
      window.removeEventListener('resize', update);
    };
  }, [recent.length, salesPointId]);

  useEffect(() => {
    if (!branchId || !salesPointId || lines.length === 0) return;
    const t = window.setTimeout(() => savePosDraft(branchId, salesPointId, lines), 400);
    return () => clearTimeout(t);
  }, [lines, branchId, salesPointId]);

  const payOpts = useMemo(() => paymentOptionsFromSettings(settings), [settings]);

  useEffect(() => {
    if (payOpts.length && !payOpts.some((p) => p.value === paymentCode)) {
      setPaymentCode(payOpts[0].value);
    }
  }, [payOpts, paymentCode]);

  const branchTaxPercent = settings?.taxRatePercent ?? 0;

  const totals = useMemo(() => {
    if (!settings) {
      return { subtotal: 0, discountAmount: 0, taxAmount: 0, total: 0 };
    }
    return computePosCartTotals(lines, branchTaxPercent, discountAmount);
  }, [lines, settings, discountAmount, branchTaxPercent]);

  useEffect(() => {
    if (lines.length === 0) {
      setSelectedDetailVariantId(null);
      return;
    }
    if (selectedDetailVariantId && !lines.some((l) => l.variantId === selectedDetailVariantId)) {
      setSelectedDetailVariantId(null);
    }
  }, [lines, selectedDetailVariantId]);

  const selectedDetailLine = useMemo(
    () => (selectedDetailVariantId ? lines.find((l) => l.variantId === selectedDetailVariantId) ?? null : null),
    [lines, selectedDetailVariantId]
  );

  const stockBlocked = useMemo(() => {
    if (settings?.allowNegativePos) return false;
    return lines.some((l) => {
      if (l.isNonStock || l.allowNegativeStock) return false;
      const a = availableByVariant[l.variantId];
      const requiredBaseQty = l.quantity * getUnitFactor(l, l.unitOfMeasure);
      return a !== undefined && requiredBaseQty > a;
    });
  }, [availableByVariant, getUnitFactor, lines, settings?.allowNegativePos]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const handleDetailUpdate = useCallback(
    (patch: Partial<PosCartLine>) => {
      if (!selectedDetailVariantId) return;
      const current = lines.find((l) => l.variantId === selectedDetailVariantId);
      if (!current) return;
      if (patch.unitOfMeasure && patch.unitOfMeasure !== current.unitOfMeasure) {
        const currentFactor = getUnitFactor(current, current.unitOfMeasure);
        const nextFactor = getUnitFactor(current, patch.unitOfMeasure);
        const nextUnitPrice = (current.unitPrice / currentFactor) * nextFactor;
        updateLine(selectedDetailVariantId, {
          ...patch,
          unitOfMeasure: patch.unitOfMeasure,
          unitPrice: Math.round(nextUnitPrice * 10000) / 10000,
        });
        return;
      }
      updateLine(selectedDetailVariantId, patch);
    },
    [getUnitFactor, lines, selectedDetailVariantId, updateLine]
  );

  /** Removes the line for this variant; clears the detail modal if it was showing that line. */
  const removeLineFromCart = useCallback(
    (variantId: string) => {
      removeLine(variantId);
      if (selectedDetailVariantId === variantId) {
        setSelectedDetailVariantId(null);
      }
    },
    [removeLine, selectedDetailVariantId]
  );

  const handleDetailRemove = useCallback(() => {
    if (!selectedDetailVariantId) return;
    removeLineFromCart(selectedDetailVariantId);
  }, [selectedDetailVariantId, removeLineFromCart]);

  const setLineQuantity = useCallback(
    (variantId: string, nextQty: number) => {
      const q = Math.trunc(Number(nextQty));
      if (!Number.isFinite(q)) return;
      if (q <= 0) {
        removeLineFromCart(variantId);
        return;
      }
      const cap = 999_999;
      updateLine(variantId, { quantity: Math.min(cap, q) });
    },
    [removeLineFromCart, updateLine]
  );

  const addLineFromMeta = useCallback(
    async (
      meta: PosResolvedLineMeta,
      qty = 1,
      options?: { quiet?: boolean; unitPrice?: number; notes?: string; hsn?: string; gstRatePercent?: number; unitOfMeasure?: string }
    ) => {
      if (!salesPointId) return;
      try {
        const pr =
          typeof options?.unitPrice === 'number'
            ? { price: options.unitPrice }
            : await resolvePrice(meta.variantId, { salesPointId, customerId: customerId || undefined });
        const noteOpt = options?.notes?.trim();
        const hsnOpt = options?.hsn?.trim();
        const gstOpt =
          options?.gstRatePercent != null && Number.isFinite(options.gstRatePercent)
            ? normalizePosGstRatePercent(options.gstRatePercent)
            : normalizePosGstRatePercent(settings?.taxRatePercent);
        addOrMerge({
          variantId: meta.variantId,
          itemId: meta.itemId,
          sku: meta.sku,
          label: meta.label,
          quantity: qty,
          unitPrice: pr.price,
          isNonStock: meta.isNonStock,
          allowNegativeStock: meta.allowNegativeStock,
          serialWarning: meta.serialWarning,
          batchWarning: meta.batchWarning,
          lineDiscountType: 'flat',
          lineDiscountValue: 0,
          gstRatePercent: gstOpt,
          notes: noteOpt || '',
          hsn: hsnOpt || '',
          unitOfMeasure: (options?.unitOfMeasure || meta.defaultSalesUnit || meta.baseUnit).trim().toLowerCase(),
          baseUnit: meta.baseUnit,
          unitOptions: meta.unitOptions,
        });
        pushRecentVariant(branchId, salesPointId, { variantId: meta.variantId, label: meta.label });
        setRecent(getRecentVariants(branchId, salesPointId));
        if (!options?.quiet) {
          showToast(`Added: ${meta.label}`);
          setLookupQuery('');
          setSuggestions([]);
          setSearchSuggestionsLoading(false);
          setSuggestOpen(false);
          setHighlightIndex(null);
          lookupInputRef.current?.focus();
        }
      } catch (e: unknown) {
        setCheckoutError(e instanceof Error ? e.message : 'Could not resolve price');
      }
    },
    [addOrMerge, branchId, customerId, resolvePrice, salesPointId, settings?.taxRatePercent, showToast]
  );

  /** Keeps cart hydration from re-running when settings/customer resolve updates `addLineFromMeta` identity. */
  const addLineFromMetaRef = useRef(addLineFromMeta);
  addLineFromMetaRef.current = addLineFromMeta;

  const posLoadOrderIdParam = searchParams.get('posLoadOrderId')?.trim() ?? '';

  useEffect(() => {
    if (!posLoadOrderIdParam || !branchId || !salesPointId) return;
    const loadOrderId = posLoadOrderIdParam;
    let cancelled = false;
    (async () => {
      setPosHydrateOrderBusy(true);
      setCheckoutError(null);
      try {
        const o = (await salesService.getOrder(loadOrderId, branchId)) as {
          lines?: Array<{
            variantId?: unknown;
            quantity?: number;
            unitOfMeasure?: string;
            unitPrice?: number;
            posLineNotes?: string;
            posHsn?: string;
            posGstRatePercent?: number;
          }>;
          discountAmount?: number;
        };
        if (cancelled) return;
        clear();
        for (const ln of o.lines || []) {
          if (cancelled) return;
          const vid =
            typeof ln.variantId === 'string'
              ? ln.variantId
              : ln.variantId != null && typeof ln.variantId === 'object'
                ? String((ln.variantId as { _id?: unknown })._id ?? '')
                : String(ln.variantId ?? '');
          if (!vid) continue;
          const meta = await resolveVariantIdForPos(vid);
          if (cancelled) return;
          if (!meta) continue;
          const qty = Math.max(0, Number(ln.quantity ?? 0));
          if (qty <= 0) continue;
          await addLineFromMetaRef.current(meta, qty, {
            quiet: true,
            unitPrice: ln.unitPrice != null ? Number(ln.unitPrice) : undefined,
            unitOfMeasure: typeof ln.unitOfMeasure === 'string' ? ln.unitOfMeasure : undefined,
            notes: typeof ln.posLineNotes === 'string' ? ln.posLineNotes : undefined,
            hsn: typeof ln.posHsn === 'string' ? ln.posHsn : undefined,
            gstRatePercent:
              ln.posGstRatePercent != null && Number.isFinite(Number(ln.posGstRatePercent))
                ? Number(ln.posGstRatePercent)
                : undefined,
          });
        }
        if (cancelled) return;
        const d = Number(o.discountAmount ?? 0);
        setDiscountInput(d > 0 ? String(d) : '0');
        showToast('Converted order loaded into cart');
      } catch (e: unknown) {
        if (!cancelled) setCheckoutError(extractErrorMessage(e, 'Could not load order into cart'));
      } finally {
        if (!cancelled) {
          setPosHydrateOrderBusy(false);
          setSearchParams(
            (prev) => {
              const p = new URLSearchParams(prev);
              if (p.get('posLoadOrderId')?.trim() === loadOrderId) {
                p.delete('posLoadOrderId');
              }
              return p;
            },
            { replace: true }
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [posLoadOrderIdParam, branchId, salesPointId, clear, setSearchParams, showToast]);

  const handleActivateProduct = useCallback(
    async (
      item: InventoryItem,
      variants: InventoryVariant[],
      options?: { highlightVariantId?: string }
    ) => {
      if (!salesPointId) return;
      setCheckoutError(null);
      if (variants.length === 0) {
        setCheckoutError('No variants for this item.');
        return;
      }
      if (variants.length === 1) {
        const meta = buildLineMetaFromItemVariant(item, variants[0]);
        await addLineFromMeta(meta, 1);
        return;
      }
      const defaultV = variants.find((x) => x.isDefault) || variants[0];
      const preferred =
        options?.highlightVariantId &&
        variants.some((x) => x.id === options.highlightVariantId)
          ? options.highlightVariantId
          : null;
      const hi =
        preferred ||
        (lastMergedVariantId && variants.some((x) => x.id === lastMergedVariantId)
          ? lastMergedVariantId
          : defaultV.id);
      setVariantPicker({ item, variants, highlightVariantId: hi });
    },
    [addLineFromMeta, lastMergedVariantId, salesPointId]
  );

  const handleVariantPickerConfirm = useCallback(
    async (picked: PosVariantPickerLine[]) => {
      if (!salesPointId || picked.length === 0) return;
      setCheckoutError(null);
      try {
        for (const line of picked) {
          await addLineFromMeta(line.meta, line.quantity, {
            quiet: true,
            unitPrice: line.unitPrice,
          });
        }
        const units = picked.reduce((s, l) => s + l.quantity, 0);
        const label =
          picked.length === 1
            ? `${picked[0].quantity}× ${picked[0].meta.label}`
            : `${units} units across ${picked.length} variants`;
        showToast(`Added to cart: ${label}`);
        setVariantPicker(null);
        setLookupQuery('');
        setSuggestions([]);
        setSearchSuggestionsLoading(false);
        setSuggestOpen(false);
        setHighlightIndex(null);
        lookupInputRef.current?.focus();
      } catch (e: unknown) {
        setCheckoutError(e instanceof Error ? e.message : 'Could not add variants');
      }
    },
    [addLineFromMeta, salesPointId, showToast]
  );

  const onPickSearchItem = useCallback(
    async (item: ItemSearchResult) => {
      if (!salesPointId) return;
      setCheckoutError(null);
      try {
        const fullItem = await inventoryService.getItemById(item.id);
        const variants = await inventoryService.getVariantsByItem(item.id);
        const useVariants = variants.filter((v) => v.isActive !== false);
        const list = useVariants.length > 0 ? useVariants : variants;
        if (list.length === 0) {
          setCheckoutError('No variants for this item.');
          return;
        }
        if (list.length === 1) {
          await handleActivateProduct(fullItem, list);
          return;
        }

        const sm = item.searchMatch;
        const variantId =
          sm?.variant?.id && (sm.kind === 'variant' || sm.kind === 'both')
            ? sm.variant.id
            : undefined;

        if (variantId) {
          const picked = list.find((v) => v.id === variantId);
          if (picked) {
            const meta = buildLineMetaFromItemVariant(fullItem, picked);
            await addLineFromMeta(meta, 1);
            return;
          }
        }

        await handleActivateProduct(fullItem, list, {
          highlightVariantId: sm?.variant?.id,
        });
      } catch (err: unknown) {
        setCheckoutError(err instanceof Error ? err.message : 'Could not add item');
      }
    },
    [addLineFromMeta, handleActivateProduct, salesPointId]
  );

  const tryAddFromInput = useCallback(async () => {
    setCheckoutError(null);
    if (!salesPointId || checkoutModalBusy || checkoutCustomerModal) return;
    const q = lookupQuery.trim();
    if (!q) return;
    if (suggestPanelLoading) {
      setCheckoutError('Wait for product search to finish.');
      return;
    }
    const resolved = await resolveBarcodeForPos(q);
    if (resolved) {
      await addLineFromMeta(resolved, 1);
      return;
    }
    if (suggestions.length > 0) {
      const idx = highlightIndex ?? 0;
      const safe = Math.min(Math.max(0, idx), suggestions.length - 1);
      await onPickSearchItem(suggestions[safe]);
      return;
    }
    setCheckoutError('Unknown barcode or no match. Try search or pick from the list.');
  }, [
    addLineFromMeta,
    checkoutModalBusy,
    checkoutCustomerModal,
    highlightIndex,
    lookupQuery,
    onPickSearchItem,
    salesPointId,
    suggestions,
    suggestPanelLoading,
  ]);

  const handleLookupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await tryAddFromInput();
  };

  const onRecentClick = async (entry: PosRecentEntry) => {
    setCheckoutError(null);
    try {
      const v = await inventoryService.getVariantById(entry.variantId);
      const item = await inventoryService.getItemById(v.itemId);
      const meta = buildLineMetaFromItemVariant(item, v);
      await addLineFromMeta(meta, 1);
    } catch (err: unknown) {
      setCheckoutError(err instanceof Error ? err.message : 'Could not load variant');
    }
  };

  const handleNewSale = useCallback(() => {
    if (branchId && salesPointId) clearPosDraft(branchId, salesPointId);
    clear();
    setLookupQuery('');
    setSuggestions([]);
    setSearchSuggestionsLoading(false);
    setSuggestOpen(false);
    setHighlightIndex(null);
    setCheckoutError(null);
    setDiscountInput('0');
    lookupInputRef.current?.focus();
  }, [branchId, salesPointId, clear]);

  const resumeHeldDraft = useCallback(
    (draft: PosHeldDraft) => {
      if (!branchId || !salesPointId) return;
      // If there's an active cart, automatically hold it as the next draft before resuming.
      if (lines.length > 0) {
        holdPosDraft(branchId, salesPointId, lines);
      }
      try {
        replaceLines(draft.lines as PosCartLine[]);
        discardHeldPosDraft(branchId, salesPointId, draft.id);
        setHeldDrafts(listHeldPosDrafts(branchId, salesPointId));
        showToast('Draft restored');
      } catch {
        // ignore
      }
    },
    [branchId, salesPointId, lines, replaceLines, showToast]
  );

  const discardHeldDraft = useCallback(
    (draftId: string) => {
      if (!branchId || !salesPointId) return;
      discardHeldPosDraft(branchId, salesPointId, draftId);
      setHeldDrafts(listHeldPosDrafts(branchId, salesPointId));
    },
    [branchId, salesPointId]
  );

  const closeCheckoutCustomerModal = useCallback(() => {
    if (checkoutModalBusy) return;
    setCheckoutCustomerModal(false);
    setCheckoutModalError(null);
    setCustomerModalMode('sale');
  }, [checkoutModalBusy]);

  const createDraftOrderForQuotation = useCallback(
    async (custId: string) => {
      if (!branchId || !salesPointId || lines.length === 0) return;
      if (custId === customerId && !customerAllowsSale) {
        setCheckoutModalError(INACTIVE_CUSTOMER_MSG);
        return;
      }
      setCheckoutModalBusy(true);
      setCheckoutModalError(null);
      try {
        const order = await salesService.createOrder(
          {
            mode: 'b2b',
            salesPointId,
            customerId: custId,
            lines: linesForQuotationDraftOrder(lines, branchTaxPercent),
            discountAmount: totals.discountAmount > 0 ? totals.discountAmount : undefined,
            invoiceDate: invoiceDateYmd,
          },
          branchId
        );
        setCheckoutCustomerModal(false);
        setCustomerModalMode('sale');
        setQuotationSourceOrder(order as Record<string, unknown>);
        setQuotationDrawerOpen(true);
      } catch (err: unknown) {
        setCheckoutModalError(extractErrorMessage(err, 'Could not create draft order for quotation'));
      } finally {
        setCheckoutModalBusy(false);
      }
    },
    [branchId, branchTaxPercent, customerAllowsSale, customerId, invoiceDateYmd, lines, salesPointId, totals.discountAmount]
  );

  useEffect(() => {
    const raw = searchParams.get('orderDiscount');
    if (!raw) return;
    const n = parseFloat(raw);
    if (Number.isFinite(n) && n >= 0) setDiscountInput(String(n));
    const p = new URLSearchParams(searchParams);
    p.delete('orderDiscount');
    setSearchParams(p, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (searchParams.get('startQuotation') !== '1') {
      quotationUrlToastRef.current = false;
      return;
    }
    if (customerId && !customerAllowsSale) {
      const p = new URLSearchParams(searchParams);
      p.delete('startQuotation');
      setSearchParams(p, { replace: true });
      if (!quotationUrlToastRef.current) {
        quotationUrlToastRef.current = true;
        showToast(INACTIVE_CUSTOMER_MSG);
      }
      return;
    }
    if (!customerId) {
      if (!quotationUrlToastRef.current) {
        quotationUrlToastRef.current = true;
        showToast('Select this customer on the counter, add lines, then use Quotation.');
      }
      return;
    }
    if (lines.length === 0) {
      if (!quotationUrlToastRef.current) {
        quotationUrlToastRef.current = true;
        showToast('Add items to the cart, then Quotation will open from the customer details link.');
      }
      return;
    }
    const p = new URLSearchParams(searchParams);
    p.delete('startQuotation');
    setSearchParams(p, { replace: true });
    quotationUrlToastRef.current = false;
    void createDraftOrderForQuotation(customerId);
  }, [
    searchParams,
    setSearchParams,
    customerId,
    lines.length,
    createDraftOrderForQuotation,
    customerAllowsSale,
  ]);

  const openQuotationFromCart = useCallback(() => {
    if (!branchId || !salesPointId || lines.length === 0) return;
    if (salesPointSessionStatus !== 'open') {
      setCheckoutErrorModal('This counter session is closed. Open a session to create a quotation.');
      return;
    }
    if (customerId?.trim() && !customerAllowsSale) {
      setCheckoutError(INACTIVE_CUSTOMER_MSG);
      return;
    }
    setCustomerModalMode('quotation');
    setCheckoutModalError(null);
    setCheckoutError(null);
    if (customerId) {
      void createDraftOrderForQuotation(customerId);
      return;
    }
    setCheckoutCustomerModal(true);
  }, [
    branchId,
    createDraftOrderForQuotation,
    customerAllowsSale,
    customerId,
    lines.length,
    salesPointId,
    salesPointSessionStatus,
  ]);

  const dismissQuotationShare = useCallback(() => {
    setQuotationPdfViewer((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
    setQuotationShare(null);
  }, []);

  const backFromQuotationPdf = useCallback(() => {
    setQuotationPdfViewer((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
  }, []);

  useEffect(() => {
    if (!quotationShare || !branchId) {
      setQuotationShareLink({ loading: false, error: null, data: null });
      return;
    }
    const id = entityId(quotationShare.quotation) || quotationShare.quotation._id;
    let cancelled = false;
    setQuotationShareLink({ loading: true, error: null, data: null });
    salesService
      .getQuotationShareLink(id, branchId)
      .then((data) => {
        if (!cancelled) setQuotationShareLink({ loading: false, error: null, data });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setQuotationShareLink({
            loading: false,
            error: extractErrorMessage(e, 'Could not create share link'),
            data: null,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [quotationShare, branchId]);

  const openQuotationPdfViewer = useCallback(async () => {
    if (!quotationShare || !branchId) return;
    setQuotationPdfOpening(true);
    try {
      const id = entityId(quotationShare.quotation) || quotationShare.quotation._id;
      const blob = await salesService.downloadQuotationPdfBlob(id, branchId);
      const url = URL.createObjectURL(blob);
      setQuotationPdfViewer({ url, blob });
    } catch (e: unknown) {
      showToast(extractErrorMessage(e, 'Could not load quotation PDF'));
    } finally {
      setQuotationPdfOpening(false);
    }
  }, [branchId, quotationShare, showToast]);

  const onQuotationCreatedFromPos = useCallback(
    async (q: SalesQuotation, meta?: { pdfWarning?: string | null }) => {
      if (branchId && salesPointId) clearPosDraft(branchId, salesPointId);
      clear();
      setDiscountInput('0');
      setQuotationSourceOrder(null);
      setQuotationDrawerOpen(false);

      let customerName = 'Customer';
      let customerPhone: string | undefined;
      if (q.customerId && branchId) {
        try {
          const c = await salesService.getCustomer(q.customerId, branchId);
          customerName = c.name?.trim() || customerName;
          customerPhone = c.phone?.trim() || undefined;
        } catch {
          // keep default
        }
      }

      setQuotationShare({
        quotation: q,
        customerName,
        customerPhone,
        pdfWarning: meta?.pdfWarning ?? null,
      });
      lookupInputRef.current?.focus();
    },
    [branchId, clear, salesPointId]
  );

  useEffect(() => {
    if (!customerId?.trim()) setHoldPaymentForAccount(false);
    if (customerId?.trim() && !customerAllowsSale) setHoldPaymentForAccount(false);
  }, [customerId, customerAllowsSale]);

  const completeSale = useCallback(
    async (opts?: { customerId?: string; createCustomer?: PosNewCustomerPayload; holdPayment?: boolean }) => {
      if (!branchId || !salesPointId || lines.length === 0) return;
      if (salesPointSessionStatus !== 'open') {
        setCheckoutCustomerModal(false);
        setCheckoutErrorModal('This counter session is closed. You can’t make a sale from this sales point.');
        return;
      }
      if (stockBlocked) {
        setCheckoutModalError('Reduce quantities or enable “Allow negative POS” in Settings.');
        return;
      }
      const saleCust = opts?.customerId;
      if (saleCust && saleCust === customerId && !customerAllowsSale) {
        setCheckoutModalError(INACTIVE_CUSTOMER_MSG);
        return;
      }
      setCheckoutModalBusy(true);
      setCheckoutModalError(null);
      setCheckoutError(null);
      try {
        let customerIdForOrder: string | undefined = opts?.customerId;
        if (opts?.createCustomer) {
          const p = opts.createCustomer;
          const c = await salesService.createCustomer(
            {
              name: p.name.trim() || 'Customer',
              phone: p.phone.trim(),
              email: p.email,
              gstNumber: p.gstNumber,
              segment: p.segment,
              stateUt: p.stateUt,
              paymentTerms: p.paymentTerms,
              billingAddress: p.billingAddress,
              shippingAddress: p.shippingAddress,
            },
            branchId
          );
          customerIdForOrder = c._id;
        }
        const wantHold =
          opts?.holdPayment !== undefined ? opts.holdPayment : holdPaymentForAccount;
        const res = await salesService.posCheckout(
          {
            salesPointId,
            customerId: customerIdForOrder,
            lines: linesForCheckoutPayload(lines, branchTaxPercent),
            paymentMethodCode: paymentCode,
            discountAmount: totals.discountAmount > 0 ? totals.discountAmount : undefined,
            holdPayment: Boolean(wantHold && customerIdForOrder),
            invoiceDate: invoiceDateYmd,
          },
          branchId
        );
        clearPosDraft(branchId, salesPointId);
        clear();
        setDiscountInput('0');
        setStockRefreshToken((n) => n + 1);
        setHeldDrafts(listHeldPosDrafts(branchId, salesPointId));
        setCheckoutCustomerModal(false);
        setHoldPaymentForAccount(false);
        setCheckoutSuccess({
          orderNumber: res.order?.orderNumber ?? '—',
          onAccount: Boolean(wantHold && customerIdForOrder),
        });
        setCustomerModalMode('sale');
        setSearchParams(
          (prev) => {
            const p = new URLSearchParams(prev);
            if (p.get('posOrderForCustomer') === '1') p.delete('posOrderForCustomer');
            return p;
          },
          { replace: true }
        );
      } catch (err: unknown) {
        const msg = extractErrorMessage(err, 'Checkout failed');
        if (/session is closed/i.test(msg) || /counter session is closed/i.test(msg)) {
          setCheckoutCustomerModal(false);
          setCheckoutErrorModal(msg);
        } else {
          setCheckoutModalError(msg);
        }
      } finally {
        setCheckoutModalBusy(false);
      }
    },
    [
      branchId,
      branchTaxPercent,
      clear,
      invoiceDateYmd,
      lines,
      paymentCode,
      salesPointId,
      salesPointSessionStatus,
      stockBlocked,
      totals.discountAmount,
      setSearchParams,
      customerAllowsSale,
      customerId,
      holdPaymentForAccount,
    ]
  );

  const clearPosOrderIntent = useCallback(() => {
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete('posOrderForCustomer');
        p.delete('customerId');
        return p;
      },
      { replace: true }
    );
  }, [setSearchParams]);

  const openCheckoutModal = useCallback(
    (opts?: { holdPayment?: boolean }) => {
      if (!branchId || !salesPointId || lines.length === 0) return;
      if (salesPointSessionStatus !== 'open') {
        setCheckoutError(null);
        setCheckoutErrorModal('This counter session is closed. You can’t make a sale from this sales point.');
        return;
      }
      if (stockBlocked) {
        setCheckoutError('Reduce quantities or enable “Allow negative POS” in Settings.');
        return;
      }
      if (customerId?.trim() && !customerAllowsSale) {
        setCheckoutError(INACTIVE_CUSTOMER_MSG);
        return;
      }
      const resolvedHold = opts?.holdPayment !== undefined ? opts.holdPayment : holdPaymentForAccount;
      if (opts?.holdPayment !== undefined) setHoldPaymentForAccount(resolvedHold);
      const intent = searchParams.get('posOrderForCustomer') === '1';
      if (intent && customerId?.trim()) {
        void completeSale({ customerId, holdPayment: resolvedHold });
        return;
      }
      setCustomerModalMode('sale');
      setCheckoutModalError(null);
      setCheckoutError(null);
      setCheckoutCustomerModal(true);
    },
    [
      branchId,
      completeSale,
      customerAllowsSale,
      customerId,
      lines.length,
      salesPointId,
      salesPointSessionStatus,
      searchParams,
      stockBlocked,
      holdPaymentForAccount,
    ]
  );

  const onCustomerModalConfirmExisting = useCallback(
    (id: string) => {
      if (customerModalMode === 'quotation') void createDraftOrderForQuotation(id);
      else void completeSale({ customerId: id, holdPayment: holdPaymentForAccount });
    },
    [completeSale, createDraftOrderForQuotation, customerModalMode, holdPaymentForAccount]
  );

  const onCustomerModalConfirmNew = useCallback(
    (payload: PosNewCustomerPayload) => {
      if (customerModalMode === 'sale') {
        void completeSale({ createCustomer: payload, holdPayment: holdPaymentForAccount });
        return;
      }
      void (async () => {
        setCheckoutModalBusy(true);
        setCheckoutModalError(null);
        try {
          const c = await salesService.createCustomer(
            {
              name: payload.name.trim() || 'Customer',
              phone: payload.phone.trim(),
              email: payload.email,
              gstNumber: payload.gstNumber,
              segment: payload.segment,
              stateUt: payload.stateUt,
              paymentTerms: payload.paymentTerms,
              billingAddress: payload.billingAddress,
              shippingAddress: payload.shippingAddress,
            },
            branchId
          );
          await createDraftOrderForQuotation(c._id);
        } catch (err: unknown) {
          setCheckoutModalError(extractErrorMessage(err, 'Could not create customer or draft order'));
        } finally {
          setCheckoutModalBusy(false);
        }
      })();
    },
    [branchId, completeSale, createDraftOrderForQuotation, customerModalMode, holdPaymentForAccount]
  );

  const holdOrder = useCallback(() => {
    if (!branchId || !salesPointId || lines.length === 0) {
      showToast('Add items before holding');
      return;
    }
    holdPosDraft(branchId, salesPointId, lines);
    setHeldDrafts(listHeldPosDrafts(branchId, salesPointId));
    // Clear the current cart UI immediately after holding,
    // and refresh the draft banner so it reflects the newly saved draft.
    clear();
    // working draft stays separate; no banner needed
    setLookupQuery('');
    setSuggestions([]);
    setSearchSuggestionsLoading(false);
    setSuggestOpen(false);
    setHighlightIndex(null);
    setCheckoutError(null);
    setDiscountInput('0');
    showToast('Order held (draft saved)');
    lookupInputRef.current?.focus();
  }, [branchId, salesPointId, lines, showToast]);

  const applyPastedBarcode = async () => {
    const v = pasteBarcode.trim();
    if (!v) return;
    setLookupQuery(v);
    const resolved = await resolveBarcodeForPos(v);
    setCameraOpen(false);
    setPasteBarcode('');
    if (resolved) await addLineFromMeta(resolved, 1);
    else setCheckoutError('Unknown barcode.');
  };

  const hasBarcodeDetector =
    typeof window !== 'undefined' && 'BarcodeDetector' in window && Boolean((window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector);

  const lookupCombobox = (
    <div ref={lookupWrapRef} className="pos-lookup-combobox">
      <form onSubmit={handleLookupSubmit} className="pos-lookup-form">
        <div className="pos-search-field">
          <span className="pos-search-field__icon" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
          </span>
          <div className="pos-search-field__input">
            <Input
              ref={lookupInputRef}
              id="pos-product-lookup-input"
              role="combobox"
              aria-expanded={showSuggestPanel}
              aria-controls="pos-product-lookup-panel"
              aria-autocomplete="list"
              aria-activedescendant={
                highlightIndex !== null && suggestions.length > 0
                  ? `pos-lookup-option-${highlightIndex}`
                  : undefined
              }
              value={lookupQuery}
              onChange={(e) => {
                setLookupQuery(e.target.value);
                setSuggestOpen(true);
                setHighlightIndex(null);
              }}
              onFocus={() => setSuggestOpen(true)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  if (suggestPanelLoading || suggestions.length === 0) return;
                  e.preventDefault();
                  setSuggestOpen(true);
                  setHighlightIndex((prev) => {
                    if (prev === null) return 0;
                    return Math.min(prev + 1, suggestions.length - 1);
                  });
                  return;
                }
                if (e.key === 'ArrowUp') {
                  if (suggestPanelLoading || suggestions.length === 0) return;
                  e.preventDefault();
                  setSuggestOpen(true);
                  setHighlightIndex((prev) => {
                    if (prev === null) return suggestions.length - 1;
                    return Math.max(0, prev - 1);
                  });
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setSuggestOpen(false);
                  setHighlightIndex(null);
                }
              }}
              placeholder={
                salesPointId
                  ? 'Scan barcode or type name, SKU… (Enter to add)'
                  : 'Select a sales point first'
              }
              autoComplete="off"
              disabled={!salesPointId}
            />
          </div>
        </div>
      </form>
      {showSuggestPanel ? (
        <div
          id="pos-product-lookup-panel"
          className="pos-suggest-panel"
          aria-busy={suggestPanelLoading}
        >
          {suggestPanelLoading ? (
            <div className="pos-suggest-loading" role="status" aria-live="polite">
              <span className="pos-suggest-loading__spinner" aria-hidden />
              <span className="pos-suggest-loading__text">
                {lookupDebouncing ? 'Searching…' : 'Searching products…'}
              </span>
            </div>
          ) : suggestions.length === 0 ? (
            <div className="pos-suggest-empty" role="status">
              No matching products. Try another term or scan a barcode.
            </div>
          ) : (
            <ul
              id="pos-product-lookup-listbox"
              className="pos-suggest-list"
              role="listbox"
              aria-label="Matching products"
            >
              {suggestions.map((it, idx) => {
                const badge = posSearchMatchBadge(it.searchMatch);
                const vm = it.searchMatch?.variant;
                const showVariantDetail =
                  !!vm && (it.searchMatch?.kind === 'variant' || it.searchMatch?.kind === 'both');
                const ariaParts = [
                  badge.label,
                  it.name,
                  showVariantDetail && vm?.name ? vm.name : null,
                  it.sku ? `SKU ${it.sku}` : null,
                ].filter(Boolean);
                return (
                  <li key={`${it.id}-${idx}`} role="presentation">
                    <button
                      type="button"
                      id={`pos-lookup-option-${idx}`}
                      role="option"
                      aria-selected={highlightIndex === idx}
                      aria-label={ariaParts.join('. ')}
                      title={badge.title}
                      className={`pos-suggest-item ${highlightIndex === idx ? 'pos-suggest-item--active' : ''}`}
                      onMouseEnter={() => setHighlightIndex(idx)}
                      onClick={() => onPickSearchItem(it)}
                    >
                      <div className="pos-suggest-item__row">
                        <span className={`pos-suggest-badge ${badge.className}`}>{badge.label}</span>
                        <span className="pos-suggest-name">{it.name}</span>
                      </div>
                      {showVariantDetail && vm ? (
                        <span className="pos-suggest-variant">
                          <span className="pos-suggest-variant__label">Variant</span>
                          <span className="pos-suggest-variant__text">
                            {vm.name}
                            {vm.code ? ` · ${vm.code}` : ''}
                          </span>
                        </span>
                      ) : null}
                      <span className="pos-suggest-sku">
                        {it.hasVariants && it.searchMatch?.kind === 'master'
                          ? `Listing SKU: ${it.sku}`
                          : `SKU: ${it.sku}`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="pos-shell">
      {toast ? (
        <div className="pos-toast" role="status">
          {toast}
        </div>
      ) : null}

      <div className="pos-main">
        {posHydrateOrderBusy ? (
          <div className="pos-hydrate-overlay" role="status" aria-live="polite">
            Loading order…
          </div>
        ) : null}
        <section className="pos-scan" aria-label="Find and add products">
          {heldDrafts.length > 0 ? (
            <div className="pos-draft-banner" role="status" aria-label="Drafts">
              <span className="pos-draft-banner__text">Drafts ({heldDrafts.length})</span>
              <div className="pos-draft-banner__actions" style={{ gap: 8, flexWrap: 'wrap' }}>
                {heldDrafts.slice(0, 6).map((d, idx) => (
                  <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="pos-muted" style={{ fontSize: 12 }}>
                      Draft {heldDrafts.length - idx}
                    </span>
                    <Button type="button" variant="primary" onClick={() => resumeHeldDraft(d)}>
                      Resume
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => discardHeldDraft(d.id)}>
                      Discard
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <PosQuickAddGrid
            branchId={branchId}
            salesPointId={salesPointId}
            customerId={customerId}
            locationId={locationId}
            refreshToken={stockRefreshToken}
            disabled={checkoutModalBusy || checkoutCustomerModal}
            categoryChip={categoryChip}
            onCategoryChipChange={setCategoryChip}
            inStockOnly={inStockOnly}
            onInStockOnlyChange={setInStockOnly}
            onActivateProduct={handleActivateProduct}
          />

          <PosMiscSlider
            branchId={branchId}
            salesPointId={salesPointId}
            disabled={checkoutModalBusy || checkoutCustomerModal}
            onActivateProduct={handleActivateProduct}
          />

          <PosVariantPickerModal
            isOpen={Boolean(variantPicker)}
            onClose={() => setVariantPicker(null)}
            item={variantPicker?.item ?? null}
            variants={variantPicker?.variants ?? []}
            locationId={locationId}
            salesPointId={salesPointId}
            customerId={customerId}
            highlightVariantId={variantPicker?.highlightVariantId ?? null}
            resolvePrice={resolvePrice}
            onConfirm={handleVariantPickerConfirm}
          />

          {/* eslint-disable-next-line no-constant-condition -- intentionally disabled recent strip */}
          {false && recent.length > 0 && salesPointId ? (
            <div className="pos-recent">
              {/* <span className="pos-recent-label">Recent</span> */}
              <div className="pos-recent-scroll">
                <button
                  type="button"
                  className="pos-recent-arrow pos-recent-arrow--left"
                  onClick={() => recentWrapRef.current?.scrollBy({ left: -280, behavior: 'smooth' })}
                  disabled={!recentScroll.left}
                  aria-label="Scroll recent left"
                >
                  ‹
                </button>
                <div ref={recentWrapRef} className="pos-recent-chips" role="list">
                  {recent.slice(0, 12).map((r) => (
                    <button
                      key={r.variantId}
                      type="button"
                      className="pos-chip"
                      onClick={() => onRecentClick(r)}
                      role="listitem"
                      title={r.label}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="pos-recent-arrow pos-recent-arrow--right"
                  onClick={() => recentWrapRef.current?.scrollBy({ left: 280, behavior: 'smooth' })}
                  disabled={!recentScroll.right}
                  aria-label="Scroll recent right"
                >
                  ›
                </button>
              </div>
            </div>
          ) : null}

          <footer className="pos-summary">
            <div className="pos-summary__rows">
              <div className="pos-summary__row">
                <span>Subtotal</span>
                <span>₹{totals.subtotal.toFixed(2)}</span>
              </div>
              <div className="pos-summary__row">
                <span>Discount</span>
                <span className="pos-summary__discount-inline">
                  <span className="pos-summary__discount-currency">₹</span>
                  <input
                    className="pos-summary__discount-field"
                    type="number"
                    min={0}
                    step="0.01"
                    value={discountInput}
                    onChange={(e) => setDiscountInput(e.target.value)}
                    aria-label="Order discount amount"
                  />
                </span>
              </div>
              <div className="pos-summary__row pos-summary__row--total">
                <span>Total</span>
                <span>₹{totals.total.toFixed(2)}</span>
              </div>
            </div>

            <div className="pos-payment-toggles" role="group" aria-label="Payment method">
              {payOpts.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className={`pos-pay-toggle ${paymentCode === p.value ? 'pos-pay-toggle--active' : ''}`}
                  onClick={() => setPaymentCode(p.value)}
                  aria-pressed={paymentCode === p.value}
                  disabled={holdPaymentForAccount}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="pos-charge-row">
              <div className="pos-charge-row__docs" role="group" aria-label="Documents before payment">
                <button
                  type="button"
                  className="pos-doc-btn pos-doc-btn--quotation"
                  onClick={openQuotationFromCart}
                  disabled={
                    checkoutModalBusy ||
                    checkoutCustomerModal ||
                    lines.length === 0 ||
                    !salesPointId ||
                    salesPointSessionStatus !== 'open' ||
                    (Boolean(customerId?.trim()) && !customerAllowsSale)
                  }
                  title="Save cart as a B2B draft order and open the quotation builder (customer required)"
                >
                  <span className="pos-doc-btn__icon" aria-hidden>
                    ◇
                  </span>
                  <span className="pos-doc-btn__text">
                    <span className="pos-doc-btn__label">Quotation</span>
                    <span className="pos-doc-btn__hint">from cart</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="pos-doc-btn pos-doc-btn--invoice"
                  disabled
                  title="Invoices from completed sales are not available in the app yet. Use Charge to complete a sale, or create a Quotation for a proposal PDF."
                >
                  <span className="pos-doc-btn__icon" aria-hidden>
                    ⧉
                  </span>
                  <span className="pos-doc-btn__text">
                    <span className="pos-doc-btn__label">Invoice</span>
                    <span className="pos-doc-btn__hint">soon</span>
                  </span>
                </button>
              </div>
              <div className="pos-charge-row__actions">
                <Button
                  type="button"
                  variant="primary"
                  className="pos-charge-btn"
                  onClick={() => openCheckoutModal()}
                  disabled={
                    checkoutModalBusy ||
                    checkoutCustomerModal ||
                    lines.length === 0 ||
                    !salesPointId ||
                    stockBlocked ||
                    salesPointSessionStatus !== 'open' ||
                    (Boolean(customerId?.trim()) && !customerAllowsSale)
                  }
                >
                  {checkoutModalBusy ? 'Processing…' : `Charge ₹${totals.total.toFixed(2)}`}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="pos-pay-later-btn"
                  onClick={() => openCheckoutModal({ holdPayment: true })}
                  disabled={
                    checkoutModalBusy ||
                    checkoutCustomerModal ||
                    lines.length === 0 ||
                    !salesPointId ||
                    stockBlocked ||
                    salesPointSessionStatus !== 'open' ||
                    (Boolean(customerId?.trim()) && !customerAllowsSale)
                  }
                  title="Add this sale to the customer’s outstanding balance (choose customer at checkout)"
                >
                  Pay later
                </Button>
              </div>
            </div>

            {customerId?.trim() && !customerAllowsSale ? (
              <div className="sales-panel-error pos-checkout-err">{INACTIVE_CUSTOMER_MSG}</div>
            ) : null}
            {checkoutError ? <div className="sales-panel-error pos-checkout-err">{checkoutError}</div> : null}
          </footer>
        </section>

        <div className="pos-right">
          <div className="pos-order-head">
            <div className="pos-order-head__top">
              <div className="pos-order-head__left">
                {lookupCombobox}
              </div>
              <div className="pos-order-head__actions">
                <Button type="button" variant="secondary" onClick={holdOrder} disabled={checkoutModalBusy}>
                  Hold order
                </Button>
                {posOrderForCustomerIntent && customerId && intentCustomerLabel ? (
                  <div className="pos-order-for-customer" role="status">
                    <span className="pos-order-for-customer__text">For {intentCustomerLabel}</span>
                    <button
                      type="button"
                      className="pos-order-for-customer__clear"
                      aria-label="Stop creating this order for this customer"
                      onClick={clearPosOrderIntent}
                    >
                      ×
                    </button>
                  </div>
                ) : null}
                <Button type="button" variant="secondary" onClick={handleNewSale}>
                  Clear
                </Button>
              </div>
            </div>
          </div>


          <section className="pos-cart" aria-label="Cart">
            {lines.length === 0 ? (
              <div className="pos-empty">
                <div className="pos-empty__box">
                  <p className="pos-empty__title">Scan a product to start a sale</p>
                  <p className="pos-empty__sub">
                    Use scan or search and quick-add cards for regular products; use the MISC strip below for
                    non-stock items. Lines merge by variant.
                  </p>
                </div>
              </div>
            ) : (
              <div className="pos-cart-list-col">
                <div className="pos-cart-list">
                  {lines.map((line) => {
                    const lineTotal = getLineTotalWithGst(line, branchTaxPercent);
                    const avail = availableByVariant[line.variantId];
                    const unitFactor = getUnitFactor(line, line.unitOfMeasure);
                    const warn =
                      !line.isNonStock &&
                      !line.allowNegativeStock &&
                      !settings?.allowNegativePos &&
                      avail !== undefined &&
                      line.quantity * unitFactor > avail;
                    const availableInSelectedUnit =
                      avail === undefined ? undefined : Math.round((avail / unitFactor) * 1000) / 1000;
                    return (
                      <PosCartLineListCard
                        key={line.variantId}
                        line={line}
                        lineTotal={lineTotal}
                        selected={selectedDetailVariantId === line.variantId}
                        flash={lastMergedVariantId === line.variantId}
                        available={availableInSelectedUnit}
                        showStockWarning={warn}
                        onSelect={() => setSelectedDetailVariantId(line.variantId)}
                        onQuantityChange={(q) => setLineQuantity(line.variantId, q)}
                        onUnitChange={(unitOfMeasure) => {
                          const currentFactor = getUnitFactor(line, line.unitOfMeasure);
                          const nextFactor = getUnitFactor(line, unitOfMeasure);
                          const nextUnitPrice = (line.unitPrice / currentFactor) * nextFactor;
                          updateLine(line.variantId, {
                            unitOfMeasure,
                            unitPrice: Math.round(nextUnitPrice * 10000) / 10000,
                          });
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </section>

        </div>
      </div>

      <Modal
        isOpen={Boolean(selectedDetailVariantId && selectedDetailLine)}
        onClose={() => setSelectedDetailVariantId(null)}
        size="lg"
        className="pos-cart-detail-modal"
      >
        {selectedDetailLine ? (
          <PosCartItemDetailPanel
            line={selectedDetailLine}
            embeddedInModal
            branchTaxPercent={branchTaxPercent}
            onUpdate={handleDetailUpdate}
            onRemove={handleDetailRemove}
            onSave={() => setSelectedDetailVariantId(null)}
            onClose={() => setSelectedDetailVariantId(null)}
          />
        ) : null}
      </Modal>

      {cameraOpen ? (
        <div className="pos-modal-overlay" role="dialog" aria-modal="true" aria-label="Barcode">
          <div className="pos-modal">
            <h3 className="pos-modal__title">Barcode</h3>
            <p className="pos-muted">
              {hasBarcodeDetector
                ? 'Paste a code below. Camera scanning can be extended with getUserMedia + BarcodeDetector.'
                : 'Paste a barcode value. BarcodeDetector API is not available in this browser.'}
            </p>
            <Input
              label="Paste barcode"
              value={pasteBarcode}
              onChange={(e) => setPasteBarcode(e.target.value)}
              autoFocus
            />
            <div className="pos-modal__actions">
              <Button type="button" variant="primary" onClick={applyPastedBarcode}>
                Add from paste
              </Button>
              <Button type="button" variant="secondary" onClick={() => setCameraOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <Modal
        isOpen={checkoutCustomerModal}
        onClose={closeCheckoutCustomerModal}
        title={customerModalMode === 'quotation' ? 'Customer for quotation' : 'Customer for this sale'}
        size="xl"
        className="pos-checkout-customer-modal-wrap"
      >
        <PosCustomerSelectionModal
          isOpen={checkoutCustomerModal}
          mode={customerModalMode}
          branchId={branchId}
          busy={checkoutModalBusy}
          error={checkoutModalError}
          counterCustomerId={customerId}
          counterCustomerName={counterCustomerName}
          hideWalkIn={holdPaymentForAccount}
          onClose={closeCheckoutCustomerModal}
          onConfirmExisting={onCustomerModalConfirmExisting}
          onConfirmNew={onCustomerModalConfirmNew}
          onWalkIn={() => void completeSale()}
          onUseCounterCustomer={(id) =>
            void (customerModalMode === 'quotation'
              ? createDraftOrderForQuotation(id)
              : completeSale({ customerId: id, holdPayment: holdPaymentForAccount }))
          }
        />
      </Modal>

      <Modal
        isOpen={Boolean(checkoutSuccess)}
        onClose={() => {
          setCheckoutSuccess(null);
          lookupInputRef.current?.focus();
        }}
        title="Sale complete"
        size="sm"
      >
        <div className="pos-checkout-success">
          <p className="pos-checkout-success__line">
            <span className="pos-checkout-success__k">Order</span>{' '}
            <span className="pos-checkout-success__v">{checkoutSuccess?.orderNumber}</span>
          </p>
          {checkoutSuccess?.onAccount ? (
            <p className="pos-checkout-success__note">
              Payment deferred — this amount is included in the customer&apos;s outstanding balance until recorded in
              Customers → Payments.
            </p>
          ) : null}
          <div className="pos-checkout-success__actions">
            <Button
              variant="primary"
              onClick={() => {
                setCheckoutSuccess(null);
                lookupInputRef.current?.focus();
              }}
            >
              Continue
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(checkoutErrorModal)}
        onClose={() => setCheckoutErrorModal(null)}
        title="Can’t complete sale"
        size="sm"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, color: '#334155', lineHeight: 1.5 }}>
            {checkoutErrorModal}
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="primary" onClick={() => setCheckoutErrorModal(null)}>
              OK
            </Button>
          </div>
        </div>
      </Modal>

      <QuotationFromOrderDrawer
        isOpen={quotationDrawerOpen}
        order={quotationSourceOrder}
        branchId={branchId}
        onClose={() => {
          setQuotationDrawerOpen(false);
          setQuotationSourceOrder(null);
        }}
        onCreated={onQuotationCreatedFromPos}
      />

      {quotationShare && !quotationPdfViewer ? (
        <QuotationShareModal
          isOpen
          quotation={quotationShare.quotation}
          customerName={quotationShare.customerName}
          customerPhone={quotationShare.customerPhone}
          shareLink={quotationShareLink}
          pdfWarning={quotationShare.pdfWarning}
          printLoading={quotationPdfOpening}
          onClose={dismissQuotationShare}
          onSelectPrint={() => void openQuotationPdfViewer()}
        />
      ) : null}

      {quotationShare && quotationPdfViewer ? (
        <QuotationPdfViewerScreen
          quotation={quotationShare.quotation}
          customerName={quotationShare.customerName}
          customerPhone={quotationShare.customerPhone}
          shareLink={quotationShareLink}
          pdfBlobUrl={quotationPdfViewer.url}
          pdfBlob={quotationPdfViewer.blob}
          onBack={backFromQuotationPdf}
        />
      ) : null}
    </div>
  );
};
