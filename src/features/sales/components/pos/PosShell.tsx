import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Input } from '@/shared/components/ui';
import { inventoryService, type InventoryItem, type InventoryVariant } from '@/services/inventory.service';
import { salesService, type SalesSettingsData, type SalesQuotation } from '@/services/sales.service';
import type { ItemSearchResult } from '@/features/inventory/types/search.types';
import type { SearchComboboxSubmitContext } from '@/shared/components/ui/SearchCombobox';
import { usePriceResolver } from '../../hooks/usePriceResolver';
import { computePosCartTotals } from './posTotals';
import {
  linesForCheckoutPayload,
  linesForQuotationDraftOrder,
  normalizePosGstRatePercent,
  getLineTotalWithGst,
} from './posLineMath';
import { extractErrorMessage, isPosCheckoutBlockingError } from '@/utils/error';
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
  isMongoObjectId,
  resolveBarcodeForPos,
  resolveVariantIdForPos,
  type PosResolvedLineMeta,
} from './resolveScan';
import { PosCartLineListCard } from './PosCartLineListCard';
import { PosCartItemDetailPanel } from './PosCartItemDetailPanel';
import { usePosCart, type PosCartLine } from './usePosCart';
import { PosQuickAddGrid } from './PosQuickAddGrid';
import { PosProductLookup } from './PosProductLookup';
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
import { PosPaymentSplitSection } from './PosPaymentSplitSection';
import { PosPaymentDetailsModal } from './PosPaymentDetailsModal';
import {
  RecordPickupPaymentModal,
  type FulfillmentOrderLine,
} from '../fulfillment/RecordPickupPaymentModal';
import { orderCollectedAmount } from '../../utils/orderPayments';
import {
  buildCheckoutPayments,
  checkoutUnallocated,
  computeCashRemainder,
  emptyNonCashAmounts,
  getOnAccountAmountInput,
  isCheckoutBalanced,
  isCheckoutOverAllocated,
  maxNonCashForMethod,
  nonCashAmountsFromInputs,
  parsePaymentAmountInput,
  roundMoney,
  sumCollectedTender,
  sumNonCashAmounts,
  type PosPaymentMethodDetails,
} from './posPaymentSplit';
import { formatPosQuantityDisplay, roundPosQuantity } from './posQuantity';
import {
  countIncompletePosSerialLines,
  normalizePosSerial,
  trimSerialsToQuantity,
  isPosSerialLineComplete,
} from './posSerialUtils';
import {
  CounterWorkspaceShell,
  CounterHeldDraftsBanner,
  CounterCartEmptyState,
  CounterSummaryRows,
} from '@/shared/components/counter-workspace';
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

const DEFAULT_PAY_OPTS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'upi', label: 'UPI' },
] as const;

