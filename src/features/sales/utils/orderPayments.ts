/**
 * Display helpers for SalesOrder.payments[] (POS split tender).
 */

export type SalesOrderPaymentAttachment = {
  url: string;
  publicId: string;
  fileName?: string;
};

export type SalesOrderPaymentDetails = {
  cardHolderName?: string;
  last4?: string;
  transactionRef?: string;
  upiId?: string;
  transactionId?: string;
  bankName?: string;
  utr?: string;
  attachment?: SalesOrderPaymentAttachment;
};

export type SalesOrderPaymentLine = {
  methodCode: string;
  amount: number;
  details?: SalesOrderPaymentDetails;
};

export type PaymentMethodLabelSource = Array<{ code: string; label: string }> | undefined;

export type OrderPaymentDisplayStatus =
  | 'on_account'
  | 'unpaid'
  | 'cancelled'
  | 'split'
  | 'single'
  | 'legacy_paid';

const KNOWN_METHOD_CODES = ['cash', 'card', 'upi', 'bank'] as const;
export type KnownPaymentMethodCode = (typeof KNOWN_METHOD_CODES)[number];

export type PaymentMethodFilter = 'all' | KnownPaymentMethodCode | 'on_account' | 'legacy';

export function formatInrAmount(n: number): string {
  return `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function paymentMethodLabel(code: string, methods?: PaymentMethodLabelSource): string {
  const c = String(code || '').trim().toLowerCase();
  const found = methods?.find((m) => String(m.code || '').trim().toLowerCase() === c);
  if (found?.label?.trim()) return found.label.trim();
  if (c === 'cash') return 'Cash';
  if (c === 'card') return 'Card';
  if (c === 'upi') return 'UPI';
  if (c.includes('bank')) return 'Bank';
  if (!c) return '—';
  return c.charAt(0).toUpperCase() + c.slice(1);
}

export function paymentMethodChip(code: string, methods?: PaymentMethodLabelSource): { label: string; cls: string } {
  const c = String(code || '').trim().toLowerCase();
  const label = paymentMethodLabel(code, methods);
  if (c === 'cash') return { label, cls: 'order-pay-chip order-pay-chip--cash' };
  if (c === 'upi') return { label, cls: 'order-pay-chip order-pay-chip--upi' };
  if (c === 'card') return { label, cls: 'order-pay-chip order-pay-chip--card' };
  if (c.includes('bank')) return { label, cls: 'order-pay-chip order-pay-chip--bank' };
  return { label, cls: 'order-pay-chip order-pay-chip--default' };
}

export function normalizeOrderPayments(raw: unknown): SalesOrderPaymentLine[] {
  if (!Array.isArray(raw)) return [];
  const out: SalesOrderPaymentLine[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const methodCode = String(r.methodCode ?? '').trim();
    const amount = Number(r.amount);
    if (!methodCode || !Number.isFinite(amount) || amount <= 0) continue;
    const details = r.details as SalesOrderPaymentDetails | undefined;
    out.push({ methodCode, amount, details: details && typeof details === 'object' ? details : undefined });
  }
  return out;
}

export function formatOrderPayments(
  payments: SalesOrderPaymentLine[] | undefined | null,
  methods?: PaymentMethodLabelSource,
): string {
  if (!payments?.length) return '';
  return payments
    .map((p) => `${paymentMethodLabel(p.methodCode, methods)} ${formatInrAmount(p.amount)}`)
    .join(' · ');
}

export function getPrimaryPaymentMethod(
  payments: SalesOrderPaymentLine[] | undefined | null,
): string | null {
  if (!payments?.length) return null;
  if (payments.length === 1) return payments[0].methodCode;
  const top = [...payments].sort((a, b) => b.amount - a.amount)[0];
  return top?.methodCode ?? null;
}

export function paymentAmountsByKnownMethod(
  payments: SalesOrderPaymentLine[] | undefined | null,
): Record<KnownPaymentMethodCode, number> {
  const out: Record<KnownPaymentMethodCode, number> = { cash: 0, card: 0, upi: 0, bank: 0 };
  for (const p of payments || []) {
    const c = p.methodCode.trim().toLowerCase();
    if (c === 'cash') out.cash += p.amount;
    else if (c === 'card') out.card += p.amount;
    else if (c === 'upi') out.upi += p.amount;
    else if (c === 'bank' || c.includes('bank')) out.bank += p.amount;
  }
  return out;
}

export function resolveOrderPaymentSummary(
  order: {
    status?: string;
    paymentPending?: boolean;
    payments?: SalesOrderPaymentLine[] | unknown;
    total?: number;
  },
  methods?: PaymentMethodLabelSource,
): {
  status: OrderPaymentDisplayStatus;
  summary: string;
  primaryMethod: string | null;
  payments: SalesOrderPaymentLine[];
} {
  const st = String(order.status || '');
  const pend = Boolean(order.paymentPending);
  const payments = normalizeOrderPayments(order.payments);

  if (st === 'cancelled') {
    return { status: 'cancelled', summary: 'Cancelled', primaryMethod: null, payments };
  }
  if (st === 'completed' && pend) {
    return { status: 'on_account', summary: 'On account', primaryMethod: null, payments };
  }
  if (st !== 'completed') {
    return { status: 'unpaid', summary: '—', primaryMethod: null, payments };
  }
  if (payments.length) {
    return {
      status: payments.length > 1 ? 'split' : 'single',
      summary: formatOrderPayments(payments, methods),
      primaryMethod: getPrimaryPaymentMethod(payments),
      payments,
    };
  }
  return { status: 'legacy_paid', summary: 'Paid', primaryMethod: null, payments };
}

export function orderMatchesPaymentMethodFilter(
  row: {
    status?: string;
    paymentPending?: boolean;
    payments?: SalesOrderPaymentLine[] | unknown;
  },
  filter: PaymentMethodFilter,
): boolean {
  if (filter === 'all') return true;
  const st = String(row.status || '');
  const payments = normalizeOrderPayments(row.payments);
  if (filter === 'on_account') return st === 'completed' && Boolean(row.paymentPending);
  if (filter === 'legacy') return st === 'completed' && !row.paymentPending && payments.length === 0;
  if (!payments.length) return false;
  return payments.some((p) => {
    const c = p.methodCode.trim().toLowerCase();
    if (filter === 'bank') return c === 'bank' || c.includes('bank');
    return c === filter;
  });
}

export function formatPaymentDetailLines(
  methodCode: string,
  details?: SalesOrderPaymentDetails,
): string[] {
  if (!details) return [];
  const c = methodCode.trim().toLowerCase();
  const lines: string[] = [];
  if (c === 'card' || details.last4 || details.transactionRef || details.cardHolderName) {
    if (details.cardHolderName?.trim()) lines.push(`Holder: ${details.cardHolderName.trim()}`);
    if (details.last4?.trim()) lines.push(`Card •••• ${details.last4.trim()}`);
    if (details.transactionRef?.trim()) lines.push(`Ref: ${details.transactionRef.trim()}`);
  }
  if (c === 'upi' || details.upiId || details.transactionId) {
    if (details.upiId?.trim()) lines.push(`UPI: ${details.upiId.trim()}`);
    if (details.transactionId?.trim()) lines.push(`Txn: ${details.transactionId.trim()}`);
  }
  if (c.includes('bank') || details.bankName || details.utr) {
    if (details.bankName?.trim()) lines.push(`Bank: ${details.bankName.trim()}`);
    if (details.utr?.trim()) lines.push(`UTR: ${details.utr.trim()}`);
  }
  if (!lines.length && details.transactionRef?.trim()) lines.push(`Ref: ${details.transactionRef.trim()}`);
  return lines;
}
