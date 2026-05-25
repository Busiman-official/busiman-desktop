import React, { useCallback, useEffect, useRef } from 'react';
import { Button } from '@/shared/components/ui';
import './QuotationShareFlow.css';

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export interface OrderReceiptPdfViewerScreenProps {
  orderNumber: string;
  customerName: string;
  pdfBlobUrl: string;
  pdfBlob: Blob;
  onClose: () => void;
}

export const OrderReceiptPdfViewerScreen: React.FC<OrderReceiptPdfViewerScreenProps> = ({
  orderNumber,
  customerName,
  pdfBlobUrl,
  pdfBlob,
  onClose,
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
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

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
          onClose();
        };
        w.addEventListener('keydown', onInnerKeyDown, true);
        detachInner = () => w.removeEventListener('keydown', onInnerKeyDown, true);
      } catch {
        /* cross-origin */
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
  }, [onClose, pdfBlobUrl]);

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
    downloadBlob(pdfBlob, `receipt-${orderNumber}.pdf`);
  }, [pdfBlob, orderNumber]);

  return (
    <div className="qsf-pdf-root">
      <header className="qsf-pdf-toolbar">
        <div className="qsf-pdf-toolbar__left">
          <button type="button" className="qsf-pdf-back" onClick={onClose} aria-label="Close receipt">
            ×
          </button>
          <div className="qsf-pdf-title">
            <span className="qsf-pdf-title__id">Receipt · {orderNumber}</span>
            <span className="qsf-pdf-title__cust">{customerName}</span>
          </div>
        </div>
        <div className="qsf-pdf-toolbar__actions">
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
          <iframe ref={iframeRef} title={`Receipt ${orderNumber}`} src={`${pdfBlobUrl}#toolbar=0`} />
        </div>
      </div>
    </div>
  );
};
