import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, SearchCombobox, Select, Textarea } from '@/shared/components/ui';
import { Tooltip } from '@/shared/components/ui/Tooltip';
import { ConfirmDialog } from '@/shared/components/modals/ConfirmDialog';
import {
  inventoryService,
  type CatalogVariantRow,
  type Location,
  LocationType,
} from '@/services/inventory.service';
import { ProductSearchCombobox } from '@/features/inventory/components/product-search';
import { branchService } from '@/services/branch.service';
import type { Branch } from '@/types';
import {
  purchaseService,
  type PurchaseOrder,
  type PurchaseOrderAttachment,
  type PurchaseOrderPriority,
  type PurchaseOrderSupplierContact,
} from '@/services/purchase.service';
import { QuickAddPartyDrawer } from './QuickAddPartyDrawer';
import {
  catalogCostPrice,
  enrichPurchaseLine,
  type PurchaseLineUnitOption,
} from '../utils/purchaseLineUnits';
import {
  PAYMENT_TERM_OPTIONS,
  buildSupplierSnapshot,
  filterSuppliers,
  formatInr,
  paymentLabelToValue,
  resolveSupplierIdFromName,
  type SupplierRecord,
} from '../utils/supplierDirectory';
import { usePurchaseSupplierCatalog } from '../hooks/usePurchaseSupplierCatalog';
import './PurchaseOrderCreatePage.css';

type DraftLine = {
  variantId: string;
  itemId: string;
  productName: string;
  variantName: string;
  sku: string;
  quantityOrdered: number;
  unitId: string;
  unitOptions: PurchaseLineUnitOption[];
  expectedPrice: number;
  taxPercent: number;
  discountPercent: number;
};

function selectInputOnFocus(e: React.FocusEvent<HTMLInputElement>) {
  e.target.select();
}

