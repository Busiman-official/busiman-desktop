import React, { useEffect, useMemo, useState } from 'react';
import { Button, Input, Select } from '@/shared/components/ui';
import { Modal } from '@/shared/components/modals/Modal';
import {
  purchaseService,
  type PurchaseSupplierMaster,
  type SupplierPaymentTerms,
} from '@/services/purchase.service';
import { PAYMENT_TERM_OPTIONS } from '../utils/supplierDirectory';

type Props = {
  isOpen: boolean;
  branchId?: string | null;
  mode: 'create' | 'edit';
  initial?: PurchaseSupplierMaster | null;
  onClose: () => void;
  onSaved: (master: PurchaseSupplierMaster) => void;
};

export const SupplierFormModal: React.FC<Props> = ({
  isOpen,
  branchId,
  mode,
  initial,
  onClose,
  onSaved,
}) => {
  const [name, setName] = useState('');
  const [gstin, setGstin] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [paymentTerms, setPaymentTerms] = useState<SupplierPaymentTerms>('net_30');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName(initial?.name || '');
    setGstin(initial?.gstin || '');
    setPhone(initial?.phone || '');
    setEmail(initial?.email || '');
    setContactPerson(initial?.contactPerson || '');
    setPaymentTerms(initial?.paymentTerms || 'net_30');
    setNotes(initial?.notes || '');
    setError(null);
  }, [initial, isOpen]);

  const title = useMemo(() => (mode === 'create' ? 'Create supplier' : 'Edit supplier'), [mode]);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: trimmed,
        gstin: gstin.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        contactPerson: contactPerson.trim() || undefined,
        paymentTerms,
        notes: notes.trim() || undefined,
      };
      let master;
      if (mode === 'edit' && initial?.id) {
        master = await purchaseService.patchSupplierMaster(initial.id, body, branchId);
      } else if (initial?.supplierCode?.trim()) {
        master = await purchaseService.upsertSupplierMaster(
          { ...body, supplierCode: initial.supplierCode.trim() },
          branchId
        );
      } else {
        master = await purchaseService.createSupplierMaster(body, branchId);
      }
      onSaved(master);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save supplier');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} width="480px">
      <div className="po-supplier-form">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <Input
          label="GSTIN"
          value={gstin}
          onChange={(e) => setGstin(e.target.value.toUpperCase())}
          placeholder="Optional"
        />
        <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input
          label="Contact person"
          value={contactPerson}
          onChange={(e) => setContactPerson(e.target.value)}
        />
        <Select
          label="Payment terms"
          value={paymentTerms}
          onChange={(e) => setPaymentTerms(e.target.value as SupplierPaymentTerms)}
          options={PAYMENT_TERM_OPTIONS}
        />
        <Input
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional"
        />
        {error ? (
          <p className="po-supplier-form__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="po-supplier-form__actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={() => void handleSave()} disabled={busy}>
            {busy ? 'Saving…' : mode === 'create' ? 'Create supplier' : 'Save changes'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
