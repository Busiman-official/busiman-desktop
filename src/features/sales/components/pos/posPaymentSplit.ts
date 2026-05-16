/**
 * POS split-payment helpers: cash remainder, validation, checkout payload.
 */

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

export function supportsPaymentDetailsModal(code: string): boolean {
  return !isCashMethodCode(code);
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
    if (!isCashMethodCode(p.value)) out[p.value] = '';
  }
  return out;
}

/** Non-cash amounts keyed by method code (numbers). */
export function nonCashAmountsFromInputs(
  payOpts: PosPaymentOption[],
  inputs: Record<string, string>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of payOpts) {
    if (isCashMethodCode(p.value)) continue;
    out[p.value] = parsePaymentAmountInput(inputs[p.value] ?? '');
  }
  return out;
}

export function sumNonCashAmounts(nonCash: Record<string, number>): number {
  return roundMoney(Object.values(nonCash).reduce((s, n) => s + n, 0));
}

export function computeCashRemainder(total: number, nonCash: Record<string, number>): number {
  return roundMoney(Math.max(0, total - sumNonCashAmounts(nonCash)));
}

export function maxNonCashForMethod(
  total: number,
  methodCode: string,
  nonCash: Record<string, number>,
): number {
  const others = sumNonCashAmounts(
    Object.fromEntries(Object.entries(nonCash).filter(([k]) => k !== methodCode)),
  );
  return roundMoney(Math.max(0, total - others));
}

export function isSplitPaymentBalanced(total: number, nonCash: Record<string, number>): boolean {
  const cash = computeCashRemainder(total, nonCash);
  return roundMoney(sumNonCashAmounts(nonCash) + cash) === roundMoney(total) && cash >= 0;
}

export function buildCheckoutPayments(
  payOpts: PosPaymentOption[],
  total: number,
  nonCashInputs: Record<string, string>,
  detailsByMethod: Record<string, PosPaymentMethodDetails | undefined>,
): PosCheckoutPaymentLine[] {
  const orderTotal = roundMoney(total);
  const nonCash = nonCashAmountsFromInputs(payOpts, nonCashInputs);
  const cashAmount = computeCashRemainder(orderTotal, nonCash);
  const lines: PosCheckoutPaymentLine[] = [];
  for (const p of payOpts) {
    const amount = isCashMethodCode(p.value) ? cashAmount : nonCash[p.value] ?? 0;
    if (amount <= 0) continue;
    const details = detailsByMethod[p.value];
    lines.push({
      methodCode: p.value,
      amount,
      ...(details && Object.keys(details).length > 0 ? { details } : {}),
    });
  }
  // No cash method in settings (or all lines zero): implicit full tender on primary method.
  if (!lines.length && orderTotal > 0) {
    const fallback =
      payOpts.find((p) => isCashMethodCode(p.value)) ?? payOpts[0] ?? { value: 'cash', label: 'Cash' };
    const details = detailsByMethod[fallback.value];
    lines.push({
      methodCode: fallback.value,
      amount: orderTotal,
      ...(details && Object.keys(details).length > 0 ? { details } : {}),
    });
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
