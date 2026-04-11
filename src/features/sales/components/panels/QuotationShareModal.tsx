import React, { useCallback, useEffect, useState } from 'react';
import type { SalesQuotation, QuotationShareLinkData, SalesQuotationLine } from '@/services/sales.service';
import { quotationLineGrossInr } from '@/features/sales/utils/mapLinesForCreateOrder';
import { SalesLineMeta } from '../shared/SalesLineMeta';
import './QuotationShareFlow.css';

function formatInr(n: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatValidUntil(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function openExternal(href: string) {
  window.open(href, '_blank', 'noopener,noreferrer');
}

function normalizeWhatsAppDigits(phone: string | undefined): string | undefined {
  if (!phone?.trim()) return undefined;
  const d = phone.replace(/\D/g, '');
  if (d.length < 10) return undefined;
  if (d.length === 10) return `91${d}`;
  return d;
}

function shareBody(q: SalesQuotation, customerName: string, pdfUrl?: string): string {
  const total = formatInr(q.total);
  const valid = q.validUntil ? formatValidUntil(q.validUntil) : 'as discussed';
  let s = `Hi ${customerName},\n\nQuotation ${q.quoteNumber} — Total ${total}. Valid: ${valid}.\n\nThank you.`;
  if (pdfUrl) s += `\n\nOpen PDF: ${pdfUrl}`;
  return s;
}

function whatsappHref(message: string, phoneDigits: string | undefined): string {
  const enc = encodeURIComponent(message);
  if (phoneDigits) return `https://wa.me/${phoneDigits}?text=${enc}`;
  return `https://api.whatsapp.com/send?text=${enc}`;
}

export type QuotationShareLinkState = {
  loading: boolean;
  error: string | null;
  data: QuotationShareLinkData | null;
};

export interface QuotationShareModalProps {
  isOpen: boolean;
  quotation: SalesQuotation | null;
  customerName: string;
  customerPhone?: string;
  shareLink: QuotationShareLinkState;
  pdfWarning?: string | null;
  printLoading?: boolean;
  onClose: () => void;
  onSelectPrint: () => void;
}

export function QuotationShareModal({
  isOpen,
  quotation,
  customerName,
  customerPhone,
  shareLink,
  pdfWarning,
  printLoading,
  onClose,
  onSelectPrint,
}: QuotationShareModalProps) {
  const [copyDone, setCopyDone] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const onCopyLink = useCallback(async () => {
    const url = shareLink.data?.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopyDone(true);
      window.setTimeout(() => setCopyDone(false), 2000);
    } catch {
      /* ignore */
    }
  }, [shareLink.data?.url]);

  if (!isOpen || !quotation) return null;

  const q = quotation;
  const pdfUrl = shareLink.data?.url;
  const msg = shareBody(q, customerName, pdfUrl);
  const waDigits = normalizeWhatsAppDigits(customerPhone);
  const waHref = whatsappHref(msg, waDigits);
  const mailHref = `mailto:?subject=${encodeURIComponent(`Quotation ${q.quoteNumber}`)}&body=${encodeURIComponent(msg)}`;

  return (
    <div className="qsf-overlay" role="dialog" aria-modal="true" aria-labelledby="qsf-success-title">
      <div className="qsf-share-card">
        <div className="qsf-banner">
          <div className="qsf-banner__icon" aria-hidden>
            ✓
          </div>
          <div className="qsf-banner__text">
            <h2 id="qsf-success-title" className="qsf-banner__title">
              Quotation created successfully
            </h2>
            <p className="qsf-banner__sub">
              <strong>{q.quoteNumber}</strong> is ready to share with your customer.
            </p>
          </div>
          <button type="button" className="qsf-banner__close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="qsf-body">
          {pdfWarning ? <p className="qsf-warning">{pdfWarning}</p> : null}
          {shareLink.loading ? <p className="qsf-warning">Preparing share link…</p> : null}
          {shareLink.error ? <p className="qsf-warning">{shareLink.error}</p> : null}
          {shareLink.data?.note ? <p className="qsf-share-note">{shareLink.data.note}</p> : null}
          {shareLink.data?.expiresAt ? (
            <p className="qsf-share-expiry">
              Link valid until{' '}
              {new Date(shareLink.data.expiresAt).toLocaleString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          ) : null}

          <div className="qsf-info">
            <div className="qsf-info__left">
              <strong>{q.quoteNumber}</strong>
              <p className="qsf-info__meta">
                {customerName}
                <br />
                {q.lines.length} line{q.lines.length === 1 ? '' : 's'}
              </p>
            </div>
            <div className="qsf-info__right">
              <span className="qsf-info__total">{formatInr(q.total)}</span>
              <p className="qsf-info__valid">Valid until {formatValidUntil(q.validUntil)}</p>
            </div>
          </div>

          {q.lines?.length ? (
            <div className="qsf-lines" aria-label="Quotation line items">
              <p className="qsf-lines__title">Line items</p>
              <ul className="qsf-lines__list">
                {q.lines.map((ln, i) => {
                  const l = ln as SalesQuotationLine;
                  const qty = Number(l.quantity ?? 0);
                  const taxableLine = Number(l.lineTotal ?? 0);
                  const eff =
                    qty > 0 ? Math.round((taxableLine / qty) * 10000) / 10000 : l.unitPrice;
                  const lineGross = quotationLineGrossInr(l);
                  return (
                    <li key={i} className="qsf-lines__item">
                      <div className="qsf-lines__row">
                        <span className="qsf-lines__name">
                          {l.variantName || 'Item'}
                          <span className="qsf-lines__code">{l.variantCode ? ` · ${l.variantCode}` : ''}</span>
                        </span>
                        <span className="qsf-lines__amt">
                          {formatInr(lineGross)} × {qty}
                        </span>
                      </div>
                      <SalesLineMeta
                        line={
                          {
                            ...l,
                            posListUnitPrice: l.unitPrice,
                            unitPrice: eff,
                            posGstInclusive: l.priceIncludesGst === false ? false : undefined,
                            posGstRatePercent: l.taxRatePercent,
                            posLineDiscountAmount: l.discountAmount,
                            posLineNotes: l.lineNotes,
                            posHsn: l.hsn,
                          } as Record<string, unknown>
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <p className="qsf-share-label">Share quotation</p>
          <div className="qsf-share-grid">
            <button type="button" className="qsf-share-tile" onClick={() => openExternal(waHref)}>
              <span className="qsf-share-tile__circle" aria-hidden>
                ◆
              </span>
              <span className="qsf-share-tile__label">WhatsApp</span>
              <p className="qsf-share-tile__desc">
                {waDigits ? 'Open chat with this customer' : 'Pre-filled message (pick contact in WhatsApp)'}
              </p>
            </button>
            <button
              type="button"
              className="qsf-share-tile qsf-share-tile--email"
              onClick={() => openExternal(mailHref)}
            >
              <span className="qsf-share-tile__circle" aria-hidden>
                ✉
              </span>
              <span className="qsf-share-tile__label">Email</span>
              <p className="qsf-share-tile__desc">Compose in your default mail app</p>
            </button>
            <button
              type="button"
              className="qsf-share-tile"
              disabled={printLoading}
              onClick={onSelectPrint}
            >
              <span className="qsf-share-tile__circle" aria-hidden>
                ⎙
              </span>
              <span className="qsf-share-tile__label">{printLoading ? 'Opening…' : 'Print'}</span>
              <p className="qsf-share-tile__desc">View PDF and print or save</p>
            </button>
            <button
              type="button"
              className="qsf-share-tile"
              disabled={!shareLink.data?.url}
              onClick={() => void onCopyLink()}
            >
              <span className="qsf-share-tile__circle" aria-hidden>
                ⧉
              </span>
              <span className="qsf-share-tile__label">{copyDone ? 'Copied' : 'Copy link'}</span>
              <p className="qsf-share-tile__desc">Copy PDF share URL to clipboard</p>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
