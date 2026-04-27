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
