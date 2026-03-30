import React, { useEffect, useState } from 'react';
import { Button, Input, Select } from '@/shared/components/ui';
import { salesService, type SalesSettingsData } from '@/services/sales.service';
import { docId } from '../../utils/ids';

interface Props {
  branchId: string | null;
}

export const SalesSettingsPanel: React.FC<Props> = ({ branchId }) => {
  const [settings, setSettings] = useState<SalesSettingsData | null>(null);
  const [lists, setLists] = useState<Record<string, unknown>[]>([]);
  const [priceListId, setPriceListId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!branchId) return;
    salesService
      .getSettings(branchId)
      .then(setSettings)
      .catch((e: Error) => setError(e.message));
    salesService
      .listPriceLists(branchId)
      .then((ls) => {
        setLists(ls as Record<string, unknown>[]);
      })
      .catch(() => {});
  }, [branchId]);

  useEffect(() => {
    if (lists.length && !priceListId) {
      const def = lists.find((l) => (l as { isDefault?: boolean }).isDefault) || lists[0];
      const id = docId(def as { _id?: string; id?: string });
      if (id) setPriceListId(id);
    }
  }, [lists, priceListId]);

  const saveTax = async () => {
    if (!branchId || !settings) return;
    setError(null);
    try {
      const next = await salesService.updateSettings(
        {
          taxRatePercent: settings.taxRatePercent,
          taxInclusive: settings.taxInclusive,
          allowNegativePos: settings.allowNegativePos === true,
        },
        branchId
      );
      setSettings(next);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const savePrice = async () => {
    if (!branchId || !priceListId || !variantId.trim() || !price) return;
    setError(null);
    try {
      await salesService.upsertPriceListItem(priceListId, { variantId: variantId.trim(), price: Number(price) }, branchId);
      setVariantId('');
      setPrice('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  if (!branchId) return <p className="sales-muted">Branch required.</p>;

  if (!settings) {
    return error ? <div className="sales-panel-error">{error}</div> : <p className="sales-muted">Loading…</p>;
  }

  const listOpts = lists.map((l) => ({
    value: docId(l as { _id?: string; id?: string }) || '',
    label: String((l as { name?: string }).name || ''),
  }));

  return (
    <div>
      {error ? <div className="sales-panel-error" style={{ marginBottom: 12 }}>{error}</div> : null}
      <h3 style={{ fontSize: 15 }}>Tax</h3>
      <div className="sales-form-row">
        <Input
          label="Tax rate %"
          type="number"
          value={String(settings.taxRatePercent)}
          onChange={(e) =>
            setSettings((s) => (s ? { ...s, taxRatePercent: Number(e.target.value) } : s))
          }
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={settings.taxInclusive}
            onChange={(e) => setSettings((s) => (s ? { ...s, taxInclusive: e.target.checked } : s))}
          />
          Tax inclusive
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={settings.allowNegativePos === true}
            onChange={(e) =>
              setSettings((s) => (s ? { ...s, allowNegativePos: e.target.checked } : s))
            }
          />
          Allow negative POS (stock)
        </label>
        <Button variant="primary" onClick={saveTax}>
          Save tax
        </Button>
      </div>

      <h3 style={{ marginTop: 24, fontSize: 15 }}>Variant price (price list item)</h3>
      <p className="sales-muted">Overrides list price for a variant; resolution uses customer → sales point → default list.</p>
      <div className="sales-form-row">
        <Select
          label="Price list"
          value={priceListId}
          onChange={(e) => setPriceListId(e.target.value)}
          options={listOpts}
        />
        <Input label="Variant ID" value={variantId} onChange={(e) => setVariantId(e.target.value)} />
        <Input label="Price" type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
        <Button variant="secondary" onClick={savePrice}>
          Upsert price
        </Button>
      </div>
    </div>
  );
};