function parseDecimalInput(raw: string): number | null {
  const t = raw.trim();
  if (t === '' || t === '-' || t === '.') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function quantityInputValue(qty: number): string {
  if (!qty || qty <= 0) return '';
  return String(qty);
}

function priceInputValue(price: number): string {
  if (!price || price <= 0) return '';
  return String(price);
}

function commitQtyForLine(
  variantId: string,
  raw: string,
  updateLine: (variantId: string, patch: Partial<DraftLine>) => void,
  removeLine: (variantId: string) => void
): void {
  const parsed = parseDecimalInput(raw);
  if (parsed == null || parsed <= 0) {
    removeLine(variantId);
    return;
  }
  updateLine(variantId, { quantityOrdered: parsed });
}

function decrementQtyForLine(
  variantId: string,
  currentQty: number,
  updateLine: (variantId: string, patch: Partial<DraftLine>) => void,
  removeLine: (variantId: string) => void
): void {
  const next = Math.max(0, Number(currentQty) || 0) - 1;
  if (next <= 0) {
    removeLine(variantId);
    return;
  }
  updateLine(variantId, { quantityOrdered: next });
}

type Props = {
  branchId?: string | null;
  supplierOptions: Array<{ id: string; name: string }>;
  orderRows: PurchaseOrder[];
  initialSupplierId?: string | null;
  onCancel: () => void;
  onSaved: (order: PurchaseOrder, mode: 'draft' | 'send' | 'confirm') => void;
  /** Renders Confirm order (and popover) in the module navbar trailing slot. */
  onNavbarTrailingChange?: (node: React.ReactNode | null) => void;
};

function formatDateIn(v: string): string {
  if (!v) return '';
  const [y, m, d] = v.split('-');
  if (!y || !m || !d) return v;
  return `${d.padStart(2, '0')} / ${m.padStart(2, '0')} / ${y}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

function lineMath(qty: number, unitPrice: number, taxPct: number, discPct: number) {
  const q = Math.max(0, qty);
  const up = Math.max(0, unitPrice);
  const t = clampPct(taxPct);
  const d = clampPct(discPct);
  const gross = q * up;
  const discountAmt = gross * (d / 100);
  const taxable = gross - discountAmt;
  const taxAmt = taxable * (t / 100);
  const lineTotal = taxable + taxAmt;
  return { gross, discountAmt, taxAmt, lineTotal };
}

function daysAgoLabel(ts: number): string {
  const days = Math.max(0, Math.floor((Date.now() - ts) / 86400000));
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

type LocalAttachment = { id: string; fileName: string; size?: number; mimeType?: string };

type FieldErrors = {
  supplier?: string;
  deliveryLocation?: string;
  expectedDelivery?: string;
};

export const PurchaseOrderCreatePage: React.FC<Props> = ({
  branchId,
  supplierOptions,
  orderRows,
  initialSupplierId,
  onCancel,
  onSaved,
  onNavbarTrailingChange,
}) => {
  const navigate = useNavigate();
  const [poNumber, setPoNumber] = useState('—');
  const [savedOrderId, setSavedOrderId] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [supplierSearch, setSupplierSearch] = useState('');
  const [extraParties, setExtraParties] = useState<SupplierRecord[]>([]);
  const [partyDrawerOpen, setPartyDrawerOpen] = useState(false);
  const [partyDraftName, setPartyDraftName] = useState('');
  const [supplierSnapshot, setSupplierSnapshot] = useState<PurchaseOrderSupplierContact>(
    buildSupplierSnapshot('', '', 'net_30')
  );
  const [paymentTerms, setPaymentTerms] = useState('net_30');
  const [editContactOpen, setEditContactOpen] = useState(false);
  const [orderDate] = useState(todayIso());
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [deliveryLocationId, setDeliveryLocationId] = useState('');
  const [priority, setPriority] = useState<PurchaseOrderPriority>('normal');
  const [supplierMessage, setSupplierMessage] = useState('');
  const [shippingFreight, setShippingFreight] = useState(0);
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [knownOrders, setKnownOrders] = useState<PurchaseOrder[]>(orderRows);
  const [variantSearch, setVariantSearch] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [toast, setToast] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lineFocusTarget, setLineFocusTarget] = useState<{ variantId: string; field: 'qty' | 'price' } | null>(
    null
  );
  const [supplierListOpen, setSupplierListOpen] = useState(false);
  const [variantListOpen, setVariantListOpen] = useState(false);
  const supplierListOpenRef = useRef(false);
  const variantListOpenRef = useRef(false);
  const deliveryLocationRef = useRef<HTMLSelectElement>(null);
  const expectedDeliveryRef = useRef<HTMLInputElement>(null);
  const variantSearchRef = useRef<HTMLInputElement>(null);
  const supplierSearchRef = useRef<HTMLInputElement>(null);
  const qtyInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const priceInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const focusDeliveryLocation = useCallback(() => {
    window.requestAnimationFrame(() => deliveryLocationRef.current?.focus());
  }, []);

  const focusExpectedDelivery = useCallback(() => {
    window.requestAnimationFrame(() => expectedDeliveryRef.current?.focus());
  }, []);

  const focusVariantSearch = useCallback(() => {
    window.requestAnimationFrame(() => {
      const input = variantSearchRef.current;
      if (!input) return;
      input.focus();
      input.select();
    });
  }, []);

  const focusSupplierSearch = useCallback(() => {
    window.requestAnimationFrame(() => {
      const input = supplierSearchRef.current;
      if (!input) return;
      input.focus();
      input.select();
    });
  }, []);

  const applyDeliveryLocation = useCallback(
    (next: string) => {
      setDeliveryLocationId(next);
      if (next) focusExpectedDelivery();
    },
    [focusExpectedDelivery]
  );

  const focusLineQty = useCallback((variantId: string) => {
    setLineFocusTarget({ variantId, field: 'qty' });
  }, []);

  const focusLinePrice = useCallback((variantId: string) => {
    setLineFocusTarget({ variantId, field: 'price' });
  }, []);

  const isActiveQtyInput = useCallback((): boolean => {
    const active = document.activeElement;
    if (!active) return false;
    for (const el of qtyInputRefs.current.values()) {
      if (el === active) return true;
    }
    return false;
  }, []);

  const isActivePriceInput = useCallback((): boolean => {
    const active = document.activeElement;
    if (!active) return false;
    for (const el of priceInputRefs.current.values()) {
      if (el === active) return true;
    }
    return false;
  }, []);

  const isSupplierSearchInput = useCallback((el: Element | null): el is HTMLInputElement => {
    if (!el || !(el instanceof HTMLInputElement)) return false;
    return el === supplierSearchRef.current || el.id === 'po-supplier-search';
  }, []);

  const isVariantSearchInput = useCallback((el: Element | null): el is HTMLInputElement => {
    if (!el || !(el instanceof HTMLInputElement)) return false;
    return el === variantSearchRef.current;
  }, []);

  const isComboboxListOpen = (el: HTMLInputElement): boolean => el.getAttribute('aria-expanded') === 'true';

  const handleSupplierOpenChange = useCallback((open: boolean) => {
    supplierListOpenRef.current = open;
    setSupplierListOpen(open);
  }, []);

  const handleVariantOpenChange = useCallback((open: boolean) => {
    variantListOpenRef.current = open;
    setVariantListOpen(open);
  }, []);
  const [footerEmailOverride, setFooterEmailOverride] = useState('');
  const [dismissOpenPoAlert, setDismissOpenPoAlert] = useState(false);
  const [urgentHintDismissed, setUrgentHintDismissed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { supplierDirectory, saveSupplier } = usePurchaseSupplierCatalog(branchId, knownOrders);

  const supplierItems = useMemo(
    () => [...supplierDirectory, ...extraParties],
    [supplierDirectory, extraParties]
  );

  const initialSupplierAppliedRef = useRef(false);

  useEffect(() => {
    if (initialSupplierAppliedRef.current) return;
    const sid = initialSupplierId?.trim();
    if (!sid) return;
    const match = supplierItems.find((s) => s.id === sid);
    if (match) {
      setSupplierId(match.id);
      setSupplierSearch(match.name);
      initialSupplierAppliedRef.current = true;
    }
  }, [initialSupplierId, supplierItems]);

  const refreshPoNumber = useCallback(() => {
    purchaseService
      .getNextPoNumber(branchId)
      .then((v) => setPoNumber(v.poNumber))
      .catch(() => setPoNumber('—'));
  }, [branchId]);

  useEffect(() => {
    refreshPoNumber();
  }, [refreshPoNumber]);

  useEffect(() => {
    setKnownOrders(orderRows);
    if (orderRows.length === 0 && branchId) {
      purchaseService
        .listOrders({ page: 1, pageSize: 100 }, branchId)
        .then((data) => setKnownOrders(data.rows))
        .catch(() => undefined);
    }
  }, [orderRows, branchId]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      inventoryService.getAllLocations({ branchId: branchId || undefined, isActive: true }),
      branchService.getBranches({ isActive: true }),
    ])
      .then(([locRows, branchRows]) => {
        if (cancelled) return;
        const activeLocs = locRows.filter((l) => l.isActive);
        setLocations(activeLocs);
        setBranches(branchRows);
        const wh = activeLocs.filter((l) => l.type === LocationType.WAREHOUSE);
        const defaultLoc = (wh.length ? wh : activeLocs)[0];
        if (defaultLoc && !deliveryLocationId) setDeliveryLocationId(defaultLoc.id);
      })
      .catch(() => {
        if (!cancelled) {
          setLocations([]);
          setBranches([]);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- default location once
  }, [branchId]);

  useEffect(() => {
    const rec =
      supplierItems.find((s) => s.id === supplierId) ||
      supplierItems.find((s) => s.name.toLowerCase() === supplierSearch.trim().toLowerCase());
    const name = rec?.name || supplierSearch;
    const sid = rec?.id || supplierId;
    setSupplierSnapshot(
      buildSupplierSnapshot(sid, name, paymentTerms, footerEmailOverride || undefined, rec)
    );
  }, [supplierId, supplierSearch, supplierItems, paymentTerms, footerEmailOverride]);

  const branchNameById = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);

  const locationOptions = useMemo(() => {
    const wh = locations.filter((l) => l.type === LocationType.WAREHOUSE);
    const list = wh.length ? wh : locations;
    return list.map((l) => {
      const branchLabel = branchNameById.get(l.branchId) || 'Branch';
      const city = branchLabel.split(/[,\-–]/)[0]?.trim() || branchLabel;
      return {
        value: l.id,
        label: `${city} — ${l.name}`,
      };
    });
  }, [locations, branchNameById]);

  const recentSuppliers = useMemo(() => {
    return [...supplierItems]
      .sort((a, b) => (b.lastOrderedAt || 0) - (a.lastOrderedAt || 0))
      .slice(0, 5);
  }, [supplierItems]);

  const resolvedSupplierId = useMemo(() => {
    if (supplierId.trim()) return supplierId.trim();
    const name = supplierSearch.trim();
    if (!name) return '';
    return resolveSupplierIdFromName(name);
  }, [supplierId, supplierSearch]);

  const openDraftForSupplier = useMemo(() => {
    const sid = supplierId.trim() || resolvedSupplierId;
    if (!sid || dismissOpenPoAlert) return null;
    return (
      knownOrders.find((o) => o.status === 'draft' && o.supplierId === sid && o.id !== savedOrderId) || null
    );
  }, [supplierId, resolvedSupplierId, knownOrders, dismissOpenPoAlert, savedOrderId]);

  const orderTotals = useMemo(() => {
    let subtotal = 0;
    let totalDiscount = 0;
    let totalTax = 0;
    let linesSum = 0;
    for (const line of lines) {
      const { gross, discountAmt, taxAmt, lineTotal } = lineMath(
        line.quantityOrdered,
        line.expectedPrice,
        line.taxPercent,
        line.discountPercent
      );
      subtotal += gross;
      totalDiscount += discountAmt;
      totalTax += taxAmt;
      linesSum += lineTotal;
    }
    const freight = Math.max(0, Number(shippingFreight) || 0);
    return { subtotal, totalDiscount, totalTax, grandTotal: linesSum + freight, freight, linesSum };
  }, [lines, shippingFreight]);

  const isDeliveryUrgent = useMemo(() => {
    if (!expectedDeliveryDate) return false;
    const d = new Date(`${expectedDeliveryDate}T12:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = (d.getTime() - today.getTime()) / 86400000;
    return diff >= 0 && diff <= 2;
  }, [expectedDeliveryDate]);

  const hasFormData = Boolean(
    supplierId ||
      supplierSearch.trim() ||
      lines.length ||
      expectedDeliveryDate ||
      supplierMessage.trim() ||
      attachments.length ||
      shippingFreight > 0
  );

  const canConfirm = Boolean(resolvedSupplierId && lines.length > 0 && expectedDeliveryDate);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  };

  const rowFromCatalog = useCallback((row: CatalogVariantRow): DraftLine => {
    const fallbackUnit = 'pcs';
    return {
      variantId: row.variantId,
      itemId: row.productId,
      productName: row.productName,
      variantName: row.variantName,
      sku: row.sku,
      quantityOrdered: 1,
      unitId: fallbackUnit,
      unitOptions: [{ unitCode: fallbackUnit, factorToBase: 1 }],
      expectedPrice: catalogCostPrice(row),
      taxPercent: 0,
      discountPercent: 0,
    };
  }, []);

  const enrichLineFromInventory = useCallback(
    async (
      line: DraftLine,
      catalogRow?: CatalogVariantRow,
      options?: { keepExpectedPrice?: boolean }
    ): Promise<DraftLine> => {
      try {
        return await enrichPurchaseLine(line, catalogRow, options);
      } catch {
        return line;
      }
    },
    []
  );

  const addVariant = useCallback(
    async (row: CatalogVariantRow) => {
      const variantId = row.variantId;
      let incremented = false;
      setLines((prev) => {
        const i = prev.findIndex((l) => l.variantId === variantId);
        if (i < 0) return prev;
        incremented = true;
        const next = [...prev];
        next[i] = { ...next[i], quantityOrdered: next[i].quantityOrdered + 1 };
        return next;
      });
      setVariantSearch('');
      if (incremented) {
        focusLineQty(variantId);
        return;
      }
      const enriched = await enrichLineFromInventory(rowFromCatalog(row), row);
      setLines((prev) => {
        if (prev.some((l) => l.variantId === variantId)) return prev;
        return [...prev, enriched];
      });
      focusLineQty(variantId);
    },
    [enrichLineFromInventory, focusLineQty, rowFromCatalog]
  );

  useEffect(() => {
    if (!lineFocusTarget) return;
    const { variantId, field } = lineFocusTarget;
    if (!lines.some((l) => l.variantId === variantId)) return;

    const refMap = field === 'qty' ? qtyInputRefs : priceInputRefs;
    let attempts = 0;
    let raf = 0;
    const tryFocus = () => {
      const el = refMap.current.get(variantId);
      if (el) {
        el.focus();
        el.select();
        setLineFocusTarget(null);
        return;
      }
      attempts += 1;
      if (attempts < 12) {
        raf = window.requestAnimationFrame(tryFocus);
      } else {
        setLineFocusTarget(null);
      }
    };
    raf = window.requestAnimationFrame(tryFocus);
    return () => window.cancelAnimationFrame(raf);
  }, [lineFocusTarget, lines]);

  const updateLine = (variantId: string, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((l) => (l.variantId === variantId ? { ...l, ...patch } : l)));
  };

  const removeLine = (variantId: string) => {
    setLines((prev) => prev.filter((l) => l.variantId !== variantId));
  };

  const pickSupplier = useCallback(
    (s: SupplierRecord) => {
      setSupplierId(s.id);
      setSupplierSearch(s.name);
      setDismissOpenPoAlert(false);
      const term = PAYMENT_TERM_OPTIONS.find((o) => o.label === s.paymentTermsLabel)?.value;
      if (term) setPaymentTerms(term);
      focusDeliveryLocation();
    },
    [focusDeliveryLocation]
  );

  const onSupplierValueChange = (v: string) => {
    setSupplierSearch(v);
    const exact = supplierItems.find((s) => s.name.toLowerCase() === v.trim().toLowerCase());
    if (exact) {
      setSupplierId(exact.id);
      focusDeliveryLocation();
    } else if (!supplierItems.some((s) => s.id === supplierId && s.name === v)) setSupplierId('');
  };

  const handlePartySaved = useCallback(
    (party: { id: string; name: string; gstin: string; email: string; phone?: string; paymentTermsLabel: string }) => {
      void (async () => {
        try {
          const record = await saveSupplier({
            name: party.name,
            gstin: party.gstin !== '—' ? party.gstin : undefined,
            email: party.email || undefined,
            phone: party.phone,
            paymentTerms: paymentLabelToValue(party.paymentTermsLabel),
          });
          pickSupplier(record);
          setPartyDraftName('');
        } catch {
          showToast('Could not save supplier');
        }
      })();
    },
    [pickSupplier, saveSupplier, showToast]
  );

  const validateFields = (mode: 'draft' | 'send' | 'confirm'): boolean => {
    const errs: FieldErrors = {};
    if (!resolvedSupplierId) errs.supplier = 'Select or enter a supplier';
    if (mode !== 'draft') {
      if (lines.some((l) => !l.quantityOrdered || l.quantityOrdered <= 0)) {
        showToast('Each line needs a quantity greater than zero.');
        setSubmitted(true);
        return false;
      }
      if (!lines.length) {
        setSubmitted(true);
        return false;
      }
    }
    if (mode === 'confirm') {
      if (!expectedDeliveryDate) errs.expectedDelivery = 'Expected delivery date is required';
      else if (expectedDeliveryDate < todayIso()) errs.expectedDelivery = 'Delivery date cannot be in the past';
      if (!deliveryLocationId.trim()) errs.deliveryLocation = 'Select a delivery location';
    }
    if (expectedDeliveryDate && expectedDeliveryDate < todayIso()) {
      errs.expectedDelivery = 'Delivery date cannot be in the past';
    }
    setFieldErrors(errs);
    setSubmitted(true);
    return Object.keys(errs).length === 0;
  };

  const buildPayload = (mode: 'draft' | 'send' | 'confirm') => {
    const attachmentPayload: PurchaseOrderAttachment[] = attachments.map((a) => ({
      fileName: a.fileName,
      mimeType: a.mimeType,
      size: a.size,
    }));
    const snap = buildSupplierSnapshot(resolvedSupplierId, supplierSearch, paymentTerms, footerEmailOverride || undefined);
    return {
      supplierId: resolvedSupplierId,
      supplierName:
        supplierSearch.trim() || supplierItems.find((s) => s.id === supplierId)?.name || supplierId.trim(),
      supplierContactSnapshot: snap,
      orderDate,
      expectedDeliveryDate: expectedDeliveryDate || undefined,
      deliveryLocationId: deliveryLocationId.trim() || undefined,
      paymentTerms: paymentTerms || undefined,
      priority,
      shippingFreight: orderTotals.freight,
      supplierMessage: supplierMessage.trim() || undefined,
      attachments: attachmentPayload.length ? attachmentPayload : undefined,
      lines: lines.map((l) => ({
        variantId: l.variantId,
        quantityOrdered: Number(l.quantityOrdered || 0),
        unitId: l.unitId?.trim() || undefined,
        expectedPrice: l.expectedPrice != null ? Number(l.expectedPrice) : undefined,
        taxPercent: clampPct(l.taxPercent),
        discountPercent: clampPct(l.discountPercent),
      })),
      confirm: mode === 'confirm',
      submittedToSupplier: mode === 'send',
    };
  };

  const persistOrder = async (mode: 'draft' | 'send' | 'confirm') => {
    if (!validateFields(mode)) return null;
    setBusy(true);
    try {
      const body = buildPayload(mode);
      let order: PurchaseOrder;
      if (!savedOrderId) {
        order = await purchaseService.createOrder(body, branchId);
        setSavedOrderId(order.id);
      } else {
        const { confirm: _c, submittedToSupplier: _s, lines: bodyLines, ...updateRest } = body;
        const updateBody = bodyLines?.length ? { ...updateRest, lines: bodyLines } : updateRest;
        order = await purchaseService.updateOrder(savedOrderId, updateBody, branchId);
        if (mode === 'confirm') {
          order = await purchaseService.confirmOrder(savedOrderId, branchId);
        }
      }
      setPoNumber(order.poNumber);
      setKnownOrders((prev) => {
        const rest = prev.filter((o) => o.id !== order.id);
        return [order, ...rest];
      });
      return order;
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Could not save purchase order');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    const order = await persistOrder('confirm');
    if (order) {
      setConfirmOpen(false);
      showToast('PO confirmed successfully');
      onSaved(order, 'confirm');
    }
  };

  const handleBack = useCallback(() => {
    if (hasFormData) setDiscardOpen(true);
    else onCancel();
  }, [hasFormData, onCancel]);

  const confirmDisabledReason = !resolvedSupplierId
    ? 'Select a supplier'
    : lines.length === 0
      ? 'Add at least one line item'
      : !expectedDeliveryDate
        ? 'Set expected delivery date'
        : '';

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'Enter') {
        if (partyDrawerOpen || discardOpen || busy || confirmOpen) return;
        if (!canConfirm) {
          e.preventDefault();
          if (confirmDisabledReason) showToast(confirmDisabledReason);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        setConfirmOpen(true);
        return;
      }
      if (e.key !== 'Escape') return;
      if (partyDrawerOpen) {
        e.preventDefault();
        setPartyDrawerOpen(false);
        return;
      }
      if (confirmOpen) {
        e.preventDefault();
        setConfirmOpen(false);
        return;
      }
      if (discardOpen) {
        e.preventDefault();
        setDiscardOpen(false);
        return;
      }

      const active = document.activeElement;

      if (isSupplierSearchInput(active)) {
        if (isComboboxListOpen(active)) {
          supplierListOpenRef.current = false;
          setSupplierListOpen(false);
          return;
        }
        supplierListOpenRef.current = false;
        setSupplierListOpen(false);
        e.preventDefault();
        handleBack();
        return;
      }

      if (isVariantSearchInput(active)) {
        if (isComboboxListOpen(active)) {
          variantListOpenRef.current = false;
          setVariantListOpen(false);
          return;
        }
        variantListOpenRef.current = false;
        setVariantListOpen(false);
        e.preventDefault();
        focusExpectedDelivery();
        return;
      }

      e.preventDefault();
      if (isActivePriceInput()) {
        const vid = [...priceInputRefs.current.entries()].find(([, el]) => el === active)?.[0];
        if (vid) focusLineQty(vid);
        else focusVariantSearch();
        return;
      }
      if (isActiveQtyInput()) {
        focusVariantSearch();
        return;
      }
      if (active === expectedDeliveryRef.current) {
        focusDeliveryLocation();
        return;
      }
      if (active === deliveryLocationRef.current) {
        focusSupplierSearch();
        return;
      }
      handleBack();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    busy,
    canConfirm,
    confirmDisabledReason,
    confirmOpen,
    discardOpen,
    focusDeliveryLocation,
    focusExpectedDelivery,
    focusLineQty,
    focusSupplierSearch,
    focusVariantSearch,
    handleBack,
    isActivePriceInput,
    isActiveQtyInput,
    isSupplierSearchInput,
    isVariantSearchInput,
    partyDrawerOpen,
    supplierListOpen,
    variantListOpen,
  ]);

  const confirmDialogMessage = useMemo(
    () =>
      `Confirm ${poNumber} with ${supplierSearch.trim() || 'supplier'} for ${formatInr(orderTotals.grandTotal)}?`,
    [orderTotals.grandTotal, poNumber, supplierSearch]
  );

  const navbarConfirmActions = useMemo(
    () => (
      <div className="po-create-navbar-confirm">
        {confirmDisabledReason ? (
          <Tooltip content={`${confirmDisabledReason} (Ctrl+Enter)`} position="bottom">
            <span>
              <Button type="button" variant="primary" disabled>
                Confirm order
              </Button>
            </span>
          </Tooltip>
        ) : (
          <Tooltip content="Ctrl+Enter" position="bottom">
            <span>
              <Button
                type="button"
                variant="primary"
                onClick={() => setConfirmOpen(true)}
                disabled={busy || !canConfirm}
              >
                Confirm order
              </Button>
            </span>
          </Tooltip>
        )}
      </div>
    ),
    [busy, canConfirm, confirmDisabledReason]
  );

  useEffect(() => {
    onNavbarTrailingChange?.(navbarConfirmActions);
    return () => onNavbarTrailingChange?.(null);
  }, [navbarConfirmActions, onNavbarTrailingChange]);

  return (
    <div className="po-create">
      {toast ? <div className="po-create-toast" role="status">{toast}</div> : null}

      <div className="po-create-scroll">
        <section
          className="po-create-card po-create-card--details-sticky"
          aria-labelledby="po-order-details-eyebrow"
        >
          <div className="po-create-details-head">
            <div className="po-create-details-head__left">
              <span id="po-order-details-eyebrow" className="po-create-card__eyebrow">
                Order details
              </span>
              <Tooltip content="Auto-generated. Click refresh to change." position="bottom">
                <span className="po-create-po-chip">
                  {poNumber}
                  <button
                    type="button"
                    className="po-create-po-chip__refresh"
                    aria-label="Refresh PO number"
                    onClick={() => refreshPoNumber()}
                  >
                    ↻
                  </button>
                </span>
              </Tooltip>
            </div>
            <button
              type="button"
              className={`po-create-urgent-toggle${priority === 'urgent' ? ' po-create-urgent-toggle--active' : ''}`}
              aria-pressed={priority === 'urgent'}
              onClick={() => setPriority((p) => (p === 'urgent' ? 'normal' : 'urgent'))}
            >
              ⚑ Urgent
            </button>
          </div>

          <div className="po-create-details-fields">
            <SearchCombobox<SupplierRecord>
              id="po-supplier-search"
              className="po-create-field po-create-field--inline po-create-supplier-wrap"
              label="Supplier"
              showRequired={submitted && !supplierId}
              placeholder="Search by supplier name or GST number"
              error={fieldErrors.supplier}
              inputRef={supplierSearchRef}
              value={supplierSearch}
              selectedId={supplierId || null}
              onValueChange={onSupplierValueChange}
              onSelect={pickSupplier}
              onOpenChange={handleSupplierOpenChange}
              items={supplierItems}
              recentItems={recentSuppliers}
              getItemId={(s) => s.id}
              filterItems={filterSuppliers}
              getSearchableText={(s) => `${s.name} ${s.id} ${s.gstin}`}
              getItemLabel={(s) => s.name}
              minSearchLength={2}
              maxResults={6}
              recentSectionLabel="Recent suppliers"
              emptyMessage="No suppliers found"
              createPolicy="empty-only"
              createLabel={(q) => `Add supplier "${q}"`}
              onCreateRequest={(q) => {
                setPartyDraftName(q);
                setPartyDrawerOpen(true);
              }}
              renderItem={(s) => (
                <div className="po-party-option">
                  <div className="po-party-option__top">
                    <span className="po-party-option__name">{s.name}</span>
                    <span className="po-party-option__gst">{s.gstin}</span>
                  </div>
                  <div className="po-party-option__meta">
                    {s.lastOrderedAt != null
                      ? `Last ordered: ${daysAgoLabel(s.lastOrderedAt)} · ${formatInr(s.lastOrderTotal ?? 0)}`
                      : 'No previous orders'}
                  </div>
                </div>
              )}
            />

            <div className="po-create-field po-create-field--inline">
              <label
                className="po-create-label"
                htmlFor="po-delivery-location"
                data-show-required={submitted && !deliveryLocationId ? 'true' : undefined}
              >
                Deliver to
              </label>
              <select
                ref={deliveryLocationRef}
                id="po-delivery-location"
                className={`po-create-select${fieldErrors.deliveryLocation ? ' po-create-select--error' : ''}`}
                value={deliveryLocationId}
                onChange={(e) => applyDeliveryLocation(e.target.value)}
              >
                <option value="">Select location</option>
                {locationOptions.map((o) => (
                  <option
                    key={o.value}
                    value={o.value}
                    onMouseDown={() => applyDeliveryLocation(o.value)}
                  >
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="po-create-field po-create-field--inline po-create-field--date">
              <label
                className="po-create-label"
                htmlFor="po-expected-delivery"
                data-show-required={submitted && !expectedDeliveryDate ? 'true' : undefined}
              >
                Expected delivery
              </label>
              <input
                ref={expectedDeliveryRef}
                id="po-expected-delivery"
                type="date"
                className={`po-create-input${fieldErrors.expectedDelivery ? ' po-create-input--error' : ''}`}
                value={expectedDeliveryDate}
                min={todayIso()}
                onChange={(e) => {
                  setExpectedDeliveryDate(e.target.value);
                  setUrgentHintDismissed(false);
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  focusVariantSearch();
                }}
                title={expectedDeliveryDate ? formatDateIn(expectedDeliveryDate) : 'DD / MM / YYYY'}
              />
            </div>
          </div>

          {fieldErrors.supplier ||
          (supplierId && !fieldErrors.supplier) ||
          (editContactOpen && supplierId) ||
          openDraftForSupplier ||
          fieldErrors.deliveryLocation ||
          fieldErrors.expectedDelivery ? (
            <div className="po-create-details-ancillary">
              {fieldErrors.supplier ? <p className="po-create-field-error">{fieldErrors.supplier}</p> : null}
              {supplierId && !fieldErrors.supplier ? (
                <p className="po-create-hint">
                  Payment terms: {supplierSnapshot.defaultPaymentTerms || 'Net 30'} · Contact:{' '}
                  {supplierSnapshot.email || '—'}{' '}
                  <button type="button" className="po-create-hint-link" onClick={() => setEditContactOpen((v) => !v)}>
                    [edit]
                  </button>
                </p>
              ) : null}
              {editContactOpen && supplierId ? (
                <div className="po-create-details-edit-contact">
                  <Select
                    label="Payment terms"
                    value={paymentTerms}
                    onChange={(e) => setPaymentTerms(e.target.value)}
                    options={PAYMENT_TERM_OPTIONS}
                  />
                  <Input
                    label="Contact email"
                    value={footerEmailOverride || supplierSnapshot.email || ''}
                    onChange={(e) => setFooterEmailOverride(e.target.value)}
                  />
                </div>
              ) : null}
              {openDraftForSupplier ? (
                <div className="po-create-hint--warn" role="status">
                  <span>
                    Open {openDraftForSupplier.poNumber} exists for this supplier. Add lines to it instead?
                  </span>
                  <button
                    type="button"
                    className="po-create-hint-link"
                    onClick={() => navigate(`/purchases/orders/${openDraftForSupplier.id}?tab=orders`)}
                  >
                    View PO
                  </button>
                  <button type="button" className="po-create-hint-link" onClick={() => setDismissOpenPoAlert(true)}>
                    Continue anyway
                  </button>
                </div>
              ) : null}
              {fieldErrors.deliveryLocation ? (
                <p className="po-create-field-error">{fieldErrors.deliveryLocation}</p>
              ) : null}
              {fieldErrors.expectedDelivery ? (
                <p className="po-create-field-error">{fieldErrors.expectedDelivery}</p>
              ) : null}
            </div>
          ) : null}

          {isDeliveryUrgent && !urgentHintDismissed ? (
            <p className="po-create-hint po-create-hint--amber po-create-details-ancillary">
              Delivery is within 2 days.{' '}
              <button type="button" className="po-create-hint-link" onClick={() => setPriority('urgent')}>
                Mark Urgent?
              </button>
              <button type="button" className="po-create-hint-link" onClick={() => setUrgentHintDismissed(true)}>
                Dismiss
              </button>
            </p>
          ) : null}
        </section>

        <section className="po-create-card" aria-labelledby="po-create-lines-title">
          <div className="po-create-toolbar">
            <ProductSearchCombobox
              mode="catalog"
              branchId={branchId}
              className="po-create-toolbar__search"
              value={variantSearch}
              onValueChange={setVariantSearch}
              onSelect={addVariant}
              inputRef={variantSearchRef}
              onOpenChange={handleVariantOpenChange}
              comboboxAriaLabel="Search products to add to purchase order"
            />
          </div>

          <div className="po-create-table-wrap">
            <table className="po-create-table">
              <thead>
                <tr>
                  {['Product / variant', 'Qty', 'Unit', 'Unit price', 'Total'].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
                      No items yet. Search above to add products.
                    </td>
                  </tr>
                ) : (
                  lines.map((line) => {
                    const { lineTotal } = lineMath(line.quantityOrdered, line.expectedPrice, line.taxPercent, line.discountPercent);
                    return (
                      <tr key={line.variantId}>
                        <td>
                          <div className="po-create-product-cell__name">
                            {line.productName} — {line.variantName}
                          </div>
                          {line.sku ? (
                            <div className="po-create-product-cell__sku">{line.sku}</div>
                          ) : null}
                        </td>
                        <td>
                          <div className="po-create-qty">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() =>
                                decrementQtyForLine(line.variantId, line.quantityOrdered, updateLine, removeLine)
                              }
                            >
                              −
                            </Button>
                            <Input
                              ref={(el) => {
                                if (el) qtyInputRefs.current.set(line.variantId, el);
                                else qtyInputRefs.current.delete(line.variantId);
                              }}
                              label=""
                              type="text"
                              inputMode="decimal"
                              className="po-create-num-input"
                              value={quantityInputValue(line.quantityOrdered)}
                              onFocus={selectInputOnFocus}
                              onChange={(e) => {
                                const parsed = parseDecimalInput(e.target.value);
                                updateLine(line.variantId, {
                                  quantityOrdered: parsed == null ? 0 : Math.max(0, parsed),
                                });
                              }}
                              onKeyDown={(e) => {
                                if (e.key !== 'Enter') return;
                                e.preventDefault();
                                const parsed = parseDecimalInput(e.currentTarget.value);
                                if (parsed == null || parsed <= 0) {
                                  removeLine(line.variantId);
                                  focusVariantSearch();
                                  return;
                                }
                                updateLine(line.variantId, { quantityOrdered: parsed });
                                focusLinePrice(line.variantId);
                              }}
                            />
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() =>
                                updateLine(line.variantId, {
                                  quantityOrdered: Math.max(0, Number(line.quantityOrdered) || 0) + 1,
                                })
                              }
                            >
                              +
                            </Button>
                          </div>
                        </td>
                        <td>
                          <Select
                            label=""
                            className="po-create-unit-select"
                            value={line.unitId}
                            onChange={(e) => updateLine(line.variantId, { unitId: e.target.value })}
                            options={(line.unitOptions.length
                              ? line.unitOptions
                              : [{ unitCode: line.unitId || 'pcs', factorToBase: 1 }]
                            ).map((u) => ({
                              value: u.unitCode,
                              label: u.unitCode.toUpperCase(),
                            }))}
                          />
                        </td>
                        <td>
                          <Input
                            ref={(el) => {
                              if (el) priceInputRefs.current.set(line.variantId, el);
                              else priceInputRefs.current.delete(line.variantId);
                            }}
                            label=""
                            type="text"
                            inputMode="decimal"
                            className="po-create-num-input"
                            value={priceInputValue(line.expectedPrice)}
                            onFocus={selectInputOnFocus}
                            onChange={(e) => {
                              const parsed = parseDecimalInput(e.target.value);
                              updateLine(line.variantId, {
                                expectedPrice: parsed == null ? 0 : Math.max(0, parsed),
                              });
                            }}
                            onKeyDown={(e) => {
                              if (e.key !== 'Enter') return;
                              e.preventDefault();
                              focusVariantSearch();
                            }}
                          />
                        </td>
                        <td>{formatInr(lineTotal)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="po-create-summary">
            <div className="po-create-summary__row">
              <span>Subtotal</span>
              <span>{formatInr(orderTotals.subtotal)}</span>
            </div>
            <div className="po-create-summary__row">
              <span>Shipping / freight</span>
              <Input
                label=""
                type="number"
                min={0}
                value={shippingFreight}
                onChange={(e) => setShippingFreight(Math.max(0, Number(e.target.value) || 0))}
                style={{ maxWidth: '8rem' }}
              />
            </div>
            <div className="po-create-summary__row po-create-summary__row--strong">
              <span>Grand total</span>
              <span>{formatInr(orderTotals.grandTotal)}</span>
            </div>
          </div>
        </section>

        <section className="po-create-card" aria-labelledby="po-notes-title">
          <h2 id="po-notes-title" className="po-create-card__title">
            Notes
          </h2>
          <Textarea
            label="Message to supplier (optional)"
            value={supplierMessage}
            onChange={(e) => setSupplierMessage(e.target.value)}
            rows={3}
          />
          <div className="po-create-attachments">
            {attachments.map((a) => (
              <span key={a.id} className="po-create-chip">
                {a.fileName}
                <button type="button" aria-label={`Remove ${a.fileName}`} onClick={() => setAttachments((p) => p.filter((x) => x.id !== a.id))}>
                  ×
                </button>
              </span>
            ))}
            <Button type="button" variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
              Upload
            </Button>
            <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => {
              const list = e.target.files;
              if (!list?.length) return;
              const next: LocalAttachment[] = [];
              for (let i = 0; i < list.length; i += 1) {
                const f = list[i];
                next.push({ id: `${f.name}-${Date.now()}-${i}`, fileName: f.name, size: f.size, mimeType: f.type });
              }
              setAttachments((p) => [...p, ...next]);
              if (fileInputRef.current) fileInputRef.current.value = '';
            }} />
          </div>
        </section>
      </div>

      <ConfirmDialog
        isOpen={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void handleConfirm()}
        title="Confirm purchase order"
        message={confirmDialogMessage}
        confirmLabel={busy ? 'Confirming…' : 'Yes, confirm'}
        cancelLabel="Cancel"
        variant="info"
        showVariantNotice={false}
        initialFocus="confirm"
        closeOnOverlayClick={!busy}
        closeOnEscape={!busy}
      />

      <ConfirmDialog
        isOpen={discardOpen}
        onCancel={() => setDiscardOpen(false)}
        onConfirm={() => {
          setDiscardOpen(false);
          onCancel();
        }}
        title="Discard this PO?"
        message="Your changes will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        variant="danger"
        showVariantNotice={false}
        initialFocus="confirm"
      />

      <QuickAddPartyDrawer
        isOpen={partyDrawerOpen}
        onClose={() => setPartyDrawerOpen(false)}
        initialName={partyDraftName}
        paymentTermOptions={PAYMENT_TERM_OPTIONS}
        existingParties={supplierItems}
        onSaved={handlePartySaved}
        persistParty={async (party) => {
          const record = await saveSupplier({
            name: party.name,
            gstin: party.gstin !== '—' ? party.gstin : undefined,
            email: party.email || undefined,
            phone: party.phone,
            paymentTerms: paymentLabelToValue(party.paymentTermsLabel),
          });
          return {
            id: record.id,
            name: record.name,
            gstin: record.gstin,
            email: record.email,
            phone: record.phone,
            paymentTermsLabel: record.paymentTermsLabel,
          };
        }}
      />

    </div>
  );
};
