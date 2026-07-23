import type { PosCartLine } from '@/features/sales/components/pos/usePosCart';
import type { PosCheckoutPaymentLine, PosPaymentMethodDetails } from '@/features/sales/components/pos/posPaymentSplit';

export interface ReceiptHeldDraft {
  id: string;
  savedAt: number;
  freightInput: string;
  purchaseOrderId?: string;
  lines: PosCartLine[];
  nonCashAmountInputs?: Record<string, string>;
  onCreditInput?: string;
  paymentDetailsByMethod?: Record<string, PosPaymentMethodDetails>;
}

const heldKey = (branchId: string, locationId: string) =>
  `purchase-receipt-held-${branchId}-${locationId}`;

function normalizeHeldDraft(raw: unknown): ReceiptHeldDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (!Array.isArray(d.lines)) return null;
  const freightInput =
    typeof d.freightInput === 'string'
      ? d.freightInput
      : typeof d.discountInput === 'string'
        ? d.discountInput
        : '0';
  return {
    id: String(d.id || ''),
    savedAt: Number(d.savedAt) || Date.now(),
    freightInput,
    purchaseOrderId: typeof d.purchaseOrderId === 'string' ? d.purchaseOrderId : undefined,
    lines: d.lines as PosCartLine[],
    nonCashAmountInputs:
      d.nonCashAmountInputs && typeof d.nonCashAmountInputs === 'object'
        ? (d.nonCashAmountInputs as Record<string, string>)
        : undefined,
    onCreditInput: typeof d.onCreditInput === 'string' ? d.onCreditInput : undefined,
    paymentDetailsByMethod:
      d.paymentDetailsByMethod && typeof d.paymentDetailsByMethod === 'object'
        ? (d.paymentDetailsByMethod as Record<string, PosPaymentMethodDetails>)
        : undefined,
  };
}

export function listHeldReceiptDrafts(branchId: string, locationId: string): ReceiptHeldDraft[] {
  try {
    const raw = localStorage.getItem(heldKey(branchId, locationId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeHeldDraft).filter((d): d is ReceiptHeldDraft => Boolean(d?.id));
  } catch {
    return [];
  }
}

export function holdReceiptDraft(
  branchId: string,
  locationId: string,
  payload: Omit<ReceiptHeldDraft, 'id' | 'savedAt'>
): ReceiptHeldDraft {
  const draft: ReceiptHeldDraft = {
    id: `hr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: Date.now(),
    ...payload,
  };
  const list = [draft, ...listHeldReceiptDrafts(branchId, locationId)].slice(0, 12);
  localStorage.setItem(heldKey(branchId, locationId), JSON.stringify(list));
  return draft;
}

export function discardHeldReceiptDraft(branchId: string, locationId: string, id: string): void {
  const next = listHeldReceiptDrafts(branchId, locationId).filter((d) => d.id !== id);
  localStorage.setItem(heldKey(branchId, locationId), JSON.stringify(next));
}

export function clearHeldReceiptDrafts(branchId: string, locationId: string): void {
  localStorage.removeItem(heldKey(branchId, locationId));
}

export type { PosCheckoutPaymentLine };
