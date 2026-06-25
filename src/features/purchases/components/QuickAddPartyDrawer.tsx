import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, Select } from '@/shared/components/ui';
import { SideDrawer } from '@/shared/components/modals/SideDrawer';
import type { SelectOption } from '@/shared/components/ui';

export type QuickAddPartyResult = {
  id: string;
  name: string;
  gstin: string;
  email: string;
  phone?: string;
  paymentTermsLabel: string;
};

type ExistingParty = {
  id: string;
  name: string;
  gstin?: string;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  initialName: string;
  paymentTermOptions: SelectOption[];
  existingParties: ExistingParty[];
  onSaved: (party: QuickAddPartyResult) => void;
  persistParty?: (party: Omit<QuickAddPartyResult, 'id'>) => Promise<QuickAddPartyResult>;
};

function normalizeName(s: string): string {
  return s.trim().toLowerCase();
}

function normalizeGst(s: string): string {
  return s.trim().toUpperCase();
}

export const QuickAddPartyDrawer: React.FC<Props> = ({
  isOpen,
  onClose,
  initialName,
  paymentTermOptions,
  existingParties,
  onSaved,
  persistParty,
}) => {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [gstin, setGstin] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('net_30');
  const [nameError, setNameError] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState('');
  const saveRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName(initialName.trim());
    setGstin('');
    setPhone('');
    setEmail('');
    setPaymentTerms('net_30');
    setNameError('');
    setDuplicateWarning('');
  }, [isOpen, initialName]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => saveRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  const paymentLabel = useMemo(
    () => paymentTermOptions.find((o) => o.value === paymentTerms)?.label || paymentTerms,
    [paymentTermOptions, paymentTerms]
  );

  useEffect(() => {
    if (!isOpen) return;
    const n = normalizeName(name);
    const g = normalizeGst(gstin);
    const warnings: string[] = [];
    if (n) {
      const dupName = existingParties.find((p) => normalizeName(p.name) === n);
      if (dupName) warnings.push(`A party named "${dupName.name}" already exists.`);
    }
    if (g.length >= 4) {
      const dupGst = existingParties.find((p) => p.gstin && normalizeGst(p.gstin) === g);
      if (dupGst) warnings.push(`GSTIN matches existing party "${dupGst.name}".`);
    }
    setDuplicateWarning(warnings.join(' '));
  }, [isOpen, name, gstin, existingParties]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Name is required');
      return;
    }
    setNameError('');
    const party: QuickAddPartyResult = {
      id: crypto.randomUUID(),
      name: trimmed,
      gstin: gstin.trim() || '—',
      email: email.trim(),
      phone: phone.trim() || undefined,
      paymentTermsLabel: paymentLabel,
    };
    onSaved(party);
    onClose();
  };

  return (
    <SideDrawer isOpen={isOpen} onClose={onClose} title="Add party" width="420px">
      <div className="po-quick-add-party">
        <Input
          label="Name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (nameError) setNameError('');
          }}
          error={nameError}
        />
        <Input
          label="GSTIN"
          value={gstin}
          onChange={(e) => setGstin(e.target.value.toUpperCase())}
          placeholder="Optional"
        />
        <Input
          label="Phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Optional"
        />
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Optional"
        />
        <Select
          label="Payment terms"
          value={paymentTerms}
          onChange={(e) => setPaymentTerms(e.target.value)}
          options={paymentTermOptions}
        />
        {duplicateWarning ? (
          <p className="po-quick-add-party__warning" role="status">
            {duplicateWarning}
          </p>
        ) : null}
        <div className="po-quick-add-party__actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button ref={saveRef} type="button" variant="primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </SideDrawer>
  );
};
