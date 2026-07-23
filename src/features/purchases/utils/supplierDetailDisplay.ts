import type { PurchaseSupplierDetail, SupplierPayableStatus } from '@/services/purchase.service';
import { formatInr } from './supplierDirectory';

export type SupplierKpiTone = 'ok' | 'bad' | 'amber' | 'red' | 'neutral';

export type SupplierKpiCard = {
  id: string;
  label: string;
  value: string;
  subtext: string;
  toneClass?: string;
};

export function daysSinceReceiptLabel(iso?: string | null): { text: string; tone: SupplierKpiTone } {
  if (!iso) return { text: 'No receipts yet', tone: 'neutral' };
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 0) return { text: 'Today', tone: 'ok' };
  const text = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
  if (days > 90) return { text, tone: 'red' };
  if (days > 45) return { text, tone: 'amber' };
  return { text, tone: 'ok' };
}

export function payableStatusBadge(status: SupplierPayableStatus): {
  label: string;
  variant: 'success' | 'warning' | 'neutral';
} {
  if (status === 'pending') return { label: 'Payments pending', variant: 'warning' };
  if (status === 'clear') return { label: 'All clear', variant: 'success' };
  return { label: 'PO only', variant: 'neutral' };
}

function lastReceiptToneClass(tone: SupplierKpiTone): string | undefined {
  if (tone === 'amber') return 'sd-kpi--last-amber';
  if (tone === 'red') return 'sd-kpi--last-red';
  return undefined;
}

export function computeSupplierKpis(detail: PurchaseSupplierDetail): SupplierKpiCard[] {
  const billCount = detail.bills.length;
  const avgBill = billCount > 0 ? detail.totalBilled / billCount : 0;
  const lastMeta = daysSinceReceiptLabel(detail.lastReceiptDate);
  const lastDate = detail.lastReceiptDate
    ? new Date(detail.lastReceiptDate).toLocaleDateString('en-IN')
    : '—';

  const outstandingSub =
    detail.outstanding <= 0
      ? 'All clear'
      : `${detail.openBillCount} open bill(s)${
          detail.partiallyPaidBillCount > 0 ? ` · ${detail.partiallyPaidBillCount} partial` : ''
        }`;

  const openPoSub =
    (detail.openPoCount ?? 0) > 0
      ? `${detail.openPoCount} open`
      : 'All received or closed';

  return [
    {
      id: 'total-purchased',
      label: 'Total purchased',
      value: formatInr(detail.totalBilled),
      subtext: `${billCount} bill${billCount === 1 ? '' : 's'}`,
    },
    {
      id: 'purchase-orders',
      label: 'Purchase orders',
      value: String(detail.totalPoCount ?? detail.purchaseOrders?.length ?? 0),
      subtext: openPoSub,
    },
    {
      id: 'outstanding',
      label: 'Outstanding payable',
      value: formatInr(detail.outstanding),
      subtext: outstandingSub,
      toneClass: detail.outstanding <= 0 ? 'sd-kpi--balance-ok' : 'sd-kpi--balance-bad',
    },
    {
      id: 'avg-bill',
      label: 'Average bill value',
      value: formatInr(avgBill),
      subtext: billCount > 0 ? 'Across all bills' : 'No bills yet',
    },
    {
      id: 'last-receipt',
      label: 'Last receipt',
      value: lastMeta.text,
      subtext: lastDate,
      toneClass: lastReceiptToneClass(lastMeta.tone),
    },
  ];
}

export function telHrefFor(phone?: string | null): string | null {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  return `tel:${digits}`;
}

export function mailtoHrefFor(email?: string | null, name?: string | null): string | null {
  const addr = String(email || '').trim();
  if (!addr || !addr.includes('@')) return null;
  const subject = name ? encodeURIComponent(`Regarding ${name}`) : '';
  return subject ? `mailto:${addr}?subject=${subject}` : `mailto:${addr}`;
}

export function openExternalUrl(href: string | null | undefined): void {
  if (!href) return;
  window.open(href, '_blank', 'noopener,noreferrer');
}
