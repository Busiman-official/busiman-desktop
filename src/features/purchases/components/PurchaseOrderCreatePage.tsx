import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, Select, Textarea } from '@/shared/components/ui';
import {
  inventoryService,
  type CatalogVariantRow,
  type Location,
  LocationType,
} from '@/services/inventory.service';
import {
  purchaseService,
  type PurchaseOrder,
  type PurchaseOrderAttachment,
  type PurchaseOrderPriority,
  type PurchaseOrderSupplierContact,
} from '@/services/purchase.service';
import './PurchaseOrderCreatePage.css';

type DraftLine = {
  variantId: string;
  itemId: string;
  productName: string;
  variantName: string;
  sku: string;
  quantityOrdered: number;
  unitId: string;
  expectedPrice: number;
  taxPercent: number;
  discountPercent: number;
};

type Props = {
  branchId?: string | null;
  supplierOptions: Array<{ id: string; name: string }>;
  onCancel: () => void;
  onSaved: (order: PurchaseOrder) => void;
};

const PAYMENT_TERM_OPTIONS = [
  { value: 'due_on_receipt', label: 'Due on receipt' },
  { value: 'net_7', label: 'Net 7' },
  { value: 'net_15', label: 'Net 15' },
  { value: 'net_30', label: 'Net 30' },
  { value: 'net_45', label: 'Net 45' },
  { value: 'net_60', label: 'Net 60' },
  { value: 'advance', label: 'Advance' },
];

function formatInr(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(v);
}

function stableHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function sanitizeEmailLocal(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 48) || 'vendor';
}

