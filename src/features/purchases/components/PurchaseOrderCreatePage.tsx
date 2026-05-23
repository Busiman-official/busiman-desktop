import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, SearchCombobox, Select, Textarea } from '@/shared/components/ui';
import { Tooltip } from '@/shared/components/ui/Tooltip';
import { ConfirmDialog } from '@/shared/components/modals/ConfirmDialog';
import { SideDrawer } from '@/shared/components/modals/SideDrawer';
import {
  inventoryService,
  catalogRows,
  type CatalogVariantRow,
  type Location,
  LocationType,
} from '@/services/inventory.service';
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
import './PurchaseOrderCreatePage.css';

type DraftLine = {
  variantId: string;
  itemId: string;
  productName: string;
  variantName: string;
  sku: string;
  quantityOrdered: number;
  unitId: string;
  expectedPrice: number;
  taxPercent: number;
  discountPercent: number;
};

type SupplierRecord = {
  id: string;
  name: string;
  gstin: string;
  email: string;
  paymentTermsLabel: string;
  lastOrderedAt?: number;
  lastOrderTotal?: number;
};

type Props = {
  branchId?: string | null;
  supplierOptions: Array<{ id: string; name: string }>;
  orderRows: PurchaseOrder[];
  onCancel: () => void;
  onSaved: (order: PurchaseOrder, mode: 'draft' | 'send' | 'confirm') => void;
};

const PAYMENT_TERM_OPTIONS = [
  { value: 'due_on_receipt', label: 'Due on receipt' },
  { value: 'net_7', label: 'Net 7' },
  { value: 'net_15', label: 'Net 15' },
  { value: 'net_30', label: 'Net 30' },
  { value: 'net_45', label: 'Net 45' },
  { value: 'net_60', label: 'Net 60' },
  { value: 'advance', label: 'Advance' },
];

function formatInr(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(v);
}

