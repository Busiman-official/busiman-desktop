import type {
  PurchaseOrder,
  PurchaseOrderSupplierContact,
  PurchaseSupplierMaster,
  SupplierMasterImportInput,
} from '@/services/purchase.service';

export type SupplierRecord = {
  id: string;
  name: string;
  gstin: string;
  email: string;
  phone?: string;
  contactPerson?: string;
  paymentTermsLabel: string;
  lastOrderedAt?: number;
  lastOrderTotal?: number;
};

export const PAYMENT_TERM_OPTIONS = [
  { value: 'due_on_receipt', label: 'Due on receipt' },
  { value: 'net_7', label: 'Net 7' },
  { value: 'net_15', label: 'Net 15' },
  { value: 'net_30', label: 'Net 30' },
  { value: 'net_45', label: 'Net 45' },
  { value: 'net_60', label: 'Net 60' },
  { value: 'advance', label: 'Advance' },
];

export function paymentTermsToLabel(value?: string): string {
  if (!value?.trim()) return 'Net 30';
  return PAYMENT_TERM_OPTIONS.find((o) => o.value === value)?.label || value;
}

export function paymentLabelToValue(label?: string): string {
  if (!label?.trim()) return 'net_30';
  const hit = PAYMENT_TERM_OPTIONS.find((o) => o.label === label);
  return hit?.value || 'net_30';
}

export function masterToSupplierRecord(m: PurchaseSupplierMaster): SupplierRecord {
  return {
    id: m.supplierCode,
    name: m.name,
    gstin: m.gstin?.trim() || '—',
    email: m.email?.trim() || '',
    phone: m.phone?.trim(),
    contactPerson: m.contactPerson?.trim(),
    paymentTermsLabel: paymentTermsToLabel(m.paymentTerms),
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

export type PurchaseOrderTotals = {
  subtotal: number;
  totalDiscount: number;
  totalTax: number;
  linesSum: number;
  freight: number;
  grandTotal: number;
};

export function computePurchaseOrderTotals(
  order: Pick<PurchaseOrder, 'lines' | 'shippingFreight'>
): PurchaseOrderTotals {
  let subtotal = 0;
  let totalDiscount = 0;
  let totalTax = 0;
  let linesSum = 0;
  for (const line of order.lines) {
    const { gross, discountAmt, taxAmt, lineTotal } = lineMath(
      line.quantityOrdered,
      line.expectedPrice ?? 0,
      line.taxPercent ?? 0,
      line.discountPercent ?? 0
    );
    subtotal += gross;
    totalDiscount += discountAmt;
    totalTax += taxAmt;
    linesSum += lineTotal;
  }
  const freight = Math.max(0, Number(order.shippingFreight) || 0);
  return { subtotal, totalDiscount, totalTax, linesSum, freight, grandTotal: linesSum + freight };
}

export function purchaseOrderGrandTotal(order: PurchaseOrder): number {
  return computePurchaseOrderTotals(order).grandTotal;
}

export function pendingPurchaseOrderValue(order: PurchaseOrder): number {
  let pending = 0;
  for (const line of order.lines) {
    const pendingQty = Math.max(0, Number(line.pendingQty) || 0);
    if (pendingQty <= 0) continue;
    const { lineTotal } = lineMath(
      line.quantityOrdered,
      line.expectedPrice ?? 0,
      line.taxPercent ?? 0,
      line.discountPercent ?? 0
    );
    const ordered = Math.max(0, Number(line.quantityOrdered) || 0);
    pending += ordered > 0 ? (lineTotal / ordered) * pendingQty : 0;
  }
  return pending;
}

export function formatInr(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(v);
}

/** @deprecated Prefer master-backed supplierCode from API. Kept for legacy free-text fallback. */
export function resolveSupplierIdFromName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  let h = 0;
  for (let i = 0; i < trimmed.length; i += 1) {
    h = (Math.imul(31, h) + trimmed.charCodeAt(i)) | 0;
  }
  return `sup-${Math.abs(h)}`;
}

export function supplierRecordToSnapshot(
  record: SupplierRecord | undefined,
  orderPaymentTerms: string,
  emailOverride?: string
): PurchaseOrderSupplierContact {
  const termsLabel =
    record?.paymentTermsLabel ||
    PAYMENT_TERM_OPTIONS.find((o) => o.value === orderPaymentTerms)?.label ||
    orderPaymentTerms ||
    'Net 30';
  const name = record?.name?.trim() || '';
  return {
    contactPerson: record?.contactPerson?.trim() || (name ? `Accounts — ${name}`.slice(0, 200) : '—'),
    phone: record?.phone?.trim() || '—',
    email: emailOverride?.trim() || record?.email?.trim() || '—',
    gstin: record?.gstin?.trim() && record.gstin !== '—' ? record.gstin : '—',
    defaultPaymentTerms: termsLabel,
    outstandingDues: 0,
  };
}

export function buildSupplierSnapshot(
  supplierId: string,
  supplierName: string,
  orderPaymentTerms: string,
  emailOverride?: string,
  record?: SupplierRecord
): PurchaseOrderSupplierContact {
  if (!supplierId.trim()) {
    return supplierRecordToSnapshot(undefined, orderPaymentTerms, emailOverride);
  }
  if (record && record.id === supplierId.trim()) {
    return supplierRecordToSnapshot(record, orderPaymentTerms, emailOverride);
  }
  return supplierRecordToSnapshot(
    record || {
      id: supplierId,
      name: supplierName,
      gstin: '—',
      email: '',
      paymentTermsLabel: paymentTermsToLabel(orderPaymentTerms),
    },
    orderPaymentTerms,
    emailOverride
  );
}

export function buildSupplierDirectory(
  masterRecords: SupplierRecord[],
  orderRows: PurchaseOrder[]
): SupplierRecord[] {
  const map = new Map<string, SupplierRecord>();
  for (const s of masterRecords) map.set(s.id, { ...s });

  for (const o of orderRows) {
    const id = o.supplierId;
    const name = o.supplierName || id;
    const snap = o.supplierContactSnapshot;
    const existing = map.get(id);
    const ts = new Date(o.orderDate).getTime();
    const total =
      o.lines.reduce((sum, l) => {
        const { lineTotal } = lineMath(
          l.quantityOrdered,
          l.expectedPrice ?? 0,
          l.taxPercent ?? 0,
          l.discountPercent ?? 0
        );
        return sum + lineTotal;
      }, 0) + (o.shippingFreight ?? 0);

    if (!existing) {
      map.set(id, {
        id,
        name,
        gstin: snap?.gstin && snap.gstin !== '—' ? snap.gstin : '—',
        email: snap?.email && snap.email !== '—' ? snap.email : '',
        phone: snap?.phone && snap.phone !== '—' ? snap.phone : undefined,
        contactPerson: snap?.contactPerson,
        paymentTermsLabel: snap?.defaultPaymentTerms || 'Net 30',
        lastOrderedAt: ts,
        lastOrderTotal: total,
      });
    } else {
      if (!existing.lastOrderedAt || ts > existing.lastOrderedAt) {
        existing.lastOrderedAt = ts;
        existing.lastOrderTotal = total;
      }
      if (snap?.gstin && snap.gstin !== '—') existing.gstin = snap.gstin;
      if (snap?.email && snap.email !== '—') existing.email = snap.email;
      if (snap?.phone && snap.phone !== '—') existing.phone = snap.phone;
      if (snap?.contactPerson) existing.contactPerson = snap.contactPerson;
      if (snap?.defaultPaymentTerms) existing.paymentTermsLabel = snap.defaultPaymentTerms;
      if (name) existing.name = name;
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function filterSuppliers(list: SupplierRecord[], query: string): SupplierRecord[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q) ||
      s.gstin.toLowerCase().includes(q)
  );
}

const savedSuppliersKey = (branchId: string) => `purchase-suppliers-${branchId}`;

function normalizeSupplierRecord(raw: unknown): SupplierRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!id || !name) return null;
  return {
    id,
    name,
    gstin: typeof r.gstin === 'string' && r.gstin.trim() ? r.gstin.trim() : '—',
    email: typeof r.email === 'string' ? r.email.trim() : '',
    paymentTermsLabel:
      typeof r.paymentTermsLabel === 'string' && r.paymentTermsLabel.trim()
        ? r.paymentTermsLabel.trim()
        : 'Net 30',
    lastOrderedAt: typeof r.lastOrderedAt === 'number' ? r.lastOrderedAt : undefined,
    lastOrderTotal: typeof r.lastOrderTotal === 'number' ? r.lastOrderTotal : undefined,
  };
}

