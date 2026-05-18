/**
 * POS split-payment helpers: cash remainder, validation, checkout payload.
 */

export const ON_ACCOUNT_METHOD = 'on_account';

export type PosPaymentOption = { value: string; label: string };

export type PosPaymentAttachment = {
  url: string;
  publicId: string;
  fileName?: string;
};

export type PosPaymentMethodDetails = {
  cardHolderName?: string;
  last4?: string;
  transactionRef?: string;
  upiId?: string;
  transactionId?: string;
  bankName?: string;
  utr?: string;
  attachment?: PosPaymentAttachment;
};

export type PosCheckoutPaymentLine = {
  methodCode: string;
  amount: number;
  details?: PosPaymentMethodDetails;
};

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function isCashMethodCode(code: string): boolean {
  return code.trim().toLowerCase() === 'cash';
}

export function isOnAccountMethodCode(code: string): boolean {
  return code.trim().toLowerCase() === ON_ACCOUNT_METHOD;
}

export function supportsPaymentDetailsModal(code: string): boolean {
  return !isCashMethodCode(code) && !isOnAccountMethodCode(code);
}

export function parsePaymentAmountInput(raw: string): number {
  const t = raw.trim();
  if (!t) return 0;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return 0;
  return roundMoney(n);
}

export function emptyNonCashAmounts(payOpts: PosPaymentOption[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of payOpts) {
    if (!isCashMethodCode(p.value) && !isOnAccountMethodCode(p.value)) out[p.value] = '';
  }
  return out;
}

/** Non-cash tender amounts keyed by method code (excludes on_account). */
export function nonCashAmountsFromInputs(
  payOpts: PosPaymentOption[],
  inputs: Record<string, string>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of payOpts) {
    if (isCashMethodCode(p.value) || isOnAccountMethodCode(p.value)) continue;
    out[p.value] = parsePaymentAmountInput(inputs[p.value] ?? '');
  }
  return out;
}

export function getOnAccountAmountInput(onAccountInput: string): number {
  return parsePaymentAmountInput(onAccountInput);
}

export function sumNonCashAmounts(nonCash: Record<string, number>): number {
  return roundMoney(Object.values(nonCash).reduce((s, n) => s + n, 0));
}

export function computeCashRemainder(
  total: number,
  nonCash: Record<string, number>,
  onAccountAmount = 0,
): number {
  return roundMoney(Math.max(0, total - sumNonCashAmounts(nonCash) - roundMoney(onAccountAmount)));
}

/** @deprecated Use computeCashRemainder with onAccountAmount */
export function computeCashRemainderLegacy(total: number, nonCash: Record<string, number>): number {
  return computeCashRemainder(total, nonCash, 0);
}

export function maxNonCashForMethod(
  total: number,
  methodCode: string,
  nonCash: Record<string, number>,
  onAccountAmount = 0,
): number {
  const others = sumNonCashAmounts(
    Object.fromEntries(Object.entries(nonCash).filter(([k]) => k !== methodCode)),
  );
  return roundMoney(Math.max(0, total - others - roundMoney(onAccountAmount)));
}

export function sumCollectedTender(
  total: number,
  nonCash: Record<string, number>,
  onAccountAmount: number,
): number {
  const cash = computeCashRemainder(total, nonCash, onAccountAmount);
  return roundMoney(sumNonCashAmounts(nonCash) + cash);
}

export function isCheckoutBalanced(
  total: number,
  nonCash: Record<string, number>,
  onAccountAmount: number,
): boolean {
  const orderTotal = roundMoney(total);
  const onAccount = roundMoney(onAccountAmount);
  const collected = sumCollectedTender(orderTotal, nonCash, onAccount);
  return roundMoney(collected + onAccount) === orderTotal && onAccount >= 0 && collected >= 0;
}

/** @deprecated Use isCheckoutBalanced */
export function isSplitPaymentBalanced(total: number, nonCash: Record<string, number>): boolean {
  return isCheckoutBalanced(total, nonCash, 0);
}

export function checkoutUnallocated(
  total: number,
  nonCash: Record<string, number>,
  onAccountAmount: number,
): number {
  const orderTotal = roundMoney(total);
  const allocated = roundMoney(sumCollectedTender(orderTotal, nonCash, onAccountAmount) + roundMoney(onAccountAmount));
  return roundMoney(orderTotal - allocated);
}

export function isCheckoutOverAllocated(
  total: number,
  nonCash: Record<string, number>,
  onAccountAmount: number,
): boolean {
  return checkoutUnallocated(total, nonCash, onAccountAmount) < -0.0001;
}

export function buildCheckoutPayments(
  payOpts: PosPaymentOption[],
  total: number,
  nonCashInputs: Record<string, string>,
  detailsByMethod: Record<string, PosPaymentMethodDetails | undefined>,
  onAccountAmount = 0,
): PosCheckoutPaymentLine[] {
  const orderTotal = roundMoney(total);
  if (orderTotal === 0) return [];
  const onAccount = roundMoney(onAccountAmount);
  const nonCash = nonCashAmountsFromInputs(payOpts, nonCashInputs);
  const cashAmount = computeCashRemainder(orderTotal, nonCash, onAccount);
  const lines: PosCheckoutPaymentLine[] = [];
  for (const p of payOpts) {
    if (isOnAccountMethodCode(p.value)) continue;
    const amount = isCashMethodCode(p.value) ? cashAmount : nonCash[p.value] ?? 0;
    if (amount <= 0) continue;
    const details = detailsByMethod[p.value];
    lines.push({
      methodCode: p.value,
      amount,
      ...(details && Object.keys(details).length > 0 ? { details } : {}),
    });
  }
  // No cash method in settings (or all lines zero): implicit full tender on primary method when no on-account.
  if (!lines.length && orderTotal > 0 && onAccount <= 0) {
    const fallback =
      payOpts.find((p) => isCashMethodCode(p.value)) ?? payOpts[0] ?? { value: 'cash', label: 'Cash' };
    if (!isOnAccountMethodCode(fallback.value)) {
      const details = detailsByMethod[fallback.value];
      lines.push({
        methodCode: fallback.value,
        amount: orderTotal,
        ...(details && Object.keys(details).length > 0 ? { details } : {}),
      });
    }
  }
  return lines;
}

export function paymentDetailsFilled(d?: PosPaymentMethodDetails): boolean {
  if (!d) return false;
  if (d.cardHolderName?.trim()) return true;
  if (d.last4?.trim()) return true;
  if (d.transactionRef?.trim()) return true;
  if (d.upiId?.trim()) return true;
  if (d.transactionId?.trim()) return true;
  if (d.bankName?.trim()) return true;
  if (d.utr?.trim()) return true;
  if (d.attachment?.url) return true;
  return false;
}