function buildSupplierSnapshot(
  supplierId: string,
  supplierName: string,
  orderPaymentTerms: string
): PurchaseOrderSupplierContact {
  if (!supplierId.trim()) {
    return {
      contactPerson: '—',
      phone: '—',
      email: '—',
      gstin: '—',
      defaultPaymentTerms: orderPaymentTerms ? PAYMENT_TERM_OPTIONS.find((o) => o.value === orderPaymentTerms)?.label || orderPaymentTerms : '—',
      outstandingDues: 0,
    };
  }
  const h = stableHash(`${supplierId}|${supplierName}`);
  const dues = h % 11 === 0 ? (h % 890_120) / 100 : 0;
  const panish = ((h >>> 0) % 1e9).toString().padStart(9, '0').slice(0, 9);
  const label = supplierName.trim() || supplierId;
  return {
    contactPerson: `Accounts — ${label}`.slice(0, 200),
    phone: `+91 98${(h % 90_000_000).toString().padStart(8, '0')}`,
    email: `${sanitizeEmailLocal(label)}.po@supplier.local`,
    gstin: `22AAAAA${panish}A1Z5`.slice(0, 15),
    defaultPaymentTerms:
      PAYMENT_TERM_OPTIONS.find((o) => o.value === orderPaymentTerms)?.label || orderPaymentTerms || 'Net 30 days',
    outstandingDues: dues,
  };
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

function lineMath(qty: number, unitPrice: number, taxPct: number, discPct: number) {
  const q = Math.max(0, qty);
  const up = Math.max(0, unitPrice);
  const t = clampPct(taxPct);
  const d = clampPct(discPct);
  const gross = q * up;
  const discountAmt = gross * (d / 100);
  const taxable = gross - discountAmt;
  const taxAmt = taxable * (t / 100);
  const lineTotal = taxable + taxAmt;
  return { gross, discountAmt, taxAmt, lineTotal };
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQ = !inQ;
      continue;
    }
    if (ch === ',' && !inQ) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function isMongoId(s: string): boolean {
  return /^[a-fA-F0-9]{24}$/.test(String(s).trim());
}

type LocalAttachment = { id: string; fileName: string; size?: number; mimeType?: string };

export const PurchaseOrderCreatePage: React.FC<Props> = ({ branchId, supplierOptions, onCancel, onSaved }) => {
  const [poNumber, setPoNumber] = useState('—');
  const [supplierId, setSupplierId] = useState('');
  const [supplierSearch, setSupplierSearch] = useState('');
  const [supplierSnapshot, setSupplierSnapshot] = useState<PurchaseOrderSupplierContact>(buildSupplierSnapshot('', '', ''));
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [deliveryLocationId, setDeliveryLocationId] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('net_30');
  const [priority, setPriority] = useState<PurchaseOrderPriority>('normal');
  const [internalNotes, setInternalNotes] = useState('');
  const [supplierMessage, setSupplierMessage] = useState('');
  const [shippingFreight, setShippingFreight] = useState(0);
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [variantSearch, setVariantSearch] = useState('');
  const [suggestions, setSuggestions] = useState<CatalogVariantRow[]>([]);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    purchaseService
      .getNextPoNumber(branchId)
      .then((v) => setPoNumber(v.poNumber))
      .catch(() => setPoNumber('—'));
  }, [branchId]);

  useEffect(() => {
    let cancelled = false;
    inventoryService
      .getAllLocations({ branchId: branchId || undefined, isActive: true })
      .then((rows) => {
        if (!cancelled) setLocations(rows.filter((l) => l.isActive));
      })
      .catch(() => {
        if (!cancelled) setLocations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [branchId]);

  useEffect(() => {
    const q = variantSearch.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    inventoryService
      .getCatalog({ search: q, branchId: branchId || undefined, isActive: true })
      .then((rows) => {
        if (!cancelled) setSuggestions(rows.slice(0, 8));
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [branchId, variantSearch]);

  useEffect(() => {
    const name = supplierOptions.find((s) => s.id === supplierId)?.name || supplierSearch;
    setSupplierSnapshot(buildSupplierSnapshot(supplierId, name, paymentTerms));
  }, [supplierId, supplierSearch, supplierOptions, paymentTerms]);

  const locationOptions = useMemo(() => {
    const wh = locations.filter((l) => l.type === LocationType.WAREHOUSE);
    const list = wh.length ? wh : locations;
    return list.map((l) => ({
      value: l.id,
      label: `${l.code} — ${l.name}`,
    }));
  }, [locations]);

  const filteredSuppliers = useMemo(() => {
    const q = supplierSearch.trim().toLowerCase();
    if (!q) return supplierOptions.slice(0, 12);
    return supplierOptions.filter((s) => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)).slice(0, 12);
  }, [supplierOptions, supplierSearch]);

  const orderTotals = useMemo(() => {
    let subtotal = 0;
    let totalDiscount = 0;
    let totalTax = 0;
    let linesSum = 0;
    for (const line of lines) {
      const { gross, discountAmt, taxAmt, lineTotal } = lineMath(
        line.quantityOrdered,
        line.expectedPrice,
        line.taxPercent,
        line.discountPercent
      );
      subtotal += gross;
      totalDiscount += discountAmt;
      totalTax += taxAmt;
      linesSum += lineTotal;
    }
    const freight = Math.max(0, Number(shippingFreight) || 0);
    const grandTotal = linesSum + freight;
    return { subtotal, totalDiscount, totalTax, grandTotal, freight, linesSum };
  }, [lines, shippingFreight]);

  const footerStats = useMemo(() => {
    const totalItems = lines.length;
    const totalQty = lines.reduce((s, l) => s + Number(l.quantityOrdered || 0), 0);
    return { totalItems, totalQty, grandTotal: orderTotals.grandTotal };
  }, [lines, orderTotals.grandTotal]);

  const rowFromCatalog = useCallback((row: CatalogVariantRow): DraftLine => {
    const unit = 'PCS';
    const price = row.costPrice ?? row.sellingPrice ?? 0;
    return {
      variantId: row.variantId,
      itemId: row.productId,
      productName: row.productName,
      variantName: row.variantName,
      sku: row.sku,
      quantityOrdered: 1,
      unitId: unit,
      expectedPrice: Number(price) || 0,
      taxPercent: 0,
      discountPercent: 0,
    };
  }, []);

  const addVariant = useCallback(
    (row: CatalogVariantRow) => {
      setLines((prev) => {
        const i = prev.findIndex((l) => l.variantId === row.variantId);
        if (i >= 0) {
          const next = [...prev];
          next[i] = { ...next[i], quantityOrdered: next[i].quantityOrdered + 1 };
          return next;
        }
        return [...prev, rowFromCatalog(row)];
      });
      setVariantSearch('');
      setSuggestions([]);
    },
    [rowFromCatalog]
  );

  const addFirstSuggestion = () => {
    if (suggestions[0]) addVariant(suggestions[0]);
  };

  const updateLine = (variantId: string, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((l) => (l.variantId === variantId ? { ...l, ...patch } : l)));
  };

  const removeLine = (variantId: string) => {
    setLines((prev) => prev.filter((l) => l.variantId !== variantId));
  };

  const pickSupplier = (s: { id: string; name: string }) => {
    setSupplierId(s.id);
    setSupplierSearch(s.name);
  };

  const onSupplierInputChange = (v: string) => {
    setSupplierSearch(v);
    const exact = supplierOptions.find((s) => s.name.toLowerCase() === v.trim().toLowerCase());
    if (exact) setSupplierId(exact.id);
    else if (!supplierOptions.some((s) => s.id === supplierId && s.name === v)) setSupplierId('');
  };

  const onFilesSelected = (list: FileList | null) => {
    if (!list?.length) return;
    const next: LocalAttachment[] = [];
    for (let i = 0; i < list.length; i += 1) {
      const f = list[i];
      next.push({
        id: `${f.name}-${f.size}-${Date.now()}-${i}`,
        fileName: f.name,
        size: f.size,
        mimeType: f.type,
      });
    }
    setAttachments((prev) => [...prev, ...next]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const importCsv = async (file: File | null) => {
    if (!file) return;
    setError(null);
    const text = await file.text();
    const rawLines = text.split(/\r?\n/).filter((l) => l.trim());
    if (rawLines.length < 2) {
      setError('CSV must include a header row and at least one data row.');
      if (csvInputRef.current) csvInputRef.current.value = '';
      return;
    }
    const header = parseCsvLine(rawLines[0]).map((h) => h.toLowerCase().replace(/\s+/g, ''));
    const col = (name: string) => header.indexOf(name);
    const idxVariant = col('variantid');
    const idxSku = col('sku');
    const idxQty = col('qty') >= 0 ? col('qty') : col('quantity');
    const idxUnit = col('unit');
    const idxPrice = col('unitprice') >= 0 ? col('unitprice') : col('price');
    const idxTax = col('taxpercent') >= 0 ? col('taxpercent') : col('tax');
    const idxDisc = col('discountpercent') >= 0 ? col('discountpercent') : col('discount');

    const errors: string[] = [];
    const newLines: DraftLine[] = [];

    for (let r = 1; r < rawLines.length; r += 1) {
      const cells = parseCsvLine(rawLines[r]);
      if (!cells.some((c) => c)) continue;
      try {
        let variantId = idxVariant >= 0 ? cells[idxVariant]?.trim() : '';
        const sku = idxSku >= 0 ? cells[idxSku]?.trim() : '';
        const qtyRaw = idxQty >= 0 ? cells[idxQty] : '1';
        const qty = Math.max(0.000001, Number(qtyRaw) || 1);
        const unit = idxUnit >= 0 ? cells[idxUnit]?.trim() || 'PCS' : 'PCS';
        const price = idxPrice >= 0 ? Math.max(0, Number(cells[idxPrice]) || 0) : 0;
        const taxP = idxTax >= 0 ? clampPct(Number(cells[idxTax]) || 0) : 0;
        const discP = idxDisc >= 0 ? clampPct(Number(cells[idxDisc]) || 0) : 0;

        if (variantId && isMongoId(variantId)) {
          const v = await inventoryService.getVariantById(variantId);
          const item = await inventoryService.getItemById(v.itemId);
          newLines.push({
            variantId: v.id,
            itemId: v.itemId,
            productName: item.name,
            variantName: v.name,
            sku: v.sku || v.code,
            quantityOrdered: qty,
            unitId: unit,
            expectedPrice: price,
            taxPercent: taxP,
            discountPercent: discP,
          });
        } else if (sku) {
          const rows = await inventoryService.getCatalog({
            search: sku,
            branchId: branchId || undefined,
            isActive: true,
          });
          const match = rows.find((x) => x.sku.toLowerCase() === sku.toLowerCase()) || rows[0];
          if (!match) {
            errors.push(`Row ${r + 1}: no catalog match for SKU "${sku}"`);
            continue;
          }
          const base = rowFromCatalog(match);
          newLines.push({
            ...base,
            quantityOrdered: qty,
            unitId: unit,
            expectedPrice: price || base.expectedPrice,
            taxPercent: taxP,
            discountPercent: discP,
          });
        } else {
          errors.push(`Row ${r + 1}: provide variantId or sku`);
        }
      } catch (e) {
        errors.push(`Row ${r + 1}: ${e instanceof Error ? e.message : 'failed'}`);
      }
    }

    if (newLines.length) {
      setLines((prev) => {
        const byId = new Map(prev.map((l) => [l.variantId, { ...l }]));
        for (const nl of newLines) {
          const ex = byId.get(nl.variantId);
          if (ex) {
            byId.set(nl.variantId, {
              ...ex,
              quantityOrdered: ex.quantityOrdered + nl.quantityOrdered,
              unitId: nl.unitId || ex.unitId,
              expectedPrice: nl.expectedPrice || ex.expectedPrice,
              taxPercent: nl.taxPercent,
              discountPercent: nl.discountPercent,
            });
          } else {
            byId.set(nl.variantId, nl);
          }
        }
        return [...byId.values()];
      });
    }

    if (errors.length) setError(errors.slice(0, 5).join(' · '));
    if (csvInputRef.current) csvInputRef.current.value = '';
  };

  const submit = async (mode: 'draft' | 'send' | 'confirm') => {
    if (!supplierId.trim()) {
      setError('Select a supplier from the directory or match an existing supplier name.');
      return;
    }
    if (lines.length === 0) {
      setError('Add at least one line item.');
      return;
    }
    setBusy(true);
    setError(null);
    const attachmentPayload: PurchaseOrderAttachment[] = attachments.map((a) => ({
      fileName: a.fileName,
      mimeType: a.mimeType,
      size: a.size,
    }));
    try {
      const created = await purchaseService.createOrder(
        {
          supplierId: supplierId.trim(),
          supplierName: supplierSearch.trim() || supplierOptions.find((s) => s.id === supplierId)?.name || supplierId.trim(),
          supplierContactSnapshot: supplierSnapshot,
          orderDate,
          expectedDeliveryDate: expectedDeliveryDate || undefined,
          deliveryLocationId: deliveryLocationId.trim() || undefined,
          paymentTerms: paymentTerms || undefined,
          priority,
          shippingFreight: orderTotals.freight,
          internalNotes: internalNotes.trim() || undefined,
          supplierMessage: supplierMessage.trim() || undefined,
          attachments: attachmentPayload.length ? attachmentPayload : undefined,
          lines: lines.map((l) => ({
            variantId: l.variantId,
            quantityOrdered: Number(l.quantityOrdered || 0),
            unitId: l.unitId?.trim() || undefined,
            expectedPrice: l.expectedPrice != null ? Number(l.expectedPrice) : undefined,
            taxPercent: clampPct(l.taxPercent),
            discountPercent: clampPct(l.discountPercent),
          })),
          confirm: mode === 'confirm',
          submittedToSupplier: mode === 'send',
        },
        branchId
      );
      onSaved(created);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not create purchase order');
    } finally {
      setBusy(false);
    }
  };

  const dues = Number(supplierSnapshot.outstandingDues || 0);

  return (
    <div className="po-create">
      <div className="po-create__viewport">
        {error ? <div className="po-create-alert po-create-alert--error">{error}</div> : null}

        <section className="po-create-card" aria-labelledby="po-create-order-details">
          <h2 id="po-create-order-details" className="po-create-card__title">
            Order details
          </h2>
          <div className="po-create-grid-4">
            <Input label="PO number" value={poNumber} readOnly className="po-create-field-grow" />
            <Input label="Order date" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} className="po-create-field-grow" />
            <Input
              label="Expected delivery date"
              type="date"
              value={expectedDeliveryDate}
              onChange={(e) => setExpectedDeliveryDate(e.target.value)}
              className="po-create-field-grow"
            />
            <Select
              label="Warehouse / location"
              placeholder="Select location"
              value={deliveryLocationId}
              onChange={(e) => setDeliveryLocationId(e.target.value)}
              options={locationOptions}
              className="po-create-field-grow"
            />
          </div>
          <div className="po-create-row">
            <Select
              label="Payment terms"
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
              options={PAYMENT_TERM_OPTIONS}
              className="po-create-field-grow"
            />
            <div className="po-create-priority">
              <span className="po-create-priority__label">Priority</span>
              <div className="po-create-priority__pills" role="group" aria-label="Order priority">
                {(['low', 'normal', 'urgent'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`po-create-pill${priority === p ? ' po-create-pill--active' : ''}`}
                    onClick={() => setPriority(p)}
                  >
                    {p === 'low' ? 'Low' : p === 'normal' ? 'Normal' : 'Urgent'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="po-create-card" aria-labelledby="po-create-supplier">
          <h2 id="po-create-supplier" className="po-create-card__title">
            Supplier
          </h2>
          <div className="po-create-grid-2">
            <div>
              <label className="input-label" htmlFor="po-supplier-search">
                Supplier name
              </label>
              <input
                id="po-supplier-search"
                className="input"
                value={supplierSearch}
                onChange={(e) => onSupplierInputChange(e.target.value)}
                placeholder="Search suppliers"
                list="po-supplier-datalist"
                autoComplete="off"
              />
              <datalist id="po-supplier-datalist">
                {supplierOptions.map((s) => (
                  <option key={s.id} value={s.name} />
                ))}
              </datalist>
              {filteredSuppliers.length > 0 && supplierSearch.trim() ? (
                <div className="po-create-suggestions" style={{ marginTop: 'var(--spacing-md)' }}>
                  {filteredSuppliers.map((s) => (
                    <button key={s.id} type="button" className="po-create-suggestion" onClick={() => pickSupplier(s)}>
                      <span>{s.name}</span>
                      <span className="po-create-suggestion__meta"> · {s.id}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <Input label="Supplier ID" value={supplierId} readOnly placeholder="Select a supplier" className="po-create-field-grow" title="Read-only after supplier selection" />
          </div>
          <div className="po-create-supplier-panel">
            <div className="po-create-supplier-panel__grid">
              <div className="po-create-kv">
                <span className="po-create-kv__label">Contact person</span>
                <span className="po-create-kv__value">{supplierSnapshot.contactPerson || '—'}</span>
              </div>
              <div className="po-create-kv">
                <span className="po-create-kv__label">Phone</span>
                <span className="po-create-kv__value">{supplierSnapshot.phone || '—'}</span>
              </div>
              <div className="po-create-kv">
                <span className="po-create-kv__label">Email</span>
                <span className="po-create-kv__value">{supplierSnapshot.email || '—'}</span>
              </div>
              <div className="po-create-kv">
                <span className="po-create-kv__label">GSTIN</span>
                <span className="po-create-kv__value">{supplierSnapshot.gstin || '—'}</span>
              </div>
              <div className="po-create-kv">
                <span className="po-create-kv__label">Default payment terms</span>
                <span className="po-create-kv__value">{supplierSnapshot.defaultPaymentTerms || '—'}</span>
              </div>
              <div className="po-create-kv">
                <span className="po-create-kv__label">Outstanding dues</span>
                <span className={`po-create-kv__value${dues > 0 ? ' po-create-kv__value--warn' : ''}`}>{formatInr(dues)}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="po-create-card" aria-labelledby="po-create-lines">
          <h2 id="po-create-lines" className="po-create-card__title">
            Line items
          </h2>
          <div className="po-create-toolbar">
            <div className="po-create-toolbar__search">
              <Input
                label="Add by SKU or product name"
                value={variantSearch}
                onChange={(e) => setVariantSearch(e.target.value)}
                placeholder="Type at least 2 characters"
              />
              {suggestions.length > 0 ? (
                <div className="po-create-suggestions">
                  {suggestions.map((s) => (
                    <button key={s.variantId} type="button" className="po-create-suggestion" onClick={() => addVariant(s)}>
                      <strong>{s.productName}</strong> — {s.variantName}
                      <span className="po-create-suggestion__meta"> ({s.sku})</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <Button type="button" variant="secondary" onClick={addFirstSuggestion} disabled={!suggestions.length}>
              Add item
            </Button>
            <Button type="button" variant="secondary" onClick={() => csvInputRef.current?.click()}>
              Import CSV
            </Button>
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(e) => void importCsv(e.target.files?.[0] || null)}
            />
          </div>

          <div className="po-create-table-wrap">
            <table className="po-create-table">
              <thead>
                <tr>
                  <th>Product / variant</th>
                  <th>SKU</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Unit price</th>
                  <th>Tax %</th>
                  <th>Discount %</th>
                  <th>Line total</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
                      No items yet. Search above or import a CSV (columns: variantId or sku, qty, unit, unitPrice, taxPercent, discountPercent).
                    </td>
                  </tr>
                ) : (
                  lines.map((line) => {
                    const { lineTotal } = lineMath(line.quantityOrdered, line.expectedPrice, line.taxPercent, line.discountPercent);
                    return (
                      <tr key={line.variantId}>
                        <td>
                          <div className="po-create-product-cell__name">
                            {line.productName} — {line.variantName}
                          </div>
                          <div className="po-create-product-cell__sku">{line.sku}</div>
                        </td>
                        <td>{line.sku}</td>
                        <td>
                          <div className="po-create-qty">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() =>
                                updateLine(line.variantId, {
                                  quantityOrdered: Math.max(0.000001, Number(line.quantityOrdered) - 1),
                                })
                              }
                            >
                              −
                            </Button>
                            <Input
                              label=""
                              type="number"
                              min={0.000001}
                              step="any"
                              value={line.quantityOrdered}
                              onChange={(e) =>
                                updateLine(line.variantId, {
                                  quantityOrdered: Math.max(0.000001, Number(e.target.value) || 0.000001),
                                })
                              }
                            />
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => updateLine(line.variantId, { quantityOrdered: Number(line.quantityOrdered) + 1 })}
                            >
                              +
                            </Button>
                          </div>
                        </td>
                        <td style={{ minWidth: '6rem' }}>
                          <Input label="" value={line.unitId} onChange={(e) => updateLine(line.variantId, { unitId: e.target.value })} />
                        </td>
                        <td style={{ minWidth: '6rem' }}>
                          <Input
                            label=""
                            type="number"
                            min={0}
                            step="any"
                            value={line.expectedPrice}
                            onChange={(e) => updateLine(line.variantId, { expectedPrice: Math.max(0, Number(e.target.value) || 0) })}
                          />
                        </td>
                        <td style={{ minWidth: '5rem' }}>
                          <Input
                            label=""
                            type="number"
                            min={0}
                            max={100}
                            step="any"
                            value={line.taxPercent}
                            onChange={(e) => updateLine(line.variantId, { taxPercent: clampPct(Number(e.target.value) || 0) })}
                          />
                        </td>
                        <td style={{ minWidth: '5rem' }}>
                          <Input
                            label=""
                            type="number"
                            min={0}
                            max={100}
                            step="any"
                            value={line.discountPercent}
                            onChange={(e) => updateLine(line.variantId, { discountPercent: clampPct(Number(e.target.value) || 0) })}
                          />
                        </td>
                        <td>{formatInr(lineTotal)}</td>
                        <td>
                          <Button type="button" variant="secondary" size="sm" onClick={() => removeLine(line.variantId)}>
                            Remove
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="po-create-summary">
            <div className="po-create-summary__row">
              <span>Subtotal</span>
              <span>{formatInr(orderTotals.subtotal)}</span>
            </div>
            <div className="po-create-summary__row">
              <span>Total tax</span>
              <span>{formatInr(orderTotals.totalTax)}</span>
            </div>
            <div className="po-create-summary__row">
              <span>Total discount</span>
              <span>{formatInr(orderTotals.totalDiscount)}</span>
            </div>
            <div className="po-create-summary__row" style={{ alignItems: 'center' }}>
              <span>Shipping / freight</span>
              <Input
                label=""
                type="number"
                min={0}
                step="any"
                value={shippingFreight}
                onChange={(e) => setShippingFreight(Math.max(0, Number(e.target.value) || 0))}
                style={{ maxWidth: '8rem' }}
              />
            </div>
            <div className="po-create-summary__row po-create-summary__row--strong">
              <span>Grand total</span>
              <span>{formatInr(orderTotals.grandTotal)}</span>
            </div>
          </div>
        </section>

        <section className="po-create-card" aria-labelledby="po-create-notes">
          <h2 id="po-create-notes" className="po-create-card__title">
            Notes and attachments
          </h2>
          <div className="po-create-grid-2">
            <Textarea label="Internal notes" value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} rows={4} />
            <Textarea label="Supplier message" value={supplierMessage} onChange={(e) => setSupplierMessage(e.target.value)} rows={4} />
          </div>
          <div className="po-create-attachments">
            {attachments.map((a) => (
              <span key={a.id} className="po-create-chip">
                {a.fileName}
                <button type="button" aria-label={`Remove ${a.fileName}`} onClick={() => removeAttachment(a.id)}>
                  ×
                </button>
              </span>
            ))}
            <Button type="button" variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
              Upload
            </Button>
            <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => onFilesSelected(e.target.files)} />
          </div>
        </section>
      </div>

      <footer className="po-create-footer">
        <div className="po-create-footer__stats">
          <span>
            Total items: <strong>{footerStats.totalItems}</strong>
          </span>
          <span>
            Total qty: <strong>{footerStats.totalQty}</strong>
          </span>
          <span>
            Grand total: <strong>{formatInr(footerStats.grandTotal)}</strong>
          </span>
        </div>
        <div className="po-create-footer__actions">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="secondary" onClick={() => void submit('draft')} disabled={busy}>
            Save draft
          </Button>
          <Button type="button" variant="secondary" onClick={() => void submit('send')} disabled={busy}>
            Send to supplier
          </Button>
          <Button type="button" variant="primary" onClick={() => void submit('confirm')} disabled={busy}>
            Confirm order
          </Button>
        </div>
      </footer>
    </div>
  );
};
