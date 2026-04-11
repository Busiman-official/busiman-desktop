import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Button, Input, Select, Switch } from '@/shared/components/ui';
import { SideDrawer } from '@/shared/components/modals/SideDrawer';
import { employeeService } from '@/services/employee.service';
import { inventoryService } from '@/services/inventory.service';
import { salesService } from '@/services/sales.service';
import { User } from '@/types';
import { docId, entityId } from '../../utils/ids';
import './SalesSalesPointsPanel.css';

interface Props {
  branchId: string | null;
  /** Opens Sales → Orders with this sales point selected in the header. */
  onGoToOrdersForSalesPoint?: (salesPointId: string) => void;
}

export type SalesSalesPointsPanelHandle = {
  openCreate: () => void;
};

type FilterChip = 'all' | 'active' | 'inactive' | 'store' | 'online';

type FormType = 'store' | 'warehouse' | 'online' | 'b2b' | 'counter';

const TYPE_LABELS: Record<string, string> = {
  store: 'Store',
  counter: 'Counter',
  online: 'Online',
  warehouse: 'Warehouse',
  b2b: 'B2B',
};

const PAYMENT_OPTIONS = [
  { code: 'cash', label: 'Cash' },
  { code: 'card', label: 'Card' },
  { code: 'upi', label: 'UPI' },
  { code: 'bank_transfer', label: 'Bank transfer' },
  { code: 'credit', label: 'Credit' },
] as const;

const PRINTER_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'thermal_main', label: 'Thermal (main)' },
  { value: 'thermal_secondary', label: 'Thermal (secondary)' },
  { value: 'usb_receipt', label: 'USB receipt' },
];

const PAYMENT_LABELS: Record<string, string> = Object.fromEntries(
  PAYMENT_OPTIONS.map((p) => [p.code, p.label])
);

const PRINTER_LABELS: Record<string, string> = Object.fromEntries(
  PRINTER_OPTIONS.filter((p) => p.value).map((p) => [p.value, p.label])
);

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function refName(obj: unknown): string {
  if (!obj || typeof obj !== 'object') return '—';
  const n = (obj as { name?: string }).name;
  return n ? String(n) : '—';
}

function formatMoney(n: number, currency = 'INR'): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

function formatSessionTime(iso?: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return '—';
  }
}

function paymentMethodsDisplay(codes: string[] | undefined): string {
  if (!codes?.length) return '—';
  return codes.map((c) => PAYMENT_LABELS[c] || c).join(', ');
}

function printerDisplay(key: string | undefined): string {
  if (!key) return '—';
  return PRINTER_LABELS[key] || key;
}

