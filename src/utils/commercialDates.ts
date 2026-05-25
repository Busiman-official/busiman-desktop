/** UTC calendar day YYYY-MM-DD from invoiceDate (for date inputs). */
export function invoiceDateToYmd(invoiceDate: unknown): string {
  if (invoiceDate == null || invoiceDate === '') return '';
  const t = new Date(String(invoiceDate)).getTime();
  if (!Number.isFinite(t)) return '';
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Format a business calendar date (invoiceDate, paidAt from YYYY-MM-DD) without showing a bogus
 * local time (UTC midnight becomes 5:30 AM in IST if formatted with timeStyle).
 */
export function formatCommercialCalendarDate(
  value: unknown,
  locale = 'en-IN',
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }
): string {
  const ymd = invoiceDateToYmd(value);
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return '—';
  return new Date(y, m - 1, d).toLocaleDateString(locale, options);
}

/** Business sale / invoice instant for an order (invoiceDate ?? legacy createdAt). */
export function orderSaleTimestampMs(row: { invoiceDate?: unknown; createdAt?: unknown }): number {
  const inv = row.invoiceDate;
  if (inv != null && inv !== '') {
    const t = new Date(String(inv)).getTime();
    if (Number.isFinite(t)) return t;
  }
  const c = row.createdAt;
  if (c != null && c !== '') {
    const t = new Date(String(c)).getTime();
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

/** ISO string used for sorting/display: movement business date ?? system createdAt. */
export function movementTransactionIso(m: { postingDate?: unknown; createdAt: string }): string {
  if (m.postingDate != null && String(m.postingDate).trim() !== '') return String(m.postingDate);
  return m.createdAt;
}