/** @deprecated Migrated to server master on first catalog load. */
export function listSavedSuppliers(branchId: string): SupplierRecord[] {
  if (!branchId.trim()) return [];
  try {
    const raw = localStorage.getItem(savedSuppliersKey(branchId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeSupplierRecord).filter((s): s is SupplierRecord => Boolean(s));
  } catch {
    return [];
  }
}

export function exportsSavedSuppliersForSync(branchId: string): SupplierMasterImportInput[] {
  return listSavedSuppliers(branchId).map((s) => ({
    id: s.id,
    name: s.name,
    gstin: s.gstin !== '—' ? s.gstin : undefined,
    email: s.email || undefined,
    paymentTermsLabel: s.paymentTermsLabel,
  }));
}

export function clearSavedSuppliersLocal(branchId: string): void {
  if (!branchId.trim()) return;
  try {
    localStorage.removeItem(savedSuppliersKey(branchId));
  } catch {
    /* ignore */
  }
}

/** @deprecated Use purchaseService.upsertSupplierMaster */
export function upsertSavedSupplier(branchId: string, record: SupplierRecord): void {
  if (!branchId.trim() || !record.id.trim() || !record.name.trim()) return;
  const list = listSavedSuppliers(branchId);
  const next = list.filter((s) => s.id !== record.id);
  next.push(record);
  next.sort((a, b) => a.name.localeCompare(b.name));
  localStorage.setItem(savedSuppliersKey(branchId), JSON.stringify(next));
}

export function mergeSupplierRecords(...lists: SupplierRecord[][]): SupplierRecord[] {
  const map = new Map<string, SupplierRecord>();
  for (const list of lists) {
    for (const s of list) {
      const prev = map.get(s.id);
      map.set(s.id, prev ? { ...prev, ...s, name: s.name || prev.name } : s);
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function defaultExpectedDeliveryYmd(from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + 7);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
