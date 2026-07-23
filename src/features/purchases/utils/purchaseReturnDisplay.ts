/**
 * Purchase return display helpers — labels, chips and list filters.
 */

import type {
  PurchaseReturn,
  PurchaseReturnLineReason,
  PurchaseReturnSettlementType,
  PurchaseReturnStatus,
} from '@/services/purchase.service';

export interface PurchaseReturnListFilters {
  search: string;
  status: PurchaseReturnStatus | '';
  settlementType: PurchaseReturnSettlementType | '';
  pendingSettlementOnly: boolean;
}

export const EMPTY_RETURN_LIST_FILTERS: PurchaseReturnListFilters = {
  search: '',
  status: '',
  settlementType: '',
  pendingSettlementOnly: false,
};

export function hasActiveReturnFilters(f: PurchaseReturnListFilters): boolean {
  return Boolean(f.search || f.status || f.settlementType || f.pendingSettlementOnly);
}

/** Filters shown in the side drawer (excludes search). */
export function countReturnModalFilters(f: PurchaseReturnListFilters): number {
  let n = 0;
  if (f.status) n += 1;
  if (f.settlementType) n += 1;
  if (f.pendingSettlementOnly) n += 1;
  return n;
}

export const RETURN_REASONS: { key: PurchaseReturnLineReason; label: string }[] = [
  { key: 'damaged', label: 'Damaged / broken' },
  { key: 'wrong_item', label: 'Wrong item sent' },
  { key: 'quality_issue', label: 'Quality issue' },
  { key: 'expired', label: 'Expired / near expiry' },
  { key: 'excess', label: 'Excess / over-supplied' },
  { key: 'other', label: 'Other' },
];

export const SETTLEMENT_OPTIONS: {
  key: PurchaseReturnSettlementType;
  label: string;
  hint: string;
}[] = [
  { key: 'credit', label: 'Adjust against bill', hint: 'Reduce the unpaid balance of the original bill' },
  { key: 'refund', label: 'Cash refund', hint: 'Supplier pays the money back to you' },
  { key: 'replacement', label: 'Replacement', hint: 'Supplier sends fresh goods (receive them as a new receipt)' },
  { key: 'write_off', label: 'Write-off', hint: 'No recovery — record the loss and move on' },
];

export function returnStatusLabel(status: PurchaseReturnStatus): string {
  if (status === 'draft') return 'Draft';
  if (status === 'cancelled') return 'Cancelled';
  return 'Completed';
}

export function returnStatusClass(status: PurchaseReturnStatus): string {
  if (status === 'draft') return 'po-list__status-chip--po-only';
  if (status === 'cancelled') return 'po-list__status-chip--pending';
  return 'po-list__status-chip--clear';
}

export function settlementLabel(type: PurchaseReturnSettlementType): string {
  return SETTLEMENT_OPTIONS.find((s) => s.key === type)?.label ?? type;
}

export function reasonLabel(key: PurchaseReturnLineReason): string {
  return RETURN_REASONS.find((r) => r.key === key)?.label ?? key;
}

/** What still needs follow-up from the supplier on a completed return. */
export function settlementFollowUp(ret: PurchaseReturn): string | null {
  if (ret.status !== 'completed') return null;
  if (ret.settlementType === 'credit' && !ret.supplierDebitNoteNumber) return 'Awaiting debit note';
  if (ret.refundDue > ret.refundReceived) return 'Refund pending';
  if (ret.settlementType === 'replacement' && !ret.replacementReceived) return 'Replacement pending';
  return null;
}

export function formatReturnDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