function paymentOptionsFromSettings(s: SalesSettingsData | null) {
  if (!s?.paymentMethods?.length) {
    return [...DEFAULT_PAY_OPTS];
  }
  const enabled = [...s.paymentMethods]
    .filter((p) => p.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((p) => ({ value: p.code, label: p.label }));
  return enabled.length > 0 ? enabled : [...DEFAULT_PAY_OPTS];
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
  const { resolvePrice, resolvePricesBatch } = usePriceResolver(branchId);
  const lookupInputRef = useRef<HTMLInputElement>(null);

  const [settings, setSettings] = useState<SalesSettingsData | null>(null);
  const [lookupQuery, setLookupQuery] = useState('');
  const [nonCashAmountInputs, setNonCashAmountInputs] = useState<Record<string, string>>({});
  const [paymentDetailsByMethod, setPaymentDetailsByMethod] = useState<
    Record<string, PosPaymentMethodDetails>
  >({});
  const [paymentDetailsModal, setPaymentDetailsModal] = useState<{
    methodCode: string;
    methodLabel: string;
  } | null>(null);
  const [onAccountInput, setOnAccountInput] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutErrorModal, setCheckoutErrorModal] = useState<string | null>(null);
  const [checkoutCustomerModal, setCheckoutCustomerModal] = useState(false);
  const [checkoutModalBusy, setCheckoutModalBusy] = useState(false);
  const [checkoutModalError, setCheckoutModalError] = useState<string | null>(null);
  const [saveOrderBusy, setSaveOrderBusy] = useState(false);
  const [savedOrderPrompt, setSavedOrderPrompt] = useState<Record<string, unknown> | null>(null);
  const [fulfillmentModalOpen, setFulfillmentModalOpen] = useState(false);
  const [counterCustomerName, setCounterCustomerName] = useState<string | null>(null);
  const [intentCustomerLabel, setIntentCustomerLabel] = useState<string | null>(null);
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
  const [detailFocusPrice, setDetailFocusPrice] = useState(false);
  const [detailFocusSerial, setDetailFocusSerial] = useState(false);

  const [variantPicker, setVariantPicker] = useState<{
    item: InventoryItem;
    variants: InventoryVariant[];
    highlightVariantId: string | null;
  } | null>(null);

  const closeCartDetailModal = useCallback(() => {
    setSelectedDetailVariantId(null);
    setDetailFocusPrice(false);
    setDetailFocusSerial(false);
    lookupInputRef.current?.focus();
  }, []);

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
    document.body.dataset.salesPosActive = '1';
    return () => {
      delete document.body.dataset.salesPosActive;
    };
  }, []);

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
    if (!locationId || lines.length === 0) {
      setAvailableByVariant({});
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      (async () => {
        const unique = new Map<string, { itemId: string; variantId: string }>();
        for (const line of lines) {
          if (line.isNonStock) continue;
          unique.set(line.variantId, { itemId: line.itemId, variantId: line.variantId });
        }
        const entries = [...unique.values()];
        const pairs = await Promise.all(
          entries.map(async ({ itemId, variantId }) => {
            try {
              const b = await inventoryService.getStockBalance(itemId, locationId, undefined, variantId);
              return [variantId, b.available] as const;
            } catch {
              return [variantId, 0] as const;
            }
          })
        );
        if (!cancelled) setAvailableByVariant(Object.fromEntries(pairs));
      })();
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
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
    setNonCashAmountInputs(emptyNonCashAmounts(payOpts));
  }, [payOpts]);

  const branchTaxPercent = settings?.taxRatePercent ?? 0;

  const totals = useMemo(() => {
    if (!settings) {
      return { subtotal: 0, discountAmount: 0, taxAmount: 0, total: 0 };
    }
    return computePosCartTotals(lines, branchTaxPercent, discountAmount);
  }, [lines, settings, discountAmount, branchTaxPercent]);

  const nonCashAmounts = useMemo(
    () => nonCashAmountsFromInputs(payOpts, nonCashAmountInputs),
    [payOpts, nonCashAmountInputs],
  );

  const onAccountAmount = useMemo(() => getOnAccountAmountInput(onAccountInput), [onAccountInput]);

  /** No counter customer yet — on-account still editable; customer required at checkout. */
  const onAccountNeedsCustomer = !customerId?.trim();

  const cashPaymentAmount = useMemo(
    () => computeCashRemainder(totals.total, nonCashAmounts, onAccountAmount),
    [totals.total, nonCashAmounts, onAccountAmount],
  );

  const paidNowAmount = useMemo(
    () => sumCollectedTender(totals.total, nonCashAmounts, onAccountAmount),
    [totals.total, nonCashAmounts, onAccountAmount],
  );

  const paymentUnallocated = useMemo(
    () => checkoutUnallocated(totals.total, nonCashAmounts, onAccountAmount),
    [totals.total, nonCashAmounts, onAccountAmount],
  );

  const paymentSplitOverAllocated = useMemo(
    () => isCheckoutOverAllocated(totals.total, nonCashAmounts, onAccountAmount),
    [totals.total, nonCashAmounts, onAccountAmount],
  );

  /** Split equals total (cash reflects on-account deduction). Customer checked at checkout. */
  const paymentSplitBalanced = useMemo(() => {
    if (totals.total < 0) return false;
    if (paymentSplitOverAllocated) return false;
    return isCheckoutBalanced(totals.total, nonCashAmounts, onAccountAmount);
  }, [totals.total, nonCashAmounts, onAccountAmount, paymentSplitOverAllocated]);

  const resetPaymentSplit = useCallback(() => {
    setNonCashAmountInputs(emptyNonCashAmounts(payOpts));
    setOnAccountInput('');
    setPaymentDetailsByMethod({});
    setPaymentDetailsModal(null);
  }, [payOpts]);

  const handleNonCashAmountChange = useCallback(
    (methodCode: string, raw: string) => {
      setNonCashAmountInputs((prev) => {
        const current = nonCashAmountsFromInputs(payOpts, prev);
        const maxAllowed = maxNonCashForMethod(totals.total, methodCode, current, onAccountAmount);
        let nextVal = parsePaymentAmountInput(raw);
        if (nextVal > maxAllowed) nextVal = maxAllowed;
        const display = raw.trim() === '' ? '' : String(nextVal);
        return { ...prev, [methodCode]: display };
      });
    },
    [payOpts, totals.total, onAccountAmount],
  );

  const handleOnAccountChange = useCallback(
    (raw: string) => {
      if (raw.trim() === '') {
        setOnAccountInput('');
        return;
      }
      const current = nonCashAmountsFromInputs(payOpts, nonCashAmountInputs);
      const maxOa = roundMoney(Math.max(0, totals.total - sumNonCashAmounts(current)));
      let nextVal = parsePaymentAmountInput(raw);
      if (nextVal > maxOa) nextVal = maxOa;
      setOnAccountInput(String(nextVal));
    },
    [payOpts, nonCashAmountInputs, totals.total],
  );

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

  const incompleteSerialLineCount = useMemo(
    () => countIncompletePosSerialLines(lines),
    [lines]
  );

  const chargeDisabled = useMemo(
    () =>
      checkoutModalBusy ||
      checkoutCustomerModal ||
      lines.length === 0 ||
      !salesPointId ||
      stockBlocked ||
      incompleteSerialLineCount > 0 ||
      salesPointSessionStatus !== 'open' ||
      (Boolean(customerId?.trim()) && !customerAllowsSale) ||
      !paymentSplitBalanced,
    [
      checkoutModalBusy,
      checkoutCustomerModal,
      lines.length,
      salesPointId,
      stockBlocked,
      incompleteSerialLineCount,
      salesPointSessionStatus,
      customerId,
      customerAllowsSale,
      paymentSplitBalanced,
    ]
  );

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const handleDetailUpdate = useCallback(
    (patch: Partial<PosCartLine>) => {
      if (!selectedDetailVariantId) return;
      const current = lines.find((l) => l.variantId === selectedDetailVariantId);
      if (!current) return;
      const nextPatch = { ...patch };
      if (current.serialWarning && nextPatch.quantity != null) {
        nextPatch.serialNumbers = trimSerialsToQuantity(
          { ...current, ...nextPatch },
          nextPatch.quantity
        );
      }
      if (patch.unitOfMeasure && patch.unitOfMeasure !== current.unitOfMeasure) {
        const currentFactor = getUnitFactor(current, current.unitOfMeasure);
        const nextFactor = getUnitFactor(current, patch.unitOfMeasure);
        const nextUnitPrice = (current.unitPrice / currentFactor) * nextFactor;
        updateLine(selectedDetailVariantId, {
          ...nextPatch,
          unitOfMeasure: patch.unitOfMeasure,
          unitPrice: Math.round(nextUnitPrice * 10000) / 10000,
        });
        return;
      }
      updateLine(selectedDetailVariantId, nextPatch);
    },
    [getUnitFactor, lines, selectedDetailVariantId, updateLine]
  );

  const otherCartSerialsForLine = useCallback(
    (variantId: string) => {
      const out: string[] = [];
      for (const ln of lines) {
        if (ln.variantId === variantId) continue;
        for (const sn of ln.serialNumbers ?? []) {
          out.push(normalizePosSerial(sn));
        }
      }
      return out;
    },
    [lines]
  );

  const openLineDetail = useCallback(
    (variantId: string, opts?: { focusPrice?: boolean; focusSerial?: boolean }) => {
      setDetailFocusPrice(opts?.focusPrice === true);
      setDetailFocusSerial(opts?.focusSerial === true);
      setSelectedDetailVariantId(variantId);
    },
    []
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
    removeLine(selectedDetailVariantId);
    closeCartDetailModal();
  }, [closeCartDetailModal, removeLine, selectedDetailVariantId]);

  const setLineQuantity = useCallback(
    (variantId: string, nextQty: number) => {
      const q = roundPosQuantity(Number(nextQty));
      if (!Number.isFinite(q)) return;
      if (q <= 0) {
        removeLineFromCart(variantId);
        return;
      }
      const cap = 999_999;
      const qty = Math.min(cap, q);
      const current = lines.find((l) => l.variantId === variantId);
      if (current?.serialWarning) {
        updateLine(variantId, {
          quantity: qty,
          serialNumbers: trimSerialsToQuantity(current, qty),
        });
        return;
      }
      updateLine(variantId, { quantity: qty });
    },
    [lines, removeLineFromCart, updateLine]
  );

  const addLineFromMeta = useCallback(
    async (
      meta: PosResolvedLineMeta,
      qty = 1,
      options?: {
        quiet?: boolean;
        skipDetailAfterAdd?: boolean;
        unitPrice?: number;
        notes?: string;
        hsn?: string;
        gstRatePercent?: number;
        unitOfMeasure?: string;
      }
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
        const lineQty = roundPosQuantity(qty);
        if (lineQty <= 0) return;
        addOrMerge({
          variantId: meta.variantId,
          itemId: meta.itemId,
          sku: meta.sku,
          label: meta.label,
          quantity: lineQty,
          unitPrice: pr.price,
          isNonStock: meta.isNonStock,
          allowNegativeStock: meta.allowNegativeStock,
          serialWarning: meta.serialWarning,
          batchWarning: meta.batchWarning,
          lineDiscountType: 'per_unit',
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
        const openDetail = !options?.skipDetailAfterAdd && !options?.quiet;
        if (!options?.quiet) {
          showToast(`Added: ${meta.label}`);
          setLookupQuery('');
        }
        if (openDetail) {
          if (meta.serialWarning) {
            openLineDetail(meta.variantId, { focusSerial: true });
          } else {
            openLineDetail(meta.variantId, { focusPrice: true });
          }
        } else if (!options?.quiet) {
          lookupInputRef.current?.focus();
        }
      } catch (e: unknown) {
        setCheckoutError(e instanceof Error ? e.message : 'Could not resolve price');
      }
    },
    [addOrMerge, branchId, customerId, openLineDetail, resolvePrice, salesPointId, settings?.taxRatePercent, showToast]
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
          const qty = roundPosQuantity(
            Math.max(
              0,
              Number(
                (ln as { enteredQuantity?: number }).enteredQuantity ?? ln.quantity ?? 0,
              ),
            ),
          );
          if (qty <= 0) continue;
          await addLineFromMetaRef.current(meta, qty, {
            quiet: true,
            skipDetailAfterAdd: true,
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
      let fullItem = item;
      try {
        fullItem = await inventoryService.getItemById(item.id);
      } catch {
        /* use catalog stub when fetch fails */
      }
      if (variants.length === 1) {
        const meta = buildLineMetaFromItemVariant(fullItem, variants[0]);
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
      setVariantPicker({
        item: fullItem,
        variants,
        highlightVariantId: hi,
      });
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
            ? `${formatPosQuantityDisplay(picked[0].quantity)}× ${picked[0].meta.label}`
            : `${units} units across ${picked.length} variants`;
        showToast(`Added to cart: ${label}`);
        setVariantPicker(null);
        setLookupQuery('');
        const last = picked[picked.length - 1];
        setSelectedDetailVariantId(last.meta.variantId);
        setDetailFocusPrice(true);
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
        const sm = item.searchMatch;
        const hintedVariantId =
          sm?.variant?.id &&
          (sm.kind === 'variant' || sm.kind === 'both') &&
          isMongoObjectId(sm.variant.id)
            ? sm.variant.id
            : undefined;

        const fullItem = await inventoryService.getItemById(item.id);

        if (hintedVariantId) {
          const picked = await inventoryService.getVariantById(hintedVariantId);
          const meta = buildLineMetaFromItemVariant(fullItem, picked);
          await addLineFromMeta(meta, 1);
          return;
        }

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

        await handleActivateProduct(fullItem, list, {
          highlightVariantId: sm?.variant?.id,
        });
      } catch (err: unknown) {
        setCheckoutError(err instanceof Error ? err.message : 'Could not add item');
      }
    },
    [addLineFromMeta, handleActivateProduct, salesPointId]
  );

  const tryAddFromInput = useCallback(
    async (ctx: SearchComboboxSubmitContext<ItemSearchResult>) => {
      setCheckoutError(null);
      if (!salesPointId || checkoutModalBusy || checkoutCustomerModal) return;
      const q = ctx.query.trim();
      if (!q) return;
      if (ctx.isLoading) {
        setCheckoutError('Wait for product search to finish.');
        return;
      }
      const resolved = await resolveBarcodeForPos(q);
      if (resolved) {
        await addLineFromMeta(resolved, 1);
        return;
      }
      if (ctx.items.length > 0) {
        const safe = Math.min(Math.max(0, ctx.activeIndex), ctx.items.length - 1);
        await onPickSearchItem(ctx.items[safe]);
        return;
      }
      setCheckoutError('Unknown barcode or no match. Try search or pick from the list.');
    },
    [
      addLineFromMeta,
      checkoutModalBusy,
      checkoutCustomerModal,
      onPickSearchItem,
      salesPointId,
    ]
  );

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
    setCheckoutError(null);
    setDiscountInput('0');
    resetPaymentSplit();
    lookupInputRef.current?.focus();
  }, [branchId, salesPointId, clear, resetPaymentSplit]);

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

  const mapSavedOrderFulfillmentLines = useCallback((order: Record<string, unknown>): FulfillmentOrderLine[] => {
    const rows = Array.isArray(order.lines) ? order.lines : [];
    return rows.map((raw) => {
      const ln = raw as Record<string, unknown>;
      const ordered = Number(ln.quantity ?? 0);
      const picked = Number(ln.fulfilledQty ?? 0);
      return {
        orderLineId: String(ln.orderLineId ?? ln._id ?? ''),
        variantName: String(ln.variantName ?? ''),
        variantCode: String(ln.variantCode ?? ''),
        quantity: ordered,
        fulfilledQty: picked,
        pendingPickQty: Math.max(0, ordered - picked),
      };
    });
  }, []);

  const saveAsOrder = useCallback(async () => {
    if (!branchId || !salesPointId || lines.length === 0) return;
    if (salesPointSessionStatus !== 'open') {
      setCheckoutErrorModal('This counter session is closed. You can’t save an order from this sales point.');
      return;
    }
    if (customerId && !customerAllowsSale) {
      setCheckoutError(INACTIVE_CUSTOMER_MSG);
      return;
    }
    setSaveOrderBusy(true);
    setCheckoutError(null);
    try {
      const order = (await salesService.createOrder(
        {
          mode: 'pos',
          salesPointId,
          customerId: customerId || undefined,
          lines: linesForCheckoutPayload(lines, branchTaxPercent),
          discountAmount: totals.discountAmount > 0 ? totals.discountAmount : undefined,
          invoiceDate: invoiceDateYmd,
        },
        branchId
      )) as Record<string, unknown>;
      clearPosDraft(branchId, salesPointId);
      clear();
      setDiscountInput('0');
      resetPaymentSplit();
      setHeldDrafts(listHeldPosDrafts(branchId, salesPointId));
      setSavedOrderPrompt(order);
      lookupInputRef.current?.focus();
    } catch (err: unknown) {
      setCheckoutError(extractErrorMessage(err, 'Could not save order'));
    } finally {
      setSaveOrderBusy(false);
    }
  }, [
    branchId,
    branchTaxPercent,
    clear,
    customerAllowsSale,
    customerId,
    invoiceDateYmd,
    lines,
    resetPaymentSplit,
    salesPointId,
    salesPointSessionStatus,
    totals.discountAmount,
  ]);

  const finishSavedOrderPrompt = useCallback(
    (recordNow: boolean) => {
      if (recordNow) setFulfillmentModalOpen(true);
      else {
        showToast(`Order ${String(savedOrderPrompt?.orderNumber ?? 'saved')}`);
        setSavedOrderPrompt(null);
      }
    },
    [savedOrderPrompt, showToast]
  );

  const savedOrderFulfillmentLines = useMemo(
    () => (savedOrderPrompt ? mapSavedOrderFulfillmentLines(savedOrderPrompt) : []),
    [mapSavedOrderFulfillmentLines, savedOrderPrompt]
  );

  const savedOrderBalanceDue = useMemo(() => {
    if (!savedOrderPrompt) return 0;
    const total = Number(savedOrderPrompt.total ?? 0);
    return Math.max(0, Math.round((total - orderCollectedAmount(savedOrderPrompt)) * 100) / 100);
  }, [savedOrderPrompt]);

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
      resetPaymentSplit();
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
    [branchId, clear, resetPaymentSplit, salesPointId]
  );

  const completeSale = useCallback(
    async (opts?: {
      customerId?: string;
      createCustomer?: PosNewCustomerPayload;
    }) => {
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
      if (incompleteSerialLineCount > 0) {
        setCheckoutModalError(
          `${incompleteSerialLineCount} line${incompleteSerialLineCount === 1 ? '' : 's'} still need serial numbers.`
        );
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
        const onAccount = onAccountAmount;
        const nc = nonCashAmountsFromInputs(payOpts, nonCashAmountInputs);
        const balanced = isCheckoutBalanced(totals.total, nc, onAccount);
        const overAlloc = isCheckoutOverAllocated(totals.total, nc, onAccount);
        if (overAlloc || !balanced) {
          if (onAccount > 0 && !customerIdForOrder) {
            setCheckoutModalError('Select a customer to put an amount on account.');
          } else {
            setCheckoutModalError('Payment split and on account must equal the bill total.');
          }
          return;
        }
        const payments =
          totals.total <= 0 && onAccount <= 0
            ? undefined
            : buildCheckoutPayments(
                payOpts,
                totals.total,
                nonCashAmountInputs,
                paymentDetailsByMethod,
                onAccount,
              );
        if (totals.total > 0 && onAccount <= 0 && !payments?.length) {
          setCheckoutModalError('Add a payment amount or enable Cash in Sales settings.');
          return;
        }
        if (onAccount > 0 && !customerIdForOrder) {
          setCheckoutModalError('Customer is required for on-account amount.');
          return;
        }
        await salesService.posCheckout(
          {
            salesPointId,
            customerId: customerIdForOrder,
            lines: linesForCheckoutPayload(lines, branchTaxPercent),
            payments,
            discountAmount: totals.discountAmount > 0 ? totals.discountAmount : undefined,
            onAccountAmount: onAccount > 0 ? onAccount : undefined,
            invoiceDate: invoiceDateYmd,
          },
          branchId
        );
        clearPosDraft(branchId, salesPointId);
        clear();
        setDiscountInput('0');
        resetPaymentSplit();
        setStockRefreshToken((n) => n + 1);
        setHeldDrafts(listHeldPosDrafts(branchId, salesPointId));
        setCheckoutCustomerModal(false);
        setCustomerModalMode('sale');
        lookupInputRef.current?.focus();
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
        if (isPosCheckoutBlockingError(err)) {
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
      payOpts,
      paymentDetailsByMethod,
      paymentSplitBalanced,
      nonCashAmountInputs,
      resetPaymentSplit,
      salesPointId,
      salesPointSessionStatus,
      stockBlocked,
      incompleteSerialLineCount,
      totals.discountAmount,
      totals.total,
      setSearchParams,
      customerAllowsSale,
      customerId,
      onAccountAmount,
      onAccountNeedsCustomer,
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

  const openCheckoutModal = useCallback(() => {
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
      const intent = searchParams.get('posOrderForCustomer') === '1';
      const canAutoCheckout =
        isCheckoutBalanced(totals.total, nonCashAmounts, onAccountAmount) &&
        !isCheckoutOverAllocated(totals.total, nonCashAmounts, onAccountAmount) &&
        (onAccountAmount <= 0 || Boolean(customerId?.trim()));
      if (intent && customerId?.trim() && canAutoCheckout) {
        void completeSale({ customerId });
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
      nonCashAmounts,
      onAccountAmount,
      salesPointId,
      totals.total,
      salesPointSessionStatus,
      searchParams,
      stockBlocked,
    ]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopPropagation();
        const input = lookupInputRef.current;
        if (!input || input.disabled) return;
        input.focus();
        input.select();
        return;
      }
      if (e.key !== 'Enter') return;
      if (chargeDisabled || variantPicker || cameraOpen) return;
      e.preventDefault();
      e.stopPropagation();
      openCheckoutModal();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [cameraOpen, chargeDisabled, openCheckoutModal, variantPicker]);

  const onCustomerModalConfirmExisting = useCallback(
    (id: string) => {
      if (customerModalMode === 'quotation') void createDraftOrderForQuotation(id);
      else void completeSale({ customerId: id });
    },
    [completeSale, createDraftOrderForQuotation, customerModalMode]
  );

  const onCustomerModalConfirmNew = useCallback(
    (payload: PosNewCustomerPayload) => {
      if (customerModalMode === 'sale') {
        void completeSale({ createCustomer: payload });
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
    [branchId, completeSale, createDraftOrderForQuotation, customerModalMode]
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
    setCheckoutError(null);
    setDiscountInput('0');
    resetPaymentSplit();
    showToast('Order held (draft saved)');
    lookupInputRef.current?.focus();
  }, [branchId, salesPointId, lines, resetPaymentSplit, showToast]);

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

  const serialDetailBlocksLookup = Boolean(
    selectedDetailLine?.serialWarning &&
      selectedDetailVariantId &&
      !isPosSerialLineComplete(selectedDetailLine)
  );

  const productLookup = (
    <PosProductLookup
      branchId={branchId}
      salesPointId={salesPointId}
      value={lookupQuery}
      onValueChange={setLookupQuery}
      categoryChip={categoryChip}
      inputRef={lookupInputRef}
      onPickItem={onPickSearchItem}
      onSubmitQuery={tryAddFromInput}
      disabled={serialDetailBlocksLookup}
    />
  );

  return (
    <CounterWorkspaceShell
      toast={toast}
      loadingOverlay={
        posHydrateOrderBusy ? (
          <div className="pos-hydrate-overlay" role="status" aria-live="polite">
            Loading order…
          </div>
        ) : null
      }
      heldDraftsBanner={
        heldDrafts.length > 0 ? (
          <CounterHeldDraftsBanner
            drafts={heldDrafts}
            labelForIndex={(_d, idx) => `Draft ${idx}`}
            onResume={resumeHeldDraft}
            onDiscard={discardHeldDraft}
          />
        ) : null
      }
      leftBody={
        <>
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
            resolvePricesBatch={resolvePricesBatch}
            onConfirm={handleVariantPickerConfirm}
          />
        </>
      }
      leftFooter={
        <>
          <CounterSummaryRows
            subtotal={totals.subtotal}
            total={totals.total}
            adjustmentInput={discountInput}
            onAdjustmentInputChange={setDiscountInput}
          />

          <PosPaymentSplitSection
            payOpts={payOpts}
            total={totals.total}
            disabled={checkoutModalBusy || checkoutCustomerModal}
            nonCashInputs={nonCashAmountInputs}
            cashAmount={cashPaymentAmount}
            onAccountInput={onAccountInput}
            onAccountAmount={onAccountAmount}
            onAccountNeedsCustomer={onAccountNeedsCustomer}
            paidNow={paidNowAmount}
            unallocated={paymentUnallocated}
            detailsByMethod={paymentDetailsByMethod}
            overAllocated={paymentSplitOverAllocated}
            onNonCashChange={handleNonCashAmountChange}
            onOnAccountChange={handleOnAccountChange}
            onOpenDetails={(methodCode, methodLabel) =>
              setPaymentDetailsModal({ methodCode, methodLabel })
            }
          />

          <div className="pos-charge-row">
            {incompleteSerialLineCount > 0 ? (
              <div className="pos-serial-checkout-banner" role="status">
                {incompleteSerialLineCount} item{incompleteSerialLineCount === 1 ? '' : 's'} need serial numbers
                before checkout
              </div>
            ) : null}
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
                disabled={chargeDisabled}
                title={
                  incompleteSerialLineCount > 0
                    ? 'Complete serial numbers on all lines first'
                    : 'Charge (Ctrl+Enter)'
                }
              >
                {checkoutModalBusy ? 'Processing…' : `Charge ₹${totals.total.toFixed(2)}`}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="pos-save-order-btn"
                onClick={() => void saveAsOrder()}
                disabled={
                  saveOrderBusy ||
                  checkoutModalBusy ||
                  checkoutCustomerModal ||
                  lines.length === 0 ||
                  !salesPointId ||
                  salesPointSessionStatus !== 'open' ||
                  (Boolean(customerId?.trim()) && !customerAllowsSale)
                }
                title="Save as open order for partial pickup and payment later"
              >
                {saveOrderBusy ? 'Saving…' : 'Save as order'}
              </Button>
            </div>
          </div>

          {customerId?.trim() && !customerAllowsSale ? (
            <div className="sales-panel-error pos-checkout-err">{INACTIVE_CUSTOMER_MSG}</div>
          ) : null}
          {checkoutError ? <div className="sales-panel-error pos-checkout-err">{checkoutError}</div> : null}
        </>
      }
      rightSearch={productLookup}
      rightHeadActions={
        <>
          <Button type="button" variant="secondary" onClick={holdOrder} disabled={checkoutModalBusy}>
            Hold order
          </Button>
          <Button type="button" variant="secondary" onClick={handleNewSale}>
            Clear
          </Button>
        </>
      }
      rightHeadStatus={
        posOrderForCustomerIntent && customerId && intentCustomerLabel ? (
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
        ) : null
      }
      cart={
        lines.length === 0 ? (
          <CounterCartEmptyState
            title="Scan a product to start a sale"
            subtitle="Use scan or search and quick-add cards for regular products; use the MISC strip below for non-stock items. Lines merge by variant."
          />
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
                    onSelect={() => {
                      const needsSerial =
                        line.serialWarning && !isPosSerialLineComplete(line);
                      openLineDetail(line.variantId, {
                        focusSerial: needsSerial,
                        focusPrice: false,
                      });
                    }}
                    onPickSerials={() => {
                      openLineDetail(line.variantId, { focusSerial: true });
                    }}
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
        )
      }
    >
      <Modal
        isOpen={Boolean(selectedDetailVariantId && selectedDetailLine)}
        onClose={closeCartDetailModal}
        size="lg"
        className="pos-cart-detail-modal"
      >
        {selectedDetailLine ? (
          <PosCartItemDetailPanel
            line={selectedDetailLine}
            embeddedInModal
            focusPriceOnMount={detailFocusPrice}
            focusSerialOnMount={detailFocusSerial}
            salesLocationId={locationId}
            otherCartSerials={otherCartSerialsForLine(selectedDetailLine.variantId)}
            branchTaxPercent={branchTaxPercent}
            onUpdate={handleDetailUpdate}
            onRemove={handleDetailRemove}
            onSave={closeCartDetailModal}
            onClose={closeCartDetailModal}
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
          walkInDisabled={onAccountAmount > 0}
          onClose={closeCheckoutCustomerModal}
          onConfirmExisting={onCustomerModalConfirmExisting}
          onConfirmNew={onCustomerModalConfirmNew}
          onWalkIn={() => void completeSale()}
          onUseCounterCustomer={(id) =>
            void (customerModalMode === 'quotation'
              ? createDraftOrderForQuotation(id)
              : completeSale({ customerId: id }))
          }
        />
      </Modal>

      <PosPaymentDetailsModal
        isOpen={Boolean(paymentDetailsModal)}
        methodCode={paymentDetailsModal?.methodCode ?? ''}
        methodLabel={paymentDetailsModal?.methodLabel ?? ''}
        initial={
          paymentDetailsModal
            ? paymentDetailsByMethod[paymentDetailsModal.methodCode]
            : undefined
        }
        onClose={() => setPaymentDetailsModal(null)}
        onSave={(details) => {
          if (!paymentDetailsModal) return;
          setPaymentDetailsByMethod((prev) => ({
            ...prev,
            [paymentDetailsModal.methodCode]: details,
          }));
        }}
      />


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

      <Modal
        isOpen={Boolean(savedOrderPrompt) && !fulfillmentModalOpen}
        onClose={() => {
          setSavedOrderPrompt(null);
        }}
        title="Order saved"
        size="sm"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, color: '#334155', lineHeight: 1.5 }}>
            {savedOrderPrompt
              ? `Order ${String(savedOrderPrompt.orderNumber ?? '')} is in History. Record pickup and payment now, or continue later from the order detail page.`
              : ''}
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            <Button
              type="button"
              variant="secondary"
              onClick={() => finishSavedOrderPrompt(false)}
            >
              Save only
            </Button>
            <Button type="button" variant="primary" onClick={() => finishSavedOrderPrompt(true)}>
              Record pickup now
            </Button>
          </div>
        </div>
      </Modal>

      {savedOrderPrompt && fulfillmentModalOpen ? (
        <RecordPickupPaymentModal
          isOpen
          orderId={String(savedOrderPrompt._id ?? '')}
          branchId={branchId}
          orderNumber={String(savedOrderPrompt.orderNumber ?? '')}
          lines={savedOrderFulfillmentLines}
          balanceDue={savedOrderBalanceDue}
          total={Number(savedOrderPrompt.total ?? 0)}
          customerId={
            savedOrderPrompt.customerId
              ? typeof savedOrderPrompt.customerId === 'object'
                ? String((savedOrderPrompt.customerId as { _id?: string })._id ?? '')
                : String(savedOrderPrompt.customerId)
              : customerId
          }
          payOpts={payOpts}
          sessionOpen={salesPointSessionStatus === 'open'}
          onClose={() => {
            setFulfillmentModalOpen(false);
            setSavedOrderPrompt(null);
          }}
          onSuccess={() => {
            showToast(`Pickup recorded for ${String(savedOrderPrompt.orderNumber ?? 'order')}`);
            setStockRefreshToken((n) => n + 1);
            setFulfillmentModalOpen(false);
            setSavedOrderPrompt(null);
          }}
        />
      ) : null}

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
    </CounterWorkspaceShell>
  );
};
