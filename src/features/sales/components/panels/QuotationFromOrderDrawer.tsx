import React, { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/shared/components/modals/Modal';
import { Button, Input, Textarea } from '@/shared/components/ui';
import { salesService, type SalesQuotation } from '@/services/sales.service';
import { entityId } from '../../utils/ids';

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export interface QuotationFromOrderDrawerProps {
  isOpen: boolean;
  order: Record<string, unknown> | null;
  branchId: string;
  onClose: () => void;
  onCreated: (quotation: SalesQuotation, meta?: { pdfWarning?: string | null }) => void;
}

export const QuotationFromOrderDrawer: React.FC<QuotationFromOrderDrawerProps> = ({
  isOpen,
  order,
  branchId,
  onClose,
  onCreated,
}) => {
  const [validUntil, setValidUntil] = useState('');
  const [deliveryCharges, setDeliveryCharges] = useState('');
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setValidUntil('');
      setDeliveryCharges('');
      setNotes('');
      setTerms('');
      setError(null);
    }
  }, [isOpen, order]);

  const orderId = order ? entityId(order) : '';
  const orderNumber = order && typeof order.orderNumber === 'string' ? order.orderNumber : '—';

  const buildPayload = useCallback(
    () => ({
      ...(validUntil.trim() ? { validUntil: validUntil.trim() } : {}),
      ...(deliveryCharges.trim() ? { deliveryAmount: Number(deliveryCharges.trim()) } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(terms.trim() ? { terms: terms.trim() } : {}),
    }),
    [validUntil, deliveryCharges, notes, terms]
  );

  const invalidDelivery = deliveryCharges.trim() !== '' && (!Number.isFinite(Number(deliveryCharges)) || Number(deliveryCharges) < 0);

  const onPreviewPdf = async () => {
    if (!orderId || !branchId) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await salesService.previewQuotationPdfBlob({ orderId, ...buildPayload() }, branchId);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setBusy(false);
    }
  };

  const onCreateOnly = async () => {
    if (!orderId || !branchId) return;
    setBusy(true);
    setError(null);
    try {
      const { quotation, pdfWarning } = await salesService.createQuotationFromOrder(
        orderId,
        { ...buildPayload(), downloadPdf: false },
        branchId
      );
      onClose();
      onCreated(quotation, { pdfWarning: pdfWarning ?? null });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  };

  const onCreateAndDownload = async () => {
    if (!orderId || !branchId) return;
    setBusy(true);
    setError(null);
    try {
      const { quotation, pdfWarning } = await salesService.createQuotationFromOrder(
        orderId,
        { ...buildPayload(), downloadPdf: true },
        branchId
      );
      const qid = entityId(quotation) || quotation._id;
      let mergedWarn = pdfWarning ?? null;
      try {
        const blob = await salesService.downloadQuotationPdfBlob(qid, branchId);
        downloadBlob(blob, `${quotation.quoteNumber}.pdf`);
      } catch {
        mergedWarn = mergedWarn || 'PDF auto-download failed — use Download in the print view.';
      }
      onClose();
      onCreated(quotation, { pdfWarning: mergedWarn });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Quotation from order ${orderNumber}`} size="lg">
      {!orderId ? (
        <p className="sales-muted">No order selected.</p>
      ) : (
        <>
          {error ? <div className="sales-panel-error" style={{ marginBottom: 12 }}>{error}</div> : null}
          <div className="sales-form-row" style={{ gap: 10, display:"grid", gridTemplateColumns: '1fr 1fr' }}>
            <Input
              label="Valid until (optional)"
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
            <Input
              label="₹ Delivery charges"
              type="number"
              min={0}
              step={0.01}
              value={deliveryCharges}
              onChange={(e) => setDeliveryCharges(e.target.value)}
              error={invalidDelivery ? 'Enter a valid non-negative amount' : undefined}
            />
          </div>
          <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          <Textarea label="Terms" value={terms} onChange={(e) => setTerms(e.target.value)} rows={3} />
          <div className="sales-form-row" style={{ marginTop: 16, flexWrap: 'wrap', gap: 8 }}>
            <Button variant="secondary" onClick={onPreviewPdf} disabled={busy || invalidDelivery}>
              Preview PDF
            </Button>
            <Button variant="secondary" onClick={onCreateOnly} disabled={busy || invalidDelivery}>
              Create quotation
            </Button>
            <Button variant="primary" onClick={onCreateAndDownload} disabled={busy || invalidDelivery}>
              Create &amp; download PDF
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
};