function formatDateIn(v: string): string {
  if (!v) return '';
  const [y, m, d] = v.split('-');
  if (!y || !m || !d) return v;
  return `${d.padStart(2, '0')} / ${m.padStart(2, '0')} / ${y}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function stableHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function sanitizeEmailLocal(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 48) || 'vendor';
}

function buildSupplierSnapshot(
  supplierId: string,
  supplierName: string,
  orderPaymentTerms: string,
  emailOverride?: string
): PurchaseOrderSupplierContact {
  if (!supplierId.trim()) {
    return {
      contactPerson: '—',
      phone: '—',
      email: '—',
      gstin: '—',
      defaultPaymentTerms: orderPaymentTerms
        ? PAYMENT_TERM_OPTIONS.find((o) => o.value === orderPaymentTerms)?.label || orderPaymentTerms
        : '—',
      outstandingDues: 0,
    };
  }
  const h = stableHash(`${supplierId}|${supplierName}`);
  const dues = h % 11 === 0 ? (h % 890_120) / 100 : 0;
  const panish = ((h >>> 0) % 1e9).toString().padStart(9, '0').slice(0, 9);
  const label = supplierName.trim() || supplierId;
  return {
    contactPerson: `Accounts — ${label}`.slice(0, 200),
    phone: `+91 98${(h % 90_000_000).toString().padStart(8, '0')}`,
    email: emailOverride?.trim() || `${sanitizeEmailLocal(label)}.po@supplier.local`,
    gstin: `22AAAAA${panish}A1Z5`.slice(0, 15),
    defaultPaymentTerms:
      PAYMENT_TERM_OPTIONS.find((o) => o.value === orderPaymentTerms)?.label || orderPaymentTerms || 'Net 30',
    outstandingDues: dues,
  };
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

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQ = !inQ;
      continue;
    }
    if (ch === ',' && !inQ) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function isMongoId(s: string): boolean {
  return /^[a-fA-F0-9]{24}$/.test(String(s).trim());
}

function daysAgoLabel(ts: number): string {
  const days = Math.max(0, Math.floor((Date.now() - ts) / 86400000));
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function buildSupplierDirectory(
  supplierOptions: Array<{ id: string; name: string }>,
  orderRows: PurchaseOrder[]
): SupplierRecord[] {
  const map = new Map<string, SupplierRecord>();
  for (const s of supplierOptions) {
    const snap = buildSupplierSnapshot(s.id, s.name, 'net_30');
    map.set(s.id, {
      id: s.id,
      name: s.name,
      gstin: snap.gstin || '—',
      email: snap.email || '',
      paymentTermsLabel: snap.defaultPaymentTerms || 'Net 30',
    });
  }
  for (const o of orderRows) {
    const id = o.supplierId;
    const name = o.supplierName || id;
    const snap = o.supplierContactSnapshot;
    const existing = map.get(id);
    const ts = new Date(o.orderDate).getTime();
    const total = o.lines.reduce((sum, l) => {
      const { lineTotal } = lineMath(l.quantityOrdered, l.expectedPrice ?? 0, l.taxPercent ?? 0, l.discountPercent ?? 0);
      return sum + lineTotal;
    }, 0) + (o.shippingFreight ?? 0);
    if (!existing) {
      map.set(id, {
        id,
        name,
        gstin: snap?.gstin || buildSupplierSnapshot(id, name, 'net_30').gstin || '—',
        email: snap?.email || buildSupplierSnapshot(id, name, 'net_30').email || '',
        paymentTermsLabel: snap?.defaultPaymentTerms || 'Net 30',
        lastOrderedAt: ts,
        lastOrderTotal: total,
      });
    } else {
      if (!existing.lastOrderedAt || ts > existing.lastOrderedAt) {
        existing.lastOrderedAt = ts;
        existing.lastOrderTotal = total;
      }
      if (snap?.gstin) existing.gstin = snap.gstin;
      if (snap?.email) existing.email = snap.email;
      if (snap?.defaultPaymentTerms) existing.paymentTermsLabel = snap.defaultPaymentTerms;
      if (name) existing.name = name;
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
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
  onCancel,
  onSaved,
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
  const [internalReference, setInternalReference] = useState('');
  const [showReference, setShowReference] = useState(false);
  const [supplierMessage, setSupplierMessage] = useState('');
  const [shippingFreight, setShippingFreight] = useState(0);
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [knownOrders, setKnownOrders] = useState<PurchaseOrder[]>(orderRows);
  const [variantSearch, setVariantSearch] = useState('');
  const [suggestions, setSuggestions] = useState<CatalogVariantRow[]>([]);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [toast, setToast] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [sendDrawerOpen, setSendDrawerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sendEmail, setSendEmail] = useState('');
  const [sendSubject, setSendSubject] = useState('');
  const [footerEmailOverride, setFooterEmailOverride] = useState('');
  const [footerEmailEditing, setFooterEmailEditing] = useState(false);
  const [dismissOpenPoAlert, setDismissOpenPoAlert] = useState(false);
  const [urgentHintDismissed, setUrgentHintDismissed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const supplierDirectory = useMemo(
    () => buildSupplierDirectory(supplierOptions, knownOrders),
    [supplierOptions, knownOrders]
  );

  const supplierItems = useMemo(
    () => [...supplierDirectory, ...extraParties],
    [supplierDirectory, extraParties]
  );

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
    const q = variantSearch.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    inventoryService
      .getCatalog({ search: q, branchId: branchId || undefined, isActive: true, page: 1, limit: 8 })
      .then((data) => {
        if (!cancelled) setSuggestions(catalogRows(data));
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [branchId, variantSearch]);

  useEffect(() => {
    const name = supplierItems.find((s) => s.id === supplierId)?.name || supplierSearch;
    setSupplierSnapshot(buildSupplierSnapshot(supplierId, name, paymentTerms, footerEmailOverride || undefined));
    const rec = supplierItems.find((s) => s.id === supplierId);
    if (rec?.email && !footerEmailOverride) setSendEmail(rec.email);
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

  const filterSuppliers = useCallback((list: SupplierRecord[], query: string) => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.gstin.toLowerCase().includes(q)
    );
  }, []);

  const resolvedSupplierId = useMemo(() => {
    if (supplierId.trim()) return supplierId.trim();
    const name = supplierSearch.trim();
    if (!name) return '';
    return `sup-${stableHash(name)}`;
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

  const footerStats = useMemo(() => {
    const totalQty = lines.reduce((s, l) => s + Number(l.quantityOrdered || 0), 0);
    return { totalItems: lines.length, totalQty, grandTotal: orderTotals.grandTotal };
  }, [lines, orderTotals.grandTotal]);

  const isDeliveryUrgent = useMemo(() => {
    if (!expectedDeliveryDate) return false;
    const d = new Date(`${expectedDeliveryDate}T12:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = (d.getTime() - today.getTime()) / 86400000;
    return diff >= 0 && diff <= 2;
  }, [expectedDeliveryDate]);

  const supplierEmail = footerEmailOverride.trim() || supplierSnapshot.email?.trim() || '';
  const hasSupplierEmail = Boolean(supplierEmail && supplierEmail !== '—');

  const hasFormData = Boolean(
    supplierId ||
      supplierSearch.trim() ||
      lines.length ||
      internalReference.trim() ||
      expectedDeliveryDate ||
      supplierMessage.trim() ||
      attachments.length ||
      shippingFreight > 0
  );

  const canSend = Boolean(resolvedSupplierId && lines.length > 0);
  const canConfirm = Boolean(resolvedSupplierId && lines.length > 0 && expectedDeliveryDate);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  };

  const rowFromCatalog = useCallback((row: CatalogVariantRow): DraftLine => {
    const price = row.costPrice ?? row.sellingPrice ?? 0;
    return {
      variantId: row.variantId,
      itemId: row.productId,
      productName: row.productName,
      variantName: row.variantName,
      sku: row.sku,
      quantityOrdered: 1,
      unitId: 'PCS',
      expectedPrice: Number(price) || 0,
      taxPercent: 0,
      discountPercent: 0,
    };
  }, []);

  const addVariant = useCallback(
    (row: CatalogVariantRow) => {
      setLines((prev) => {
        const i = prev.findIndex((l) => l.variantId === row.variantId);
        if (i >= 0) {
          const next = [...prev];
          next[i] = { ...next[i], quantityOrdered: next[i].quantityOrdered + 1 };
          return next;
        }
        return [...prev, rowFromCatalog(row)];
      });
      setVariantSearch('');
      setSuggestions([]);
    },
    [rowFromCatalog]
  );

  const updateLine = (variantId: string, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((l) => (l.variantId === variantId ? { ...l, ...patch } : l)));
  };

  const removeLine = (variantId: string) => {
    setLines((prev) => prev.filter((l) => l.variantId !== variantId));
  };

  const pickSupplier = useCallback((s: SupplierRecord) => {
    setSupplierId(s.id);
    setSupplierSearch(s.name);
    setDismissOpenPoAlert(false);
    if (s.email) setSendEmail(s.email);
    const term = PAYMENT_TERM_OPTIONS.find((o) => o.label === s.paymentTermsLabel)?.value;
    if (term) setPaymentTerms(term);
  }, []);

  const onSupplierValueChange = (v: string) => {
    setSupplierSearch(v);
    const exact = supplierItems.find((s) => s.name.toLowerCase() === v.trim().toLowerCase());
    if (exact) setSupplierId(exact.id);
    else if (!supplierItems.some((s) => s.id === supplierId && s.name === v)) setSupplierId('');
  };

  const handlePartySaved = useCallback(
    (party: { id: string; name: string; gstin: string; email: string; paymentTermsLabel: string }) => {
      const record: SupplierRecord = {
        id: party.id,
        name: party.name,
        gstin: party.gstin,
        email: party.email,
        paymentTermsLabel: party.paymentTermsLabel,
      };
      setExtraParties((prev) => [...prev, record]);
      pickSupplier(record);
      setPartyDraftName('');
    },
    [pickSupplier]
  );

  const validateFields = (mode: 'draft' | 'send' | 'confirm'): boolean => {
    const errs: FieldErrors = {};
    if (!resolvedSupplierId) errs.supplier = 'Select or enter a supplier';
    if (mode !== 'draft') {
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
    const snap = buildSupplierSnapshot(resolvedSupplierId, supplierSearch, paymentTerms, footerEmailOverride || sendEmail);
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
      internalNotes: internalReference.trim() || undefined,
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

  const handleSaveDraft = async () => {
    if (!resolvedSupplierId) {
      setFieldErrors({ supplier: 'Select or enter a supplier to save a draft' });
      setSubmitted(true);
      return;
    }
    const order = await persistOrder('draft');
    if (order) {
      showToast(`Draft saved — ${order.poNumber}`);
      onSaved(order, 'draft');
    }
  };

  const openSendDrawer = () => {
    if (!canSend) return;
    const name = supplierSearch || supplierDirectory.find((s) => s.id === supplierId)?.name || 'Supplier';
    setSendSubject(`Purchase Order ${poNumber} — ${name}`);
    setSendEmail(supplierEmail || sendEmail);
    setSendDrawerOpen(true);
  };

  const handleSend = async () => {
    const order = await persistOrder('send');
    if (order) {
      setSendDrawerOpen(false);
      showToast(`PO sent to ${sendEmail || 'supplier'}`);
      onSaved(order, 'send');
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

  const handleBack = () => {
    if (hasFormData) setDiscardOpen(true);
    else onCancel();
  };

  const importCsv = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    const rawLines = text.split(/\r?\n/).filter((l) => l.trim());
    if (rawLines.length < 2) {
      showToast('CSV must include a header row and at least one data row.');
      if (csvInputRef.current) csvInputRef.current.value = '';
      return;
    }
    const header = parseCsvLine(rawLines[0]).map((h) => h.toLowerCase().replace(/\s+/g, ''));
    const col = (name: string) => header.indexOf(name);
    const idxVariant = col('variantid');
    const idxSku = col('sku');
    const idxQty = col('qty') >= 0 ? col('qty') : col('quantity');
    const idxUnit = col('unit');
    const idxPrice = col('unitprice') >= 0 ? col('unitprice') : col('price');
    const idxTax = col('taxpercent') >= 0 ? col('taxpercent') : col('tax');
    const idxDisc = col('discountpercent') >= 0 ? col('discountpercent') : col('discount');
    const errors: string[] = [];
    const newLines: DraftLine[] = [];

    for (let r = 1; r < rawLines.length; r += 1) {
      const cells = parseCsvLine(rawLines[r]);
      if (!cells.some((c) => c)) continue;
      try {
        const variantId = idxVariant >= 0 ? cells[idxVariant]?.trim() : '';
        const sku = idxSku >= 0 ? cells[idxSku]?.trim() : '';
        const qty = Math.max(0.000001, Number(idxQty >= 0 ? cells[idxQty] : '1') || 1);
        const unit = idxUnit >= 0 ? cells[idxUnit]?.trim() || 'PCS' : 'PCS';
        const price = idxPrice >= 0 ? Math.max(0, Number(cells[idxPrice]) || 0) : 0;
        const taxP = idxTax >= 0 ? clampPct(Number(cells[idxTax]) || 0) : 0;
        const discP = idxDisc >= 0 ? clampPct(Number(cells[idxDisc]) || 0) : 0;

        if (variantId && isMongoId(variantId)) {
          const v = await inventoryService.getVariantById(variantId);
          const item = await inventoryService.getItemById(v.itemId);
          newLines.push({
            variantId: v.id,
            itemId: v.itemId,
            productName: item.name,
            variantName: v.name,
            sku: v.sku || v.code,
            quantityOrdered: qty,
            unitId: unit,
            expectedPrice: price,
            taxPercent: taxP,
            discountPercent: discP,
          });
        } else if (sku) {
          const rows = catalogRows(
            await inventoryService.getCatalog({
              search: sku,
              branchId: branchId || undefined,
              isActive: true,
              page: 1,
              limit: 20,
            })
          );
          const match = rows.find((x) => x.sku.toLowerCase() === sku.toLowerCase()) || rows[0];
          if (!match) {
            errors.push(`Row ${r + 1}: no match for SKU "${sku}"`);
            continue;
          }
          const base = rowFromCatalog(match);
          newLines.push({ ...base, quantityOrdered: qty, unitId: unit, expectedPrice: price || base.expectedPrice, taxPercent: taxP, discountPercent: discP });
        } else {
          errors.push(`Row ${r + 1}: provide variantId or sku`);
        }
      } catch (e) {
        errors.push(`Row ${r + 1}: ${e instanceof Error ? e.message : 'failed'}`);
      }
    }

    if (newLines.length) {
      setLines((prev) => {
        const byId = new Map(prev.map((l) => [l.variantId, { ...l }]));
        for (const nl of newLines) {
          const ex = byId.get(nl.variantId);
          if (ex) {
            byId.set(nl.variantId, {
              ...ex,
              quantityOrdered: ex.quantityOrdered + nl.quantityOrdered,
              unitId: nl.unitId || ex.unitId,
              expectedPrice: nl.expectedPrice || ex.expectedPrice,
              taxPercent: nl.taxPercent,
              discountPercent: nl.discountPercent,
            });
          } else {
            byId.set(nl.variantId, nl);
          }
        }
        return [...byId.values()];
      });
    }
    if (errors.length) showToast(errors.slice(0, 3).join(' · '));
    if (csvInputRef.current) csvInputRef.current.value = '';
  };

  const sendDisabledReason = !resolvedSupplierId
    ? 'Select a supplier'
    : lines.length === 0
      ? 'Add at least one line item'
      : '';

  const confirmDisabledReason = !resolvedSupplierId
    ? 'Select a supplier'
    : lines.length === 0
      ? 'Add at least one line item'
      : !expectedDeliveryDate
        ? 'Set expected delivery date'
        : '';

  return (
    <div className="po-create">
      {toast ? <div className="po-create-toast" role="status">{toast}</div> : null}

      <div className="po-create-scroll">
        <section
          className="po-create-card po-create-card--details-sticky"
          aria-labelledby="po-order-details-eyebrow"
        >
          <div className="po-create-details-head">
            <span id="po-order-details-eyebrow" className="po-create-card__eyebrow">
              Order details
            </span>
            <div className="po-create-details-head__right">
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
              <div className="po-create-priority" role="group" aria-label="Order priority">
                <button
                  type="button"
                  className={`po-create-priority__btn${priority === 'normal' ? ' po-create-priority__btn--active' : ''}`}
                  onClick={() => setPriority('normal')}
                >
                  Normal
                </button>
                <button
                  type="button"
                  className={`po-create-priority__btn po-create-priority__btn--urgent${priority === 'urgent' ? ' po-create-priority__btn--active' : ''}`}
                  onClick={() => setPriority('urgent')}
                >
                  ⚑ Urgent
                </button>
              </div>
            </div>
          </div>

          <div className="po-create-details-fields">
            <SearchCombobox<SupplierRecord>
              id="po-supplier-search"
              className="po-create-field po-create-field--inline po-create-supplier-wrap"
              label="Supplier"
              showRequired={submitted && !supplierId}
              placeholder="Search by supplier name or GST number"
              error={fieldErrors.supplier}
              value={supplierSearch}
              selectedId={supplierId || null}
              onValueChange={onSupplierValueChange}
              onSelect={pickSupplier}
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
                id="po-delivery-location"
                className={`po-create-select${fieldErrors.deliveryLocation ? ' po-create-select--error' : ''}`}
                value={deliveryLocationId}
                onChange={(e) => setDeliveryLocationId(e.target.value)}
              >
                <option value="">Select location</option>
                {locationOptions.map((o) => (
                  <option key={o.value} value={o.value}>
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
                id="po-expected-delivery"
                type="date"
                className={`po-create-input${fieldErrors.expectedDelivery ? ' po-create-input--error' : ''}`}
                value={expectedDeliveryDate}
                min={todayIso()}
                onChange={(e) => {
                  setExpectedDeliveryDate(e.target.value);
                  setUrgentHintDismissed(false);
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

          <div className="po-create-details-foot">
            {showReference ? (
              <div className="po-create-details-ref-row">
                <label className="po-create-label" htmlFor="po-internal-ref">
                  Internal reference <span className="po-create-hint">(optional)</span>
                </label>
                <input
                  id="po-internal-ref"
                  className="po-create-input"
                  value={internalReference}
                  onChange={(e) => setInternalReference(e.target.value)}
                  placeholder="e.g. For Diwali stock, Linked to indent #44"
                />
              </div>
            ) : (
              <button type="button" className="po-create-ref-toggle" onClick={() => setShowReference(true)}>
                + Add reference
              </button>
            )}
          </div>
        </section>

        <section className="po-create-card" aria-labelledby="po-create-lines-title">
          <h2 id="po-create-lines-title" className="po-create-card__title">
            Line items
          </h2>
          <div className="po-create-toolbar">
            <div className="po-create-toolbar__search">
              <Input
                label="Add by SKU or product name"
                value={variantSearch}
                onChange={(e) => setVariantSearch(e.target.value)}
                placeholder="Type at least 2 characters"
              />
              {suggestions.length > 0 ? (
                <div className="po-create-suggestions">
                  {suggestions.map((s) => (
                    <button key={s.variantId} type="button" className="po-create-suggestion" onClick={() => addVariant(s)}>
                      <strong>{s.productName}</strong> — {s.variantName}
                      <span className="po-create-suggestion__meta"> ({s.sku})</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <Button type="button" variant="secondary" onClick={() => suggestions[0] && addVariant(suggestions[0])} disabled={!suggestions.length}>
              Add item
            </Button>
            <Button type="button" variant="secondary" onClick={() => csvInputRef.current?.click()}>
              Import CSV
            </Button>
            <input ref={csvInputRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => void importCsv(e.target.files?.[0] || null)} />
          </div>

          <div className="po-create-table-wrap">
            <table className="po-create-table">
              <thead>
                <tr>
                  {['Product / variant', 'SKU', 'Qty', 'Unit', 'Unit price', 'Tax %', 'Discount %', 'Line total', ''].map((h) => (
                    <th key={h || 'actions'}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
                      No items yet. Search above or import a CSV.
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
                          <div className="po-create-product-cell__sku">{line.sku}</div>
                        </td>
                        <td>{line.sku}</td>
                        <td>
                          <div className="po-create-qty">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() =>
                                updateLine(line.variantId, {
                                  quantityOrdered: Math.max(0.000001, Number(line.quantityOrdered) - 1),
                                })
                              }
                            >
                              −
                            </Button>
                            <Input
                              label=""
                              type="number"
                              min={0.000001}
                              step="any"
                              value={line.quantityOrdered}
                              onChange={(e) =>
                                updateLine(line.variantId, {
                                  quantityOrdered: Math.max(0.000001, Number(e.target.value) || 0.000001),
                                })
                              }
                            />
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => updateLine(line.variantId, { quantityOrdered: Number(line.quantityOrdered) + 1 })}
                            >
                              +
                            </Button>
                          </div>
                        </td>
                        <td>
                          <Input label="" value={line.unitId} onChange={(e) => updateLine(line.variantId, { unitId: e.target.value })} />
                        </td>
                        <td>
                          <Input
                            label=""
                            type="number"
                            min={0}
                            step="any"
                            value={line.expectedPrice}
                            onChange={(e) => updateLine(line.variantId, { expectedPrice: Math.max(0, Number(e.target.value) || 0) })}
                          />
                        </td>
                        <td>
                          <Input
                            label=""
                            type="number"
                            min={0}
                            max={100}
                            value={line.taxPercent}
                            onChange={(e) => updateLine(line.variantId, { taxPercent: clampPct(Number(e.target.value) || 0) })}
                          />
                        </td>
                        <td>
                          <Input
                            label=""
                            type="number"
                            min={0}
                            max={100}
                            value={line.discountPercent}
                            onChange={(e) => updateLine(line.variantId, { discountPercent: clampPct(Number(e.target.value) || 0) })}
                          />
                        </td>
                        <td>{formatInr(lineTotal)}</td>
                        <td>
                          <Button type="button" variant="secondary" size="sm" onClick={() => removeLine(line.variantId)}>
                            Remove
                          </Button>
                        </td>
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

      <footer className="po-create-footer">
        <div className="po-create-footer__stats">
          <span>Items: {footerStats.totalItems}</span>
          <span>Qty: {footerStats.totalQty}</span>
          <span>Grand total: {formatInr(footerStats.grandTotal)}</span>
        </div>

        <div className="po-create-footer__email">
          {resolvedSupplierId ? (
            hasSupplierEmail ? (
              <>
                <span>Will send to:</span>
                {footerEmailEditing ? (
                  <input
                    className="po-create-footer__email-input"
                    value={footerEmailOverride || supplierEmail}
                    onChange={(e) => setFooterEmailOverride(e.target.value)}
                    onBlur={() => setFooterEmailEditing(false)}
                    autoFocus
                  />
                ) : (
                  <>
                    <span className="po-create-footer__email-value">{supplierEmail}</span>
                    <button
                      type="button"
                      className="po-create-footer__email-edit"
                      aria-label="Edit supplier email for this PO"
                      onClick={() => setFooterEmailEditing(true)}
                    >
                      ✎
                    </button>
                  </>
                )}
              </>
            ) : (
              <span className="po-create-footer__email-warn">
                No supplier email on file{' '}
                <button type="button" className="po-create-hint-link" onClick={() => setFooterEmailEditing(true)}>
                  Add email
                </button>
              </span>
            )
          ) : null}
        </div>

        <div className="po-create-footer__actions">
          <Button type="button" variant="ghost" onClick={handleBack} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="secondary" onClick={() => void handleSaveDraft()} disabled={busy}>
            Save draft
          </Button>
          {sendDisabledReason ? (
            <Tooltip content={sendDisabledReason} position="top">
              <span className="po-create-footer__btn-wrap">
                <Button type="button" variant="secondary" onClick={openSendDrawer} disabled>
                  Send to supplier
                </Button>
              </span>
            </Tooltip>
          ) : (
            <Button type="button" variant="secondary" onClick={openSendDrawer} disabled={busy}>
              Send to supplier
            </Button>
          )}
          <div className="po-create-footer__btn-wrap">
            {confirmDisabledReason ? (
              <Tooltip content={confirmDisabledReason} position="top">
                <span>
                  <Button type="button" variant="primary" disabled>
                    Confirm order
                  </Button>
                </span>
              </Tooltip>
            ) : (
              <Button type="button" variant="primary" onClick={() => setConfirmOpen(true)} disabled={busy || !canConfirm}>
                Confirm order
              </Button>
            )}
            {confirmOpen ? (
              <div className="po-create-confirm-popover" role="dialog" aria-label="Confirm purchase order">
                <p>
                  Confirm {poNumber} with {supplierSearch || 'supplier'} for {formatInr(footerStats.grandTotal)}?
                </p>
                <div className="po-create-confirm-popover__actions">
                  <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="button" variant="primary" size="sm" onClick={() => void handleConfirm()} disabled={busy}>
                    Yes, confirm →
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </footer>

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
      />

      <QuickAddPartyDrawer
        isOpen={partyDrawerOpen}
        onClose={() => setPartyDrawerOpen(false)}
        initialName={partyDraftName}
        paymentTermOptions={PAYMENT_TERM_OPTIONS}
        existingParties={supplierItems}
        onSaved={handlePartySaved}
      />

      <SideDrawer isOpen={sendDrawerOpen} onClose={() => setSendDrawerOpen(false)} title="Send to supplier" width="520px">
        <div className="po-create-send-preview">
          <div>
            <Input label="To" value={sendEmail} onChange={(e) => setSendEmail(e.target.value)} />
            <Input label="Subject" value={sendSubject} onChange={(e) => setSendSubject(e.target.value)} />
          </div>
          <div className="po-create-send-preview__block">
            <h3>Purchase order preview</h3>
            <p>
              <strong>{poNumber}</strong> · {supplierSearch || 'Supplier'}
            </p>
            <p>Expected delivery: {expectedDeliveryDate ? formatDateIn(expectedDeliveryDate) : '—'}</p>
            <p>Deliver to: {locationOptions.find((o) => o.value === deliveryLocationId)?.label || '—'}</p>
            <p>Items: {footerStats.totalItems} · Qty: {footerStats.totalQty}</p>
            <p>
              <strong>Grand total: {formatInr(footerStats.grandTotal)}</strong>
            </p>
            {lines.length > 0 ? (
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {lines.slice(0, 8).map((l) => (
                  <li key={l.variantId}>
                    {l.productName} — {l.variantName} × {l.quantityOrdered}
                  </li>
                ))}
                {lines.length > 8 ? <li>…and {lines.length - 8} more</li> : null}
              </ul>
            ) : null}
            {supplierMessage ? <p style={{ marginTop: 8 }}>Note: {supplierMessage}</p> : null}
          </div>
        </div>
        <div className="po-create-send-drawer-actions">
          <Button type="button" variant="secondary" onClick={() => setSendDrawerOpen(false)}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={() => void handleSend()} disabled={busy || !sendEmail.trim()}>
            Send now →
          </Button>
        </div>
      </SideDrawer>
    </div>
  );
};
