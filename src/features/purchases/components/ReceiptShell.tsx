/**
 * Purchase goods receipt counter — posts inventory RECEIPT + optional PO receive.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/shared/components/ui';
import { Modal } from '@/shared/components/modals/Modal';
import {
  inventoryService,
  type InventoryItem,
  type InventoryVariant,
} from '@/services/inventory.service';
import {
  purchaseService,
  type PostPurchaseReceiptRequest,
  type PurchaseOrder,
} from '@/services/purchase.service';
import { salesService, type SalesSettingsData } from '@/services/sales.service';
import {
  PosSupplierSelectionModal,
  type PosSupplierConfirmPayload,
  type PosSupplierModalMode,
} from '@/features/purchases/components/PosSupplierSelectionModal';
import { buildSupplierSnapshot, type SupplierRecord } from '@/features/purchases/utils/supplierDirectory';
import { usePurchaseSupplierCatalog } from '@/features/purchases/hooks/usePurchaseSupplierCatalog';
import type { ItemSearchResult } from '@/features/inventory/types/search.types';
import type { SearchComboboxSubmitContext } from '@/shared/components/ui/SearchCombobox';
import {
  CounterWorkspaceShell,
  CounterCartEmptyState,
  CounterSummaryRows,
  CounterHeldDraftsBanner,
} from '@/shared/components/counter-workspace';
import { PosQuickAddGrid } from '@/features/sales/components/pos/PosQuickAddGrid';
import { PosMiscSlider } from '@/features/sales/components/pos/PosMiscSlider';
import { PosProductLookup } from '@/features/sales/components/pos/PosProductLookup';
import { PosVariantPickerModal, type PosVariantPickerLine } from '@/features/sales/components/pos/PosVariantPickerModal';
import { PosCartLineListCard } from '@/features/sales/components/pos/PosCartLineListCard';
import { PosCartItemDetailPanel } from '@/features/sales/components/pos/PosCartItemDetailPanel';
import { usePosCart, type PosCartLine, posCartLineKey } from '@/features/sales/components/pos/usePosCart';
import {
  buildLineMetaFromItemVariant,
  resolveBarcodeForPos,
  isMongoObjectId,
  type PosResolvedLineMeta,
} from '@/features/sales/components/pos/resolveScan';
import { resolvePurchaseUnitPrice } from '@/features/purchases/utils/purchaseLineUnits';
import {
  discardHeldReceiptDraft,
  holdReceiptDraft,
  listHeldReceiptDrafts,
  type ReceiptHeldDraft,
} from '@/features/purchases/utils/receiptStorage';
import { formatPosQuantityDisplay, roundPosQuantity } from '@/features/sales/components/pos/posQuantity';
import { PosPaymentSplitSection } from '@/features/sales/components/pos/PosPaymentSplitSection';
import { PosPaymentDetailsModal } from '@/features/sales/components/pos/PosPaymentDetailsModal';
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
  type PosPaymentOption,
} from '@/features/sales/components/pos/posPaymentSplit';
import { extractErrorMessage } from '@/utils/error';
import '@/features/sales/components/pos/PosShell.css';

type Props = {
  branchId: string;
  locationId: string | null;
  receiptDateYmd: string;
  purchaseOrderId?: string | null;
  onPosted?: () => void;
  onUnlinkPo?: () => void;
};

function receiptLineTotal(line: { quantity: number; unitPrice: number }) {
  return Math.round(line.quantity * line.unitPrice * 100) / 100;
}

const DEFAULT_PAY_OPTS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'upi', label: 'UPI' },
] as const;

function paymentOptionsFromSettings(s: SalesSettingsData | null): PosPaymentOption[] {
  if (!s?.paymentMethods?.length) {
    return [...DEFAULT_PAY_OPTS];
  }
  const enabled = [...s.paymentMethods]
    .filter((p) => p.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((p) => ({ value: p.code, label: p.label }));
  return enabled.length > 0 ? enabled : [...DEFAULT_PAY_OPTS];
}

function buildReceiptPayload(
  locationId: string,
  lines: PosCartLine[],
  receiptDateYmd: string,
  subtotal: number,
  shippingFreight: number,
  totalAmount: number,
  purchaseOrderId?: string | null,
  supplier?: Pick<
    PosSupplierConfirmPayload,
    'supplierId' | 'supplierName' | 'deliveryNoteNumber' | 'supplierInvoiceNumber'
  >,
  payments?: ReturnType<typeof buildCheckoutPayments>,
  onCreditAmount?: number
): PostPurchaseReceiptRequest {
  return {
    locationId,
    receiptDate: receiptDateYmd,
    purchaseOrderId: purchaseOrderId?.trim() || undefined,
    supplierId: supplier?.supplierId,
    supplierName: supplier?.supplierName,
    deliveryNoteNumber: supplier?.deliveryNoteNumber,
    supplierInvoiceNumber: supplier?.supplierInvoiceNumber,
    shippingFreight: shippingFreight > 0 ? shippingFreight : undefined,
    subtotal,
    totalAmount,
    onCreditAmount: onCreditAmount && onCreditAmount > 0 ? onCreditAmount : undefined,
    payments: payments && payments.length > 0 ? payments : undefined,
    lines: lines.map((l) => ({
      variantId: l.variantId,
      itemId: l.itemId,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      unitOfMeasure: l.unitOfMeasure || 'pcs',
      toLocationId: l.toLocationId || locationId,
    })),
  };
}

export const ReceiptShell: React.FC<Props> = ({
  branchId,
  locationId,
  receiptDateYmd,
  purchaseOrderId,
  onPosted,
  onUnlinkPo,
}) => {
  const lookupInputRef = useRef<HTMLInputElement>(null);
  const freightRef = useRef<HTMLInputElement>(null);
  const onCreditRef = useRef<HTMLInputElement>(null);
  const postReceiptBtnRef = useRef<HTMLButtonElement>(null);
  const paymentInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const poHydratedRef = useRef<string | null>(null);
  const [lookupQuery, setLookupQuery] = useState('');
  const [categoryChip, setCategoryChip] = useState<string | null>(null);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [freightInput, setFreightInput] = useState('0');
  const [toast, setToast] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [postBusy, setPostBusy] = useState(false);
  const [createOrderBusy, setCreateOrderBusy] = useState(false);
  const [stockRefreshToken, setStockRefreshToken] = useState(0);
  const [linkedPo, setLinkedPo] = useState<PurchaseOrder | null>(null);
  const [heldDrafts, setHeldDrafts] = useState<ReceiptHeldDraft[]>([]);
  const [variantPicker, setVariantPicker] = useState<{
    item: InventoryItem;
    variants: InventoryVariant[];
    highlightVariantId: string | null;
  } | null>(null);
  const [selectedDetailLineKey, setSelectedDetailLineKey] = useState<string | null>(null);
  const [detailFocusPrice, setDetailFocusPrice] = useState(false);
  const [defaultLocationPath, setDefaultLocationPath] = useState('');
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [supplierModalMode, setSupplierModalMode] = useState<PosSupplierModalMode>('post_receipt');
  const [supplierModalError, setSupplierModalError] = useState<string | null>(null);
  const [orderRowsForSuppliers, setOrderRowsForSuppliers] = useState<PurchaseOrder[]>([]);
  const [settings, setSettings] = useState<SalesSettingsData | null>(null);
  const [nonCashAmountInputs, setNonCashAmountInputs] = useState<Record<string, string>>({});
  const [paymentDetailsByMethod, setPaymentDetailsByMethod] = useState<
    Record<string, PosPaymentMethodDetails>
  >({});
  const [paymentDetailsModal, setPaymentDetailsModal] = useState<{
    methodCode: string;
    methodLabel: string;
  } | null>(null);
  const [onCreditInput, setOnCreditInput] = useState('');

  const { lines, lastMergedVariantId, addOrMerge, setQty, clear, updateLine, replaceLines, removeLine, lineKey } =
    usePosCart(undefined, { splitByLocation: true });

  useEffect(() => {
    if (!locationId) {
      setDefaultLocationPath('');
      return;
    }
    let cancelled = false;
    inventoryService
      .getLocationPath(locationId)
      .then((path) => {
        if (!cancelled) setDefaultLocationPath(path.map((l) => l.name).join(' › '));
      })
      .catch(() => {
        if (!cancelled) setDefaultLocationPath('');
      });
    return () => {
      cancelled = true;
    };
  }, [locationId]);

  const closeCartDetailModal = useCallback(() => {
    setSelectedDetailLineKey(null);
    setDetailFocusPrice(false);
    lookupInputRef.current?.focus();
  }, []);

  const getUnitFactor = useCallback((line: PosCartLine, unitOfMeasure?: string | null): number => {
    const unit = (unitOfMeasure || line.unitOfMeasure || line.baseUnit || '').trim().toLowerCase();
    const options = line.unitOptions || [];
    const matched = options.find((u) => u.unitCode === unit);
    const factor = matched?.factorToBase;
    return Number.isFinite(factor) && (factor as number) > 0 ? (factor as number) : 1;
  }, []);

  const selectedDetailLine = useMemo(
    () =>
      selectedDetailLineKey
        ? lines.find((l) => lineKey(l) === selectedDetailLineKey) ?? null
        : null,
    [lines, lineKey, selectedDetailLineKey]
  );

  useEffect(() => {
    if (selectedDetailLineKey && !lines.some((l) => lineKey(l) === selectedDetailLineKey)) {
      setSelectedDetailLineKey(null);
    }
  }, [lineKey, lines, selectedDetailLineKey]);

  const handleDetailUpdate = useCallback(
    (patch: Partial<PosCartLine>) => {
      if (!selectedDetailLineKey) return;
      const current = lines.find((l) => lineKey(l) === selectedDetailLineKey);
      if (!current) return;
      if (patch.unitOfMeasure && patch.unitOfMeasure !== current.unitOfMeasure) {
        const currentFactor = getUnitFactor(current, current.unitOfMeasure);
        const nextFactor = getUnitFactor(current, patch.unitOfMeasure);
        const nextUnitPrice = (current.unitPrice / currentFactor) * nextFactor;
        updateLine(selectedDetailLineKey, {
          ...patch,
          unitOfMeasure: patch.unitOfMeasure,
          unitPrice: Math.round(nextUnitPrice * 10000) / 10000,
        });
      } else {
        updateLine(selectedDetailLineKey, patch);
      }
      if (patch.toLocationId !== undefined) {
        const next = { ...current, ...patch };
        setSelectedDetailLineKey(lineKey(next));
      }
    },
    [getUnitFactor, lineKey, lines, selectedDetailLineKey, updateLine]
  );

  const handleDetailRemove = useCallback(() => {
    if (!selectedDetailLineKey) return;
    removeLine(selectedDetailLineKey);
    closeCartDetailModal();
  }, [closeCartDetailModal, removeLine, selectedDetailLineKey]);

  useEffect(() => {
    document.body.dataset.salesPosActive = '1';
    return () => {
      delete document.body.dataset.salesPosActive;
    };
  }, []);

  const refreshHeld = useCallback(() => {
    if (!locationId) {
      setHeldDrafts([]);
      return;
    }
    setHeldDrafts(listHeldReceiptDrafts(branchId, locationId));
  }, [branchId, locationId]);

  useEffect(() => {
    refreshHeld();
  }, [refreshHeld]);

  useEffect(() => {
    let cancelled = false;
    purchaseService
      .listOrders({ page: 1, pageSize: 100 }, branchId)
      .then((data) => {
        if (!cancelled) setOrderRowsForSuppliers(data.rows || []);
      })
      .catch(() => {
        if (!cancelled) setOrderRowsForSuppliers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [branchId]);

  const { supplierDirectory, saveSupplierRecord } = usePurchaseSupplierCatalog(
    branchId,
    orderRowsForSuppliers,
    linkedPo
  );

  const persistSupplier = useCallback(
    (record: SupplierRecord) => {
      void saveSupplierRecord(record);
    },
    [saveSupplierRecord]
  );

  useEffect(() => {
    if (!purchaseOrderId?.trim()) {
      if (poHydratedRef.current) {
        clear();
        setFreightInput('0');
        setLookupQuery('');
        poHydratedRef.current = null;
      }
      setLinkedPo(null);
      return;
    }
    let cancelled = false;
    purchaseService
      .getOrder(purchaseOrderId, branchId)
      .then((po) => {
        if (!cancelled) setLinkedPo(po);
      })
      .catch(() => {
        if (!cancelled) setLinkedPo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [branchId, clear, purchaseOrderId]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    const poId = purchaseOrderId?.trim();
    if (!poId || !locationId || !linkedPo || poHydratedRef.current === poId) return;
    if (linkedPo.status === 'draft' || linkedPo.status === 'cancelled') return;

    const pending = linkedPo.lines.filter((l) => l.pendingQty > 0);
    if (pending.length === 0) return;

    poHydratedRef.current = poId;
    void (async () => {
      let pathLabel = defaultLocationPath;
      if (!pathLabel && locationId) {
        try {
          const path = await inventoryService.getLocationPath(locationId);
          pathLabel = path.map((l) => l.name).join(' › ');
        } catch {
          pathLabel = '';
        }
      }
      const cartLines: PosCartLine[] = [];
      for (const pl of pending) {
        try {
          const variant = await inventoryService.getVariantById(pl.variantId);
          const item = await inventoryService.getItemById(pl.itemId);
          const meta = buildLineMetaFromItemVariant(item, variant);
          const unitPrice = pl.expectedPrice ?? resolvePurchaseUnitPrice(item, variant);
          cartLines.push({
            variantId: pl.variantId,
            itemId: pl.itemId,
            sku: meta.sku,
            label: meta.label,
            quantity: pl.pendingQty,
            unitPrice,
            unitOfMeasure: (pl.unitId || meta.defaultSalesUnit || meta.baseUnit || 'pcs').trim().toLowerCase(),
            baseUnit: meta.baseUnit,
            unitOptions: meta.unitOptions,
            toLocationId: locationId,
            toLocationPath: pathLabel || undefined,
          });
        } catch {
          /* skip line */
        }
      }
      if (cartLines.length > 0) {
        replaceLines(cartLines);
        showToast(`Loaded ${cartLines.length} pending line(s) from ${linkedPo.poNumber}`);
      }
    })();
  }, [defaultLocationPath, linkedPo, locationId, purchaseOrderId, replaceLines, showToast]);

  useEffect(() => {
    let cancelled = false;
    salesService
      .getSettings(branchId)
      .then((s) => {
        if (!cancelled) setSettings(s);
      })
      .catch(() => {
        if (!cancelled) setSettings(null);
      });
    return () => {
      cancelled = true;
    };
  }, [branchId]);

  const payOpts = useMemo(() => paymentOptionsFromSettings(settings), [settings]);

  useEffect(() => {
    setNonCashAmountInputs(emptyNonCashAmounts(payOpts));
  }, [payOpts]);

  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + receiptLineTotal(l), 0),
    [lines]
  );
  const shippingFreight = useMemo(() => {
    const d = Number(freightInput);
    return Number.isFinite(d) && d > 0 ? d : 0;
  }, [freightInput]);
  const total = useMemo(() => subtotal + shippingFreight, [subtotal, shippingFreight]);

  const nonCashAmounts = useMemo(
    () => nonCashAmountsFromInputs(payOpts, nonCashAmountInputs),
    [payOpts, nonCashAmountInputs]
  );
  const onCreditAmount = useMemo(() => getOnAccountAmountInput(onCreditInput), [onCreditInput]);
  const cashPaymentAmount = useMemo(
    () => computeCashRemainder(total, nonCashAmounts, onCreditAmount),
    [total, nonCashAmounts, onCreditAmount]
  );
  const paidNowAmount = useMemo(
    () => sumCollectedTender(total, nonCashAmounts, onCreditAmount),
    [total, nonCashAmounts, onCreditAmount]
  );
  const paymentUnallocated = useMemo(
    () => checkoutUnallocated(total, nonCashAmounts, onCreditAmount),
    [total, nonCashAmounts, onCreditAmount]
  );
  const paymentSplitOverAllocated = useMemo(
    () => isCheckoutOverAllocated(total, nonCashAmounts, onCreditAmount),
    [total, nonCashAmounts, onCreditAmount]
  );
  const paymentSplitBalanced = useMemo(
    () => total <= 0 || isCheckoutBalanced(total, nonCashAmounts, onCreditAmount),
    [total, nonCashAmounts, onCreditAmount]
  );

  const handleNonCashAmountChange = useCallback(
    (methodCode: string, raw: string) => {
      if (raw.trim() === '') {
        setNonCashAmountInputs((prev) => ({ ...prev, [methodCode]: '' }));
        return;
      }
      const current = nonCashAmountsFromInputs(payOpts, nonCashAmountInputs);
      const maxForMethod = maxNonCashForMethod(methodCode, total, current, onCreditAmount);
      let nextVal = parsePaymentAmountInput(raw);
      if (nextVal > maxForMethod) nextVal = maxForMethod;
      setNonCashAmountInputs((prev) => ({
        ...prev,
        [methodCode]: String(nextVal),
      }));
    },
    [nonCashAmountInputs, onCreditAmount, payOpts, total]
  );

  const handleOnCreditChange = useCallback(
    (raw: string) => {
      if (raw.trim() === '') {
        setOnCreditInput('');
        return;
      }
      const current = nonCashAmountsFromInputs(payOpts, nonCashAmountInputs);
      const maxCredit = roundMoney(Math.max(0, total - sumNonCashAmounts(current)));
      let nextVal = parsePaymentAmountInput(raw);
      if (nextVal > maxCredit) nextVal = maxCredit;
      setOnCreditInput(String(nextVal));
    },
    [nonCashAmountInputs, payOpts, total]
  );

  const registerPaymentInputRef = useCallback((methodCode: string, el: HTMLInputElement | null) => {
    paymentInputRefs.current[methodCode] = el;
  }, []);

  const checkoutFocusChain = useCallback((): HTMLElement[] => {
    const chain: (HTMLElement | null | undefined)[] = [
      freightRef.current,
      ...payOpts.map((p) => paymentInputRefs.current[p.value]),
      onCreditRef.current,
      postReceiptBtnRef.current,
    ];
    return chain.filter((el): el is HTMLElement => Boolean(el));
  }, [payOpts]);

  const focusNextInCheckoutChain = useCallback(
    (current: HTMLElement | null) => {
      const chain = checkoutFocusChain();
      if (chain.length === 0) return;
      const idx = chain.findIndex((el) => el === current);
      const next = chain[idx >= 0 ? idx + 1 : 0] ?? chain[0];
      next?.focus();
      if (next instanceof HTMLInputElement) next.select();
    },
    [checkoutFocusChain]
  );

  const resolveReceiptPrice = useCallback(async (variantId: string) => {
    const variant = await inventoryService.getVariantById(variantId);
    const item = await inventoryService.getItemById(variant.itemId);
    return { price: resolvePurchaseUnitPrice(item, variant), currency: 'INR' };
  }, []);

  const resolveReceiptPricesBatch = useCallback(
    async (variantIds: string[]) => {
      const out: Record<string, { price: number; currency: string }> = {};
      await Promise.all(
        variantIds.map(async (id) => {
          try {
            out[id] = await resolveReceiptPrice(id);
          } catch {
            out[id] = { price: 0, currency: 'INR' };
          }
        })
      );
      return out;
    },
    [resolveReceiptPrice]
  );

  const addLineFromMeta = useCallback(
    async (
      meta: PosResolvedLineMeta,
      quantity: number,
      options?: { quiet?: boolean; skipDetailAfterAdd?: boolean; unitPrice?: number }
    ) => {
      let unitPrice = options?.unitPrice;
      if (unitPrice == null) {
        try {
          const variant = await inventoryService.getVariantById(meta.variantId);
          const item = await inventoryService.getItemById(meta.itemId);
          unitPrice = resolvePurchaseUnitPrice(item, variant);
        } catch {
          unitPrice = 0;
        }
      }
      const lineQty = roundPosQuantity(Math.max(0, quantity));
      if (lineQty <= 0) return;
      addOrMerge({
        variantId: meta.variantId,
        itemId: meta.itemId,
        sku: meta.sku,
        label: meta.label,
        quantity: lineQty,
        unitPrice,
        isNonStock: meta.isNonStock,
        allowNegativeStock: meta.allowNegativeStock,
        unitOfMeasure: (meta.defaultSalesUnit || meta.baseUnit).trim().toLowerCase(),
        baseUnit: meta.baseUnit,
        unitOptions: meta.unitOptions,
        toLocationId: locationId || undefined,
        toLocationPath: defaultLocationPath || undefined,
      });
      const addedKey = posCartLineKey(
        {
          variantId: meta.variantId,
          toLocationId: locationId || undefined,
        } as PosCartLine,
        true
      );
      const openDetail = !options?.skipDetailAfterAdd && !options?.quiet;
      if (!options?.quiet) {
        showToast(`Added: ${meta.label}`);
        setLookupQuery('');
      }
      if (openDetail) {
        setSelectedDetailLineKey(addedKey);
        setDetailFocusPrice(true);
      } else if (!options?.quiet) {
        lookupInputRef.current?.focus();
      }
    },
    [addOrMerge, defaultLocationPath, locationId, showToast]
  );

  const handleActivateProduct = useCallback(
    async (
      item: InventoryItem,
      variants: InventoryVariant[],
      options?: { highlightVariantId?: string }
    ) => {
      if (!locationId) {
        setActionError('Select a default storage location in the header first.');
        return;
      }
      setActionError(null);
      if (variants.length === 0) {
        setActionError('No variants for this item.');
        return;
      }
      let fullItem = item;
      try {
        fullItem = await inventoryService.getItemById(item.id);
      } catch {
        /* catalog stub */
      }
      if (variants.length === 1) {
        const meta = buildLineMetaFromItemVariant(fullItem, variants[0]);
        await addLineFromMeta(meta, 1);
        return;
      }
      const defaultV = variants.find((x) => x.isDefault) || variants[0];
      const hi =
        options?.highlightVariantId &&
        variants.some((x) => x.id === options.highlightVariantId)
          ? options.highlightVariantId
          : defaultV.id;
      setVariantPicker({ item: fullItem, variants, highlightVariantId: hi });
    },
    [addLineFromMeta, locationId]
  );

  const handleVariantPickerConfirm = useCallback(
    async (picked: PosVariantPickerLine[]) => {
      if (!locationId || picked.length === 0) return;
      setActionError(null);
      try {
        for (const line of picked) {
          await addLineFromMeta(line.meta, line.quantity, { quiet: true, unitPrice: line.unitPrice });
        }
        const units = picked.reduce((s, l) => s + l.quantity, 0);
        const label =
          picked.length === 1
            ? `${formatPosQuantityDisplay(picked[0].quantity)}× ${picked[0].meta.label}`
            : `${units} units across ${picked.length} variants`;
        showToast(`Added to receipt: ${label}`);
        setVariantPicker(null);
        setLookupQuery('');
        const last = picked[picked.length - 1];
        setSelectedDetailLineKey(
          posCartLineKey(
            { variantId: last.meta.variantId, toLocationId: locationId || undefined } as PosCartLine,
            true
          )
        );
        setDetailFocusPrice(true);
      } catch (e: unknown) {
        setActionError(e instanceof Error ? e.message : 'Could not add variants');
      }
    },
    [addLineFromMeta, locationId, showToast]
  );

  const onPickSearchItem = useCallback(
    async (item: ItemSearchResult) => {
      if (!locationId) return;
      setActionError(null);
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
          await addLineFromMeta(buildLineMetaFromItemVariant(fullItem, picked), 1);
          return;
        }
        const variants = await inventoryService.getVariantsByItem(item.id);
        await handleActivateProduct(fullItem, variants, { highlightVariantId: hintedVariantId });
      } catch (e: unknown) {
        setActionError(e instanceof Error ? e.message : 'Could not add item');
      }
    },
    [addLineFromMeta, handleActivateProduct, locationId]
  );

  const tryAddFromInput = useCallback(
    async (ctx: SearchComboboxSubmitContext<ItemSearchResult>) => {
      if (!locationId) return;
      const q = ctx.query.trim();
      if (!q) return;
      setActionError(null);
      if (ctx.isLoading) {
        setActionError('Wait for product search to finish.');
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
      setActionError('No matching product.');
    },
    [addLineFromMeta, locationId, onPickSearchItem]
  );

  const resetCart = useCallback(() => {
    clear();
    setFreightInput('0');
    setOnCreditInput('');
    setNonCashAmountInputs(emptyNonCashAmounts(payOpts));
    setPaymentDetailsByMethod({});
    setLookupQuery('');
    poHydratedRef.current = null;
  }, [clear, payOpts]);

  const handleClear = useCallback(() => {
    resetCart();
    setActionError(null);
    lookupInputRef.current?.focus();
  }, [resetCart]);

  const handleHold = useCallback(() => {
    if (!locationId || lines.length === 0) return;
    holdReceiptDraft(branchId, locationId, {
      lines,
      freightInput,
      purchaseOrderId: purchaseOrderId?.trim() || undefined,
      nonCashAmountInputs,
      onCreditInput,
      paymentDetailsByMethod,
    });
    refreshHeld();
    resetCart();
    showToast('Receipt held — resume from the banner when ready');
  }, [
    branchId,
    freightInput,
    lines,
    locationId,
    nonCashAmountInputs,
    onCreditInput,
    paymentDetailsByMethod,
    purchaseOrderId,
    refreshHeld,
    resetCart,
    showToast,
  ]);

  const resumeHeldDraft = useCallback(
    (draft: ReceiptHeldDraft) => {
      replaceLines(draft.lines);
      setFreightInput(draft.freightInput || '0');
      if (draft.nonCashAmountInputs) setNonCashAmountInputs(draft.nonCashAmountInputs);
      if (draft.onCreditInput != null) setOnCreditInput(draft.onCreditInput);
      if (draft.paymentDetailsByMethod) setPaymentDetailsByMethod(draft.paymentDetailsByMethod);
      discardHeldReceiptDraft(branchId, locationId!, draft.id);
      refreshHeld();
      setActionError(null);
      showToast('Held receipt resumed');
      lookupInputRef.current?.focus();
    },
    [branchId, locationId, refreshHeld, replaceLines, showToast]
  );

  const openSupplierModal = useCallback(
    (mode: PosSupplierModalMode) => {
      if (!locationId || lines.length === 0) return;
      setSupplierModalMode(mode);
      setSupplierModalError(null);
      setSupplierModalOpen(true);
    },
    [lines.length, locationId]
  );

  const tryOpenPostReceipt = useCallback(() => {
    if (!locationId || lines.length === 0) return;
    setActionError(null);
    if (total > 0 && !paymentSplitBalanced) {
      setActionError('Payment split and on credit must equal the receipt total.');
      freightRef.current?.focus();
      return;
    }
    if (total > 0 && paymentSplitOverAllocated) {
      setActionError('Payment amounts exceed the receipt total.');
      return;
    }
    openSupplierModal('post_receipt');
  }, [lines.length, locationId, openSupplierModal, paymentSplitBalanced, paymentSplitOverAllocated, total]);

  const handleCheckoutEnterKey = useCallback(
    (e: React.KeyboardEvent, current: HTMLElement | null) => {
      if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      if (current === postReceiptBtnRef.current) {
        tryOpenPostReceipt();
        return;
      }
      focusNextInCheckoutChain(current);
    },
    [focusNextInCheckoutChain, tryOpenPostReceipt]
  );

  const handlePostReceipt = useCallback(async (supplier: PosSupplierConfirmPayload) => {
    if (!locationId || lines.length === 0) return;
    setPostBusy(true);
    setSupplierModalError(null);
    setActionError(null);
    try {
      const payments =
        total <= 0 && onCreditAmount <= 0
          ? undefined
          : buildCheckoutPayments(
              payOpts,
              total,
              nonCashAmountInputs,
              paymentDetailsByMethod,
              onCreditAmount
            );
      const result = await purchaseService.postReceipt(
        buildReceiptPayload(
          locationId,
          lines,
          receiptDateYmd,
          subtotal,
          shippingFreight,
          total,
          purchaseOrderId,
          supplier,
          payments,
          onCreditAmount
        ),
        branchId
      );
      resetCart();
      setSupplierModalOpen(false);
      setStockRefreshToken((n) => n + 1);
      poHydratedRef.current = null;
      const poNote = result.purchaseOrder ? ` · ${result.purchaseOrder.poNumber} updated` : '';
      const billNote = result.bill ? ` · Bill ${result.bill.billNumber}` : '';
      showToast(`Receipt ${result.movementNumber} posted${billNote}${poNote}`);
      onPosted?.();
    } catch (e: unknown) {
      const msg = extractErrorMessage(e, 'Could not post receipt');
      setSupplierModalError(msg);
      setActionError(msg);
    } finally {
      setPostBusy(false);
    }
  }, [
    branchId,
    lines,
    locationId,
    nonCashAmountInputs,
    onCreditAmount,
    onPosted,
    payOpts,
    paymentDetailsByMethod,
    purchaseOrderId,
    receiptDateYmd,
    resetCart,
    shippingFreight,
    showToast,
    subtotal,
    total,
  ]);

  const closeSupplierModal = useCallback(() => {
    if (postBusy || createOrderBusy) return;
    setSupplierModalOpen(false);
    setSupplierModalError(null);
  }, [createOrderBusy, postBusy]);

  const handleCreateOrder = useCallback(
    async (
      supplier: { supplierId: string; supplierName: string },
      extras?: { expectedDeliveryDate?: string }
    ) => {
      if (!locationId || lines.length === 0) return;
      setCreateOrderBusy(true);
      setSupplierModalError(null);
      setActionError(null);
      try {
        const order = await purchaseService.createOrder(
          {
            supplierId: supplier.supplierId,
            supplierName: supplier.supplierName,
            supplierContactSnapshot: buildSupplierSnapshot(
              supplier.supplierId,
              supplier.supplierName,
              'net_30',
              undefined,
              supplierDirectory.find((s) => s.id === supplier.supplierId)
            ),
            expectedDeliveryDate: extras?.expectedDeliveryDate,
            deliveryLocationId: locationId,
            paymentTerms: 'net_30',
            shippingFreight: shippingFreight > 0 ? shippingFreight : undefined,
            lines: lines.map((l) => ({
              variantId: l.variantId,
              quantityOrdered: l.quantity,
              unitId: (l.unitOfMeasure || l.baseUnit || 'pcs').trim().toLowerCase(),
              expectedPrice: l.unitPrice,
              taxPercent: 0,
              discountPercent: 0,
            })),
            confirm: true,
          },
          branchId
        );
        resetCart();
        setSupplierModalOpen(false);
        showToast(`Purchase order ${order.poNumber} confirmed`);
      } catch (e: unknown) {
        const msg = extractErrorMessage(e, 'Could not create purchase order');
        setSupplierModalError(msg);
        setActionError(msg);
      } finally {
        setCreateOrderBusy(false);
      }
    },
    [branchId, lines, locationId, resetCart, shippingFreight, showToast, supplierDirectory]
  );

  const handleCreateOrderWithSupplier = useCallback(
    (payload: PosSupplierConfirmPayload) => {
      void handleCreateOrder(
        {
          supplierId: payload.supplierId,
          supplierName: payload.supplierName,
        },
        { expectedDeliveryDate: payload.expectedDeliveryDate }
      );
    },
    [handleCreateOrder]
  );

  const handleSkipSupplierForCreateOrder = useCallback(
    (extras: { expectedDeliveryDate?: string }) => {
      void handleCreateOrder(
        { supplierId: 'sup-unassigned', supplierName: 'Supplier TBD' },
        extras
      );
    },
    [handleCreateOrder]
  );

  const focusFreightFromSearch = useCallback(() => {
    if (!locationId) return;
    setActionError(null);
    window.setTimeout(() => {
      freightRef.current?.focus();
      freightRef.current?.select();
    }, 0);
  }, [locationId]);

  const productLookup = (
    <PosProductLookup
      branchId={branchId}
      salesPointId={null}
      disabled={!locationId}
      value={lookupQuery}
      onValueChange={setLookupQuery}
      categoryChip={categoryChip}
      inputRef={lookupInputRef}
      onPickItem={onPickSearchItem}
      onSubmitQuery={tryAddFromInput}
      onEmptyEnter={focusFreightFromSearch}
    />
  );

  const postDisabled =
    postBusy ||
    createOrderBusy ||
    lines.length === 0 ||
    !locationId ||
    supplierModalOpen ||
    (total > 0 && !paymentSplitBalanced);
  const createOrderDisabled = postBusy || createOrderBusy || lines.length === 0 || !locationId;
  const showCreateOrder = !purchaseOrderId?.trim() && !linkedPo;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const poPickerOpen = document.body.dataset.receiptPoPickerOpen === '1';
      const supplierModalDataset = document.body.dataset.receiptSupplierModalOpen === '1';

      if (mod && e.key.toLowerCase() === 'k') {
        if (poPickerOpen || supplierModalDataset) return;
        e.preventDefault();
        e.stopPropagation();
        const input = lookupInputRef.current;
        if (!input || input.disabled) return;
        input.focus();
        input.select();
        return;
      }

      if (mod && e.shiftKey && e.key === 'Enter') {
        if (poPickerOpen || supplierModalDataset || supplierModalOpen) return;
        if (!showCreateOrder || createOrderDisabled || variantPicker) return;
        e.preventDefault();
        e.stopPropagation();
        openSupplierModal('create_order');
        return;
      }

      if (mod && !e.shiftKey && e.key === 'Enter') {
        if (poPickerOpen || supplierModalDataset || supplierModalOpen) return;
        if (postDisabled || variantPicker) return;
        e.preventDefault();
        e.stopPropagation();
        tryOpenPostReceipt();
        return;
      }

      if (e.key === 'Escape') {
        if (poPickerOpen || supplierModalDataset || supplierModalOpen) return;
        if (variantPicker || selectedDetailLineKey) return;
        if (!purchaseOrderId?.trim() || !onUnlinkPo) return;
        e.preventDefault();
        e.stopPropagation();
        onUnlinkPo();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [
    createOrderDisabled,
    onUnlinkPo,
    openSupplierModal,
    postDisabled,
    purchaseOrderId,
    selectedDetailLineKey,
    showCreateOrder,
    supplierModalOpen,
    tryOpenPostReceipt,
    variantPicker,
  ]);

  return (
    <>
    <CounterWorkspaceShell
      toast={toast}
      heldDraftsBanner={
        heldDrafts.length > 0 && locationId ? (
          <CounterHeldDraftsBanner
            drafts={heldDrafts}
            labelForIndex={(_d, idx) => `Held ${idx}`}
            onResume={resumeHeldDraft}
            onDiscard={(id) => {
              discardHeldReceiptDraft(branchId, locationId, id);
              refreshHeld();
            }}
          />
        ) : null
      }
      leftAriaLabel="Find products to receive"
      leftBody={
        <>
          <PosQuickAddGrid
            branchId={branchId}
            salesPointId={null}
            customerId={null}
            locationId={locationId}
            refreshToken={stockRefreshToken}
            disabled={!locationId || postBusy || createOrderBusy}
            categoryChip={categoryChip}
            onCategoryChipChange={setCategoryChip}
            inStockOnly={inStockOnly}
            onInStockOnlyChange={setInStockOnly}
            onActivateProduct={handleActivateProduct}
          />
          <PosMiscSlider
            branchId={branchId}
            salesPointId={null}
            disabled={!locationId || postBusy || createOrderBusy}
            onActivateProduct={handleActivateProduct}
          />
          <PosVariantPickerModal
            isOpen={Boolean(variantPicker)}
            onClose={() => setVariantPicker(null)}
            item={variantPicker?.item ?? null}
            variants={variantPicker?.variants ?? []}
            locationId={locationId}
            salesPointId={null}
            customerId={null}
            highlightVariantId={variantPicker?.highlightVariantId ?? null}
            resolvePrice={resolveReceiptPrice}
            resolvePricesBatch={resolveReceiptPricesBatch}
            ignoreStockLimits
            onConfirm={handleVariantPickerConfirm}
          />
        </>
      }
      leftFooter={
        <>
          <CounterSummaryRows
            subtotal={subtotal}
            total={total}
            adjustmentInput={freightInput}
            onAdjustmentInputChange={setFreightInput}
            adjustmentKind="freight"
            adjustmentAriaLabel="Freight charges amount"
            adjustmentInputRef={freightRef}
            onAdjustmentKeyDown={(e) => handleCheckoutEnterKey(e, freightRef.current)}
          />

          <PosPaymentSplitSection
            payOpts={payOpts}
            total={total}
            disabled={postBusy || createOrderBusy || supplierModalOpen}
            nonCashInputs={nonCashAmountInputs}
            cashAmount={cashPaymentAmount}
            onAccountInput={onCreditInput}
            onAccountAmount={onCreditAmount}
            onAccountNeedsCustomer={false}
            paidNow={paidNowAmount}
            unallocated={paymentUnallocated}
            detailsByMethod={paymentDetailsByMethod}
            overAllocated={paymentSplitOverAllocated}
            onNonCashChange={handleNonCashAmountChange}
            onOnAccountChange={handleOnCreditChange}
            onOpenDetails={(methodCode, methodLabel) =>
              setPaymentDetailsModal({ methodCode, methodLabel })
            }
            onAccountLabel="On credit"
            onAccountTitle="Amount payable to supplier — deducted from cash above"
            onAccountInputRef={onCreditRef}
            registerPaymentInputRef={registerPaymentInputRef}
            onPaymentInputKeyDown={(methodCode, e) =>
              handleCheckoutEnterKey(e, paymentInputRefs.current[methodCode])
            }
            onOnAccountKeyDown={(e) => handleCheckoutEnterKey(e, onCreditRef.current)}
          />

          <div className="pos-charge-row">
            <div className="pos-charge-row__actions">
              <Button
                ref={postReceiptBtnRef}
                type="button"
                variant="primary"
                className="pos-charge-btn"
                onClick={tryOpenPostReceipt}
                disabled={postDisabled}
                onKeyDown={(e) => handleCheckoutEnterKey(e, postReceiptBtnRef.current)}
                title="Post receipt (Ctrl+Enter)"
              >
                {postBusy && supplierModalMode === 'post_receipt' ? 'Posting…' : `Post receipt · ₹${total.toFixed(2)}`}
              </Button>
              {showCreateOrder ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="pos-save-order-btn"
                  onClick={() => openSupplierModal('create_order')}
                  disabled={createOrderDisabled}
                  title="Create purchase order (Ctrl+Shift+Enter)"
                >
                  {createOrderBusy && supplierModalMode === 'create_order'
                    ? 'Creating…'
                    : 'Create order'}
                </Button>
              ) : null}
            </div>
          </div>
          {actionError ? <div className="sales-panel-error pos-checkout-err">{actionError}</div> : null}
        </>
      }
      rightSearch={productLookup}
      rightHeadActions={
        <>
          <Button type="button" variant="secondary" onClick={handleHold} disabled={postBusy || createOrderBusy || lines.length === 0}>
            Hold receipt
          </Button>
          <Button type="button" variant="secondary" onClick={handleClear} disabled={postBusy || createOrderBusy}>
            Clear
          </Button>
        </>
      }
      rightHeadStatus={
        linkedPo ? (
          <div className="pos-order-for-customer" role="status">
            <span className="pos-order-for-customer__text">
              PO {linkedPo.poNumber} · {linkedPo.supplierName}
            </span>
          </div>
        ) : null
      }
      cartAriaLabel="Receipt lines"
      cart={
        lines.length === 0 ? (
          <CounterCartEmptyState
            title="Scan a product to start receiving"
            subtitle="Use scan or search and quick-add cards for regular products; use the MISC strip for non-stock items. Set storage per line in the detail modal."
          />
        ) : (
          <div className="pos-cart-list-col">
            <div className="pos-cart-list">
              {lines.map((line) => {
                const key = lineKey(line);
                return (
                <PosCartLineListCard
                  key={key}
                  line={line}
                  lineTotal={receiptLineTotal(line)}
                  selected={selectedDetailLineKey === key}
                  flash={lastMergedVariantId === line.variantId}
                  storagePath={line.toLocationPath || defaultLocationPath || null}
                  onSelect={() => {
                    setDetailFocusPrice(false);
                    setSelectedDetailLineKey(key);
                  }}
                  onQuantityChange={(q) => setQty(key, q)}
                  onUnitChange={(unitOfMeasure) => {
                    const currentFactor = getUnitFactor(line, line.unitOfMeasure);
                    const nextFactor = getUnitFactor(line, unitOfMeasure);
                    const nextUnitPrice = (line.unitPrice / currentFactor) * nextFactor;
                    updateLine(key, {
                      unitOfMeasure,
                      unitPrice: Math.round(nextUnitPrice * 10000) / 10000,
                    });
                  }}
                />
              );})}
            </div>
          </div>
        )
      }
    />
    <Modal
      isOpen={Boolean(selectedDetailLineKey && selectedDetailLine)}
      onClose={closeCartDetailModal}
      size="lg"
      className="pos-cart-detail-modal"
    >
      {selectedDetailLine ? (
        <PosCartItemDetailPanel
          line={selectedDetailLine}
          mode="receipt"
          embeddedInModal
          focusPriceOnMount={detailFocusPrice}
          branchTaxPercent={0}
          receiptBranchId={branchId}
          headerDefaultLocationId={locationId}
          onUpdate={handleDetailUpdate}
          onRemove={handleDetailRemove}
          onSave={closeCartDetailModal}
          onClose={closeCartDetailModal}
        />
      ) : null}
    </Modal>
    <Modal
      isOpen={supplierModalOpen}
      onClose={closeSupplierModal}
      title={
        supplierModalMode === 'create_order'
          ? 'Supplier for purchase order'
          : 'Supplier for this receipt'
      }
      size="xl"
      className="pos-checkout-customer-modal-wrap"
    >
      <PosSupplierSelectionModal
        isOpen={supplierModalOpen}
        mode={supplierModalMode}
        busy={postBusy || createOrderBusy}
        error={supplierModalError}
        poLocked={supplierModalMode === 'post_receipt' && Boolean(linkedPo)}
        lockedSupplier={
          linkedPo
            ? {
                id: linkedPo.supplierId,
                name: linkedPo.supplierName,
                snapshot: linkedPo.supplierContactSnapshot,
                poNumber: linkedPo.poNumber,
              }
            : null
        }
        supplierDirectory={supplierDirectory}
        onSupplierSaved={persistSupplier}
        resolveNewSupplier={async (draft) => {
          try {
            return await saveSupplierRecord({
              id: '',
              name: draft.name,
              gstin: draft.gstin,
              email: draft.email,
              phone: draft.phone,
              paymentTermsLabel: draft.paymentTermsLabel,
            });
          } catch {
            return null;
          }
        }}
        onClose={closeSupplierModal}
        onConfirm={(payload) => {
          if (supplierModalMode === 'create_order') {
            handleCreateOrderWithSupplier(payload);
            return;
          }
          void handlePostReceipt(payload);
        }}
        onSkipSupplier={
          supplierModalMode === 'create_order' ? handleSkipSupplierForCreateOrder : undefined
        }
      />
    </Modal>
    <PosPaymentDetailsModal
      isOpen={Boolean(paymentDetailsModal)}
      methodCode={paymentDetailsModal?.methodCode ?? ''}
      methodLabel={paymentDetailsModal?.methodLabel ?? ''}
      initial={
        paymentDetailsModal ? paymentDetailsByMethod[paymentDetailsModal.methodCode] : undefined
      }
      onClose={() => setPaymentDetailsModal(null)}
      onSave={(details) => {
        if (!paymentDetailsModal) return;
        setPaymentDetailsByMethod((prev) => ({
          ...prev,
          [paymentDetailsModal.methodCode]: details,
        }));
        setPaymentDetailsModal(null);
      }}
    />
    </>
  );
};
