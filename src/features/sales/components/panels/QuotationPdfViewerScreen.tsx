import React, { useCallback, useEffect, useRef } from 'react';
import { Button } from '@/shared/components/ui';
import type { SalesQuotation } from '@/services/sales.service';
import type { QuotationShareLinkState } from './QuotationShareModal';
import './QuotationShareFlow.css';

function formatInr(n: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatValidUntil(iso: string | undefined): string {
  if (!iso) return 'as discussed';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'as discussed';
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
  const valid = formatValidUntil(q.validUntil);
  let s = `Hi ${customerName},\n\nQuotation ${q.quoteNumber} — Total ${total}. Valid: ${valid}.\n\nThank you.`;
  if (pdfUrl) s += `\n\nOpen PDF: ${pdfUrl}`;
  return s;
}

function whatsappHref(message: string, phoneDigits: string | undefined): string {
  const enc = encodeURIComponent(message);
  if (phoneDigits) return `https://wa.me/${phoneDigits}?text=${enc}`;
  return `https://api.whatsapp.com/send?text=${enc}`;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export interface QuotationPdfViewerScreenProps {
  quotation: SalesQuotation;
  customerName: string;
  customerPhone?: string;
  shareLink: QuotationShareLinkState;
  pdfBlobUrl: string;
  pdfBlob: Blob;
  onBack: () => void;
}

export const QuotationPdfViewerScreen: React.FC<QuotationPdfViewerScreenProps> = ({
  quotation,
  customerName,
  customerPhone,
  shareLink,
  pdfBlobUrl,
  pdfBlob,
  onBack,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onBack();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onBack]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    let detachInner: (() => void) | undefined;
    const attachInner = () => {
      detachInner?.();
      detachInner = undefined;
      try {
        const w = iframe.contentWindow;
        if (!w) return;
        const onInnerKeyDown = (e: KeyboardEvent) => {
          if (e.key !== 'Escape') return;
          e.preventDefault();
          e.stopImmediatePropagation();
          onBack();
        };
        w.addEventListener('keydown', onInnerKeyDown, true);
        detachInner = () => w.removeEventListener('keydown', onInnerKeyDown, true);
      } catch {
        /* cross-origin PDF viewer — parent window handler still applies when focus leaves iframe */
      }
    };
    iframe.addEventListener('load', attachInner);
    try {
      if (iframe.contentDocument?.readyState === 'complete') attachInner();
    } catch {
      /* cross-origin */
    }
    return () => {
      iframe.removeEventListener('load', attachInner);
      detachInner?.();
    };
  }, [onBack, pdfBlobUrl]);

  const onPrint = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    if (win) {
      win.focus();
      win.print();
      return;
    }
    window.open(pdfBlobUrl, '_blank', 'noopener,noreferrer');
  }, [pdfBlobUrl]);

  const onDownload = useCallback(() => {
    downloadBlob(pdfBlob, `${quotation.quoteNumber}.pdf`);
  }, [pdfBlob, quotation.quoteNumber]);

  const pdfUrl = shareLink.data?.url;
  const msg = shareBody(quotation, customerName, pdfUrl);
  const waDigits = normalizeWhatsAppDigits(customerPhone);
  const waHref = whatsappHref(msg, waDigits);
  const mailHref = `mailto:?subject=${encodeURIComponent(`Quotation ${quotation.quoteNumber}`)}&body=${encodeURIComponent(msg)}`;

  return (
    <div className="qsf-pdf-root">
      <header className="qsf-pdf-toolbar">
        <div className="qsf-pdf-toolbar__left">
          <button type="button" className="qsf-pdf-back" onClick={onBack} aria-label="Back to share">
            ←
          </button>
          <div className="qsf-pdf-title">
            <span className="qsf-pdf-title__id">{quotation.quoteNumber}</span>
            <span className="qsf-pdf-title__cust">{customerName}</span>
          </div>
        </div>
        <div className="qsf-pdf-toolbar__actions">
          {shareLink.data?.note ? <span className="qsf-pdf-toolbar__hint">{shareLink.data.note}</span> : null}
          <Button type="button" variant="secondary" onClick={() => openExternal(waHref)}>
            WhatsApp
          </Button>
          <Button type="button" variant="secondary" onClick={() => openExternal(mailHref)}>
            Email
          </Button>
          <Button type="button" variant="secondary" onClick={onDownload}>
            Download PDF
          </Button>
          <Button type="button" variant="primary" onClick={onPrint}>
            Print
          </Button>
        </div>
      </header>

      <div className="qsf-pdf-body">
        <div className="qsf-pdf-sheet">
          <iframe ref={iframeRef} title={`Quotation ${quotation.quoteNumber}`} src={`${pdfBlobUrl}#toolbar=0`} />
        </div>
      </div>
    </div>
  );
};
