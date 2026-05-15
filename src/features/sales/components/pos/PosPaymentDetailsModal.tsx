/**
 * Single modal for Card / UPI / Bank transfer payment proof fields.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/components/modals/Modal';
import { Button, Input } from '@/shared/components/ui';
import { ImageUpload, type ImageData } from '@/shared/components/ui/ImageUpload';
import type { PosPaymentMethodDetails } from './posPaymentSplit';
import './PosPaymentDetailsModal.css';

export type PaymentDetailsModalKind = 'card' | 'upi' | 'bank';

type FieldConfig = {
  kind: PaymentDetailsModalKind;
  title: string;
  uploadLabel: string;
};

const CONFIG: Record<PaymentDetailsModalKind, FieldConfig> = {
  card: {
    kind: 'card',
    title: 'Card details',
    uploadLabel: 'Receipt upload',
  },
  upi: {
    kind: 'upi',
    title: 'UPI details',
    uploadLabel: 'Screenshot upload',
  },
  bank: {
    kind: 'bank',
    title: 'Bank transfer details',
    uploadLabel: 'Receipt upload',
  },
};

export function paymentDetailsKindFromMethodCode(code: string): PaymentDetailsModalKind {
  const c = code.trim().toLowerCase();
  if (c === 'upi') return 'upi';
  if (c === 'bank' || c === 'bank_transfer' || c.includes('bank')) return 'bank';
  return 'card';
}

type Props = {
  isOpen: boolean;
  methodCode: string;
  methodLabel: string;
  initial: PosPaymentMethodDetails | undefined;
  onClose: () => void;
  onSave: (details: PosPaymentMethodDetails) => void;
};

export const PosPaymentDetailsModal: React.FC<Props> = ({
  isOpen,
  methodCode,
  methodLabel,
  initial,
  onClose,
  onSave,
}) => {
  const kind = useMemo(() => paymentDetailsKindFromMethodCode(methodCode), [methodCode]);
  const cfg = CONFIG[kind];

  const [cardHolderName, setCardHolderName] = useState('');
  const [last4, setLast4] = useState('');
  const [transactionRef, setTransactionRef] = useState('');
  const [upiId, setUpiId] = useState('');
  const [transactionId, setTransactionId] = useState('');
  const [bankName, setBankName] = useState('');
  const [utr, setUtr] = useState('');
  const [images, setImages] = useState<ImageData[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    setCardHolderName(initial?.cardHolderName ?? '');
    setLast4(initial?.last4 ?? '');
    setTransactionRef(initial?.transactionRef ?? '');
    setUpiId(initial?.upiId ?? '');
    setTransactionId(initial?.transactionId ?? '');
    setBankName(initial?.bankName ?? '');
    setUtr(initial?.utr ?? '');
    const att = initial?.attachment;
    setImages(
      att?.url && att.publicId
        ? [{ url: att.url, publicId: att.publicId, isPrimary: true }]
        : [],
    );
  }, [isOpen, initial]);

  const handleSave = () => {
    const attachment = images[0]
      ? {
          url: images[0].url,
          publicId: images[0].publicId,
        }
      : undefined;
    const out: PosPaymentMethodDetails = {};
    if (kind === 'card') {
      if (cardHolderName.trim()) out.cardHolderName = cardHolderName.trim();
      if (last4.trim()) out.last4 = last4.trim().slice(0, 4);
      if (transactionRef.trim()) out.transactionRef = transactionRef.trim();
    } else if (kind === 'upi') {
      if (upiId.trim()) out.upiId = upiId.trim();
      if (transactionId.trim()) out.transactionId = transactionId.trim();
    } else {
      if (bankName.trim()) out.bankName = bankName.trim();
      if (utr.trim()) out.utr = utr.trim();
    }
    if (attachment) out.attachment = attachment;
    onSave(out);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`${cfg.title} · ${methodLabel}`} size="md">
      <div className="pos-payment-details-modal">
        {kind === 'card' ? (
          <>
            <label className="pos-payment-details-modal__field">
              <span>Card holder name</span>
              <Input
                value={cardHolderName}
                onChange={(e) => setCardHolderName(e.target.value)}
                placeholder="Name on card"
                autoComplete="off"
              />
            </label>
            <label className="pos-payment-details-modal__field">
              <span>Last 4 digits</span>
              <Input
                value={last4}
                onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="1234"
                inputMode="numeric"
                maxLength={4}
              />
            </label>
            <label className="pos-payment-details-modal__field">
              <span>Transaction reference</span>
              <Input
                value={transactionRef}
                onChange={(e) => setTransactionRef(e.target.value)}
                placeholder="Auth / ref number"
              />
            </label>
          </>
        ) : null}

        {kind === 'upi' ? (
          <>
            <label className="pos-payment-details-modal__field">
              <span>UPI ID</span>
              <Input
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                placeholder="merchant@upi"
              />
            </label>
            <label className="pos-payment-details-modal__field">
              <span>Transaction ID</span>
              <Input
                value={transactionId}
                onChange={(e) => setTransactionId(e.target.value)}
                placeholder="UTR / txn id"
              />
            </label>
          </>
        ) : null}

        {kind === 'bank' ? (
          <>
            <label className="pos-payment-details-modal__field">
              <span>Bank name</span>
              <Input
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="e.g. HDFC"
              />
            </label>
            <label className="pos-payment-details-modal__field">
              <span>UTR number</span>
              <Input
                value={utr}
                onChange={(e) => setUtr(e.target.value)}
                placeholder="UTR / reference"
              />
            </label>
          </>
        ) : null}

        <div className="pos-payment-details-modal__upload">
          <span className="pos-payment-details-modal__upload-label">{cfg.uploadLabel}</span>
          <ImageUpload
            images={images}
            onChange={setImages}
            maxImages={1}
            folder="sales/payments"
          />
        </div>

        <div className="pos-payment-details-modal__actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={handleSave}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
};