export const SalesSalesPointsPanel = forwardRef<SalesSalesPointsPanelHandle, Props>(function SalesSalesPointsPanel(
  { branchId, onGoToOrdersForSalesPoint },
  ref
) {
  const [points, setPoints] = useState<Record<string, unknown>[]>([]);
  const [lists, setLists] = useState<Record<string, unknown>[]>([]);
  const [locs, setLocs] = useState<{ id: string; name: string }[]>([]);
  const [employees, setEmployees] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [filterChip, setFilterChip] = useState<FilterChip>('all');
  const [pageError, setPageError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<FormType>('store');
  const [formLocationId, setFormLocationId] = useState('');
  const [formPriceListId, setFormPriceListId] = useState('');
  const [formCashierId, setFormCashierId] = useState('');
  const [formPrinter, setFormPrinter] = useState('');
  const [formPayments, setFormPayments] = useState<Set<string>>(() => new Set(['cash', 'card', 'upi']));
  const [formRequirePin, setFormRequirePin] = useState(false);
  const [formAutoPrint, setFormAutoPrint] = useState(false);
  const [formCountCash, setFormCountCash] = useState(false);
  const [formFooter, setFormFooter] = useState('');

  const load = useCallback(() => {
    if (!branchId) return;
    setPageError(null);
    Promise.all([
      salesService.listSalesPoints(branchId, { includeInactive: true }),
      salesService.listPriceLists(branchId),
      inventoryService.getAllLocations({ isActive: true }),
    ])
      .then(([sp, pl, loc]) => {
        setPoints(sp as Record<string, unknown>[]);
        setLists(pl as Record<string, unknown>[]);
        setLocs((loc as { id: string; name: string }[]).map((l) => ({ id: l.id, name: l.name })));
      })
      .catch((e: Error) => setPageError(e.message));
  }, [branchId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    employeeService
      .getAllEmployees()
      .then((list) => setEmployees(list.filter((u) => u.isActive !== false)))
      .catch(() => setEmployees([]));
  }, []);

  useEffect(() => {
    if (lists.length && !formPriceListId && drawerOpen) {
      const def = lists.find((l) => (l as { isDefault?: boolean }).isDefault) || lists[0];
      const id = docId(def as { _id?: string; id?: string });
      if (id) setFormPriceListId(id);
    }
  }, [lists, formPriceListId, drawerOpen]);

  const openCreate = useCallback(() => {
    setEditingId(null);
    setDrawerError(null);
    setFormName('');
    setFormType('store');
    setFormLocationId('');
    setFormPriceListId('');
    setFormCashierId('');
    setFormPrinter('');
    setFormPayments(new Set(['cash', 'card', 'upi']));
    setFormRequirePin(false);
    setFormAutoPrint(false);
    setFormCountCash(false);
    setFormFooter('');
    if (lists.length) {
      const def = lists.find((l) => (l as { isDefault?: boolean }).isDefault) || lists[0];
      const id = docId(def as { _id?: string; id?: string });
      if (id) setFormPriceListId(id);
    }
    setDrawerOpen(true);
  }, [lists]);

  useImperativeHandle(
    ref,
    () => ({
      openCreate,
    }),
    [openCreate]
  );

  const openEdit = (p: Record<string, unknown>) => {
    const id = docId(p as { _id?: string; id?: string });
    if (!id) return;
    setEditingId(id);
    setDrawerError(null);
    setFormName(String(p.name || ''));
    const t = String(p.type || 'store');
    setFormType(
      (['store', 'warehouse', 'online', 'b2b', 'counter'].includes(t) ? t : 'store') as FormType
    );
    const loc = p.locationId as { _id?: string; id?: string } | undefined;
    const pl = p.defaultPriceListId as { _id?: string; id?: string } | undefined;
    const au = p.assignedUserId as { _id?: string; id?: string } | undefined;
    setFormLocationId(entityId(loc));
    setFormPriceListId(entityId(pl));
    setFormCashierId(entityId(au));
    setFormPrinter(String(p.receiptPrinterKey || ''));
    const methods = Array.isArray(p.allowedPaymentMethods)
      ? (p.allowedPaymentMethods as string[])
      : [];
    setFormPayments(new Set(methods.length ? methods : ['cash']));
    setFormRequirePin(Boolean(p.requirePinToOpenSession));
    setFormAutoPrint(Boolean(p.autoPrintReceipt));
    setFormCountCash(Boolean(p.countCashEndOfShift));
    setFormFooter(String(p.receiptFooterMessage || ''));
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditingId(null);
    setDrawerError(null);
  };

  const togglePayment = (code: string) => {
    setFormPayments((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const submitForm = async () => {
    if (!branchId) return;
    const name = formName.trim();
    const resolvedLocationId =
      formLocationId.trim() || (locs.length === 1 ? locs[0].id : '');

    if (!name) {
      setDrawerError('Name is required.');
      return;
    }
    if (!resolvedLocationId) {
      setDrawerError(
        locs.length === 0
          ? 'No inventory locations exist for this branch. Create a location in Inventory first.'
          : 'Select an inventory location.'
      );
      return;
    }
    const methods = Array.from(formPayments);
    if (methods.length === 0) {
      setDrawerError('Select at least one payment method.');
      return;
    }
    setDrawerError(null);
    setSaving(true);
    const body: Record<string, unknown> = {
      name,
      type: formType,
      locationId: resolvedLocationId,
      assignedUserId: formCashierId || null,
      receiptPrinterKey: formPrinter || undefined,
      allowedPaymentMethods: methods,
      requirePinToOpenSession: formRequirePin,
      autoPrintReceipt: formAutoPrint,
      countCashEndOfShift: formCountCash,
      receiptFooterMessage: formFooter.trim() || undefined,
    };
    if (formPriceListId.trim()) {
      body.defaultPriceListId = formPriceListId.trim();
    }
    try {
      if (editingId) {
        await salesService.updateSalesPoint(editingId, body, branchId);
      } else {
        await salesService.createSalesPoint(body, branchId);
      }
      closeDrawer();
      load();
    } catch (e: unknown) {
      setDrawerError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setSaving(false);
    }
  };

  const handleSessionToggle = async (p: Record<string, unknown>) => {
    const id = docId(p as { _id?: string; id?: string });
    if (!id || !branchId) return;
    const open = p.sessionStatus === 'open';
    setActionId(id);
    try {
      if (open) await salesService.closeSalesPointSession(id, branchId);
      else await salesService.openSalesPointSession(id, branchId);
      load();
    } catch (e: unknown) {
      setPageError(e instanceof Error ? e.message : 'Session action failed');
    } finally {
      setActionId(null);
    }
  };

  const handleDeactivate = async (p: Record<string, unknown>) => {
    const id = docId(p as { _id?: string; id?: string });
    if (!id || !branchId) return;
    setActionId(id);
    try {
      await salesService.updateSalesPoint(id, { isActive: false }, branchId);
      load();
    } catch (e: unknown) {
      setPageError(e instanceof Error ? e.message : 'Deactivate failed');
    } finally {
      setActionId(null);
    }
  };

  const handleActivate = async (p: Record<string, unknown>) => {
    const id = docId(p as { _id?: string; id?: string });
    if (!id || !branchId) return;
    setActionId(id);
    try {
      await salesService.updateSalesPoint(id, { isActive: true }, branchId);
      load();
    } catch (e: unknown) {
      setPageError(e instanceof Error ? e.message : 'Activate failed');
    } finally {
      setActionId(null);
    }
  };

  const filteredPoints = useMemo(() => {
    let rows = [...points];
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((p) => {
        const name = String(p.name || '').toLowerCase();
        const typeStr = TYPE_LABELS[String(p.type || '')] || String(p.type || '').toLowerCase();
        const cashier = refName(p.assignedUserId).toLowerCase();
        return name.includes(q) || typeStr.toLowerCase().includes(q) || cashier.includes(q);
      });
    }
    switch (filterChip) {
      case 'active':
        return rows.filter((p) => p.isActive !== false);
      case 'inactive':
        return rows.filter((p) => p.isActive === false);
      case 'store':
        return rows.filter((p) => ['store', 'counter', 'warehouse'].includes(String(p.type)));
      case 'online':
        return rows.filter((p) => String(p.type) === 'online');
      default:
        return rows;
    }
  }, [points, search, filterChip]);

  const listOpts = lists
    .map((l) => ({
      value: entityId(l),
      label: String((l as { name?: string }).name || 'Price list'),
    }))
    .filter((o) => o.value !== '');

  const locOpts = locs.filter((l) => l.id).map((l) => ({ value: l.id, label: l.name }));

  const cashierOpts = employees.map((u) => ({ value: u.id, label: u.name || u.email }));

  const typeFormOptions = [
    { value: 'store', label: 'Store' },
    { value: 'warehouse', label: 'Warehouse' },
    { value: 'online', label: 'Online' },
    { value: 'b2b', label: 'B2B' },
    ...(editingId ? [{ value: 'counter', label: 'Counter (legacy)' }] : []),
  ];

  const chipDefs: { id: FilterChip; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'active', label: 'Active' },
    { id: 'inactive', label: 'Inactive' },
    { id: 'store', label: 'Store' },
    { id: 'online', label: 'Online' },
  ];

  if (!branchId) {
    return <p className="sales-sp-muted">Select a branch to manage sales points.</p>;
  }

  return (
    <div className="sales-sp">
      {pageError ? <div className="sales-sp__banner">{pageError}</div> : null}


      <div className="sales-sp__toolbar">
        <div className="sales-sp__toolbar-filters" role="group" aria-label="Filter sales points">
          {chipDefs.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`sales-sp-chip${filterChip === c.id ? ' sales-sp-chip--active' : ''}`}
              onClick={() => setFilterChip(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div
          className={`sales-sp-search${search ? ' sales-sp-search--filled' : ''}`}
          role="search"
        >
          <span className="sales-sp-search__icon">
            <SearchIcon />
          </span>
          <input
            type="search"
            className="sales-sp-search__field"
            placeholder="Search name, type, cashier…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search sales points"
            autoComplete="off"
          />
          {search ? (
            <button
              type="button"
              className="sales-sp-search__clear"
              onClick={() => setSearch('')}
              aria-label="Clear search"
            >
              ×
            </button>
          ) : null}
        </div>
      </div>

      <div className="sales-sp__grid">
        {filteredPoints.map((p) => {
          const id = docId(p as { _id?: string; id?: string }) || '';
          const isActive = p.isActive !== false;
          const sessionOpen = p.sessionStatus === 'open';
          const typeLabel = TYPE_LABELS[String(p.type || '')] || String(p.type || '—');
          const locationLine = refName(p.locationId);
          const busy = actionId === id;

          let dotClass = 'sales-sp-card__dot--closed';
          if (!isActive) dotClass = 'sales-sp-card__dot--off';
          else if (sessionOpen) dotClass = 'sales-sp-card__dot--live';

          return (
            <article key={id} className="sales-sp-card">
              <div className="sales-sp-card__top">
                <div>
                  <h2 className="sales-sp-card__name">{String(p.name || '—')}</h2>
                  <p className="sales-sp-card__sub">
                    {typeLabel} · {locationLine}
                  </p>
                </div>
                <span
                  className={`sales-sp-card__dot ${dotClass}`}
                  title={!isActive ? 'Inactive' : sessionOpen ? 'Session open' : 'Session closed'}
                  aria-hidden
                />
              </div>

              <div className="sales-sp-card__meta">
                <div>
                  <span className="sales-sp-meta__label">Cashier name</span>
                  <span className="sales-sp-meta__value">{refName(p.assignedUserId)}</span>
                </div>
                <div>
                  <span className="sales-sp-meta__label">Price list</span>
                  <span className="sales-sp-meta__value">{refName(p.defaultPriceListId)}</span>
                </div>
                <div>
                  <span className="sales-sp-meta__label">Allowed payment methods</span>
                  <span className="sales-sp-meta__value">
                    {paymentMethodsDisplay(p.allowedPaymentMethods as string[] | undefined)}
                  </span>
                </div>
                <div>
                  <span className="sales-sp-meta__label">Printer</span>
                  <span className="sales-sp-meta__value">
                    {printerDisplay(p.receiptPrinterKey as string | undefined)}
                  </span>
                </div>
              </div>

              <div className="sales-sp-card__session">
                {isActive && sessionOpen ? (
                  <>
                    <div className="sales-sp-session__row">
                      <span className="sales-sp-session__muted">Session opened</span>
                      <span className="sales-sp-session__strong">
                        {formatSessionTime(p.sessionOpenedAt as string | undefined)}
                      </span>
                    </div>
                    <div className="sales-sp-session__row">
                      <span className="sales-sp-session__muted">Sales this session</span>
                      <span className="sales-sp-session__sales">
                        {formatMoney(Number(p.sessionSalesTotal) || 0)}
                      </span>
                    </div>
                  </>
                ) : isActive ? (
                  <>
                    <div className="sales-sp-session__row">
                      <span className="sales-sp-session__muted">Last session</span>
                      <span className="sales-sp-session__strong">
                        {formatSessionTime(p.lastSessionClosedAt as string | undefined)}
                      </span>
                    </div>
                    <div className="sales-sp-session__row">
                      <span className="sales-sp-session__muted">Status</span>
                      <span className="sales-sp-session__amber">Session closed</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="sales-sp-session__row">
                      <span className="sales-sp-session__muted">Last session</span>
                      <span className="sales-sp-session__strong">
                        {formatSessionTime(p.lastSessionClosedAt as string | undefined)}
                      </span>
                    </div>
                    <div className="sales-sp-session__row">
                      <span className="sales-sp-session__muted">Status</span>
                      <span className="sales-sp-session__grey">Inactive</span>
                    </div>
                  </>
                )}
              </div>

              <div className="sales-sp-card__actions">
                <Button variant="secondary" disabled={busy} onClick={() => openEdit(p)}>
                  Edit
                </Button>
                {onGoToOrdersForSalesPoint && id && isActive ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => onGoToOrdersForSalesPoint(id)}
                    title="Open Orders tab for this sales point"
                    aria-label={`Open orders for ${String(p.name || 'sales point')}`}
                  >
                    Orders
                  </Button>
                ) : null}
                {isActive ? (
                  <>
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() => handleSessionToggle(p)}
                    >
                      {sessionOpen ? 'Close session' : 'Open session'}
                    </Button>
                    <Button
                      variant="secondary"
                      className="sales-sp-btn--danger"
                      disabled={busy}
                      onClick={() => handleDeactivate(p)}
                    >
                      Deactivate
                    </Button>
                  </>
                ) : (
                  <Button variant="primary" disabled={busy} onClick={() => handleActivate(p)}>
                    Activate
                  </Button>
                )}
              </div>
            </article>
          );
        })}

        <button type="button" className="sales-sp-add-card" onClick={openCreate}>
          <span className="sales-sp-add-card__icon" aria-hidden>
            <PlusIcon />
          </span>
          Add new sales point
        </button>
      </div>

      <SideDrawer
        isOpen={drawerOpen}
        onClose={closeDrawer}
        title={editingId ? 'Edit sales point' : 'Create sales point'}
        width="min(520px, 33vw)"
        className="sales-sp-drawer"
        ariaDescribedBy={drawerError ? 'sales-sp-drawer-error' : undefined}
      >
        <div className="sales-sp-drawer__scroll">
          {drawerError ? (
            <div className="sales-sp__banner" id="sales-sp-drawer-error" style={{ marginBottom: 16 }}>
              {drawerError}
            </div>
          ) : null}

          <div className="sales-sp-form__group">
            <h3 className="sales-sp-form__group-title">Basic info</h3>
            <div className="sales-sp-form__row2">
              <Input label="Name" value={formName} onChange={(e) => setFormName(e.target.value)} />
              <Select
                label="Type"
                value={formType}
                onChange={(e) => setFormType(e.target.value as FormType)}
                options={typeFormOptions}
              />
            </div>
          </div>

          <div className="sales-sp-form__group">
            <h3 className="sales-sp-form__group-title">Linking</h3>
            <div className="sales-sp-form__row2">
              <Select
                label="Inventory location"
                value={formLocationId}
                onChange={(e) => setFormLocationId(e.target.value)}
                options={locOpts}
                placeholder="Select location"
              />
              <Select
                label="Default price list (optional)"
                value={formPriceListId}
                onChange={(e) => setFormPriceListId(e.target.value)}
                options={listOpts}
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="sales-sp-form__group">
            <h3 className="sales-sp-form__group-title">Staff & hardware</h3>
            <div className="sales-sp-form__row2">
              <Select
                label="Assigned cashier"
                value={formCashierId}
                onChange={(e) => setFormCashierId(e.target.value)}
                options={cashierOpts}
                placeholder="Optional"
              />
              <Select
                label="Receipt printer"
                value={formPrinter}
                onChange={(e) => setFormPrinter(e.target.value)}
                options={PRINTER_OPTIONS}
              />
            </div>
          </div>

          <div className="sales-sp-form__group">
            <h3 className="sales-sp-form__group-title">Payment methods</h3>
            <p className="sales-sp-form__subtitle">Allowed payment methods</p>
            <div className="sales-sp-pay-chips" role="group" aria-label="Allowed payment methods">
              {PAYMENT_OPTIONS.map((opt) => {
                const on = formPayments.has(opt.code);
                return (
                  <button
                    key={opt.code}
                    type="button"
                    className={`sales-sp-pay-chip${on ? ' sales-sp-pay-chip--on' : ''}`}
                    onClick={() => togglePayment(opt.code)}
                    aria-pressed={on}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="sales-sp-form__group">
            <h3 className="sales-sp-form__group-title">Behaviour</h3>
            <div className="sales-sp-toggle-row">
              <div className="sales-sp-toggle-row__text">
                <div className="sales-sp-toggle-row__title">Auto-print receipt after sale</div>
                <div className="sales-sp-toggle-row__hint">Send receipt to the configured printer automatically.</div>
              </div>
              <Switch
                checked={formAutoPrint}
                onChange={(e) => setFormAutoPrint(e.target.checked)}
                aria-label="Auto-print receipt after sale"
              />
            </div>
          </div>

          <div className="sales-sp-form__group">
            <h3 className="sales-sp-form__group-title">Receipt</h3>
            <Input
              label="Receipt footer message"
              placeholder="e.g. Thank you for shopping with us!"
              value={formFooter}
              onChange={(e) => setFormFooter(e.target.value)}
            />
          </div>
        </div>

        <div className="sales-sp-drawer__footer">
          <Button variant="secondary" onClick={closeDrawer} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submitForm} disabled={saving}>
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create sales point'}
          </Button>
        </div>
      </SideDrawer>
    </div>
  );
});

SalesSalesPointsPanel.displayName = 'SalesSalesPointsPanel';
