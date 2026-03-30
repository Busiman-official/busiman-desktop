import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/shared/components/ui';
import { salesService } from '@/services/sales.service';
import { docId } from '../../utils/ids';
import { NewReturnModal } from '../returns/NewReturnModal';
import './SalesReturnsPanel.css';

interface Props {
  branchId: string | null;
  /** Increment from header "+ New return" to open the return wizard */
  newReturnSeq?: number;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function parseTs(v: unknown): number {
  if (!v) return 0;
  const t = new Date(String(v)).getTime();
  return Number.isFinite(t) ? t : 0;
}

function formatInr(n: number): string {
  return `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type StatFilter = 'all' | 'month' | 'pending' | 'restocked' | 'refunds';

type EnrichedReturn = Record<string, unknown> & {
  _id?: string;
  returnNumber?: string;
  status?: string;
  createdAt?: string;
  orderNumber?: string;
  originalOrderId?: unknown;
  customerName?: string;
  refundAmount?: number;
  itemsSummary?: string;
  itemsRestocked?: number;
  totalReturnQty?: number;
  primaryReason?: string;
};

export const SalesReturnsPanel: React.FC<Props> = ({ branchId, newReturnSeq = 0 }) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [returns, setReturns] = useState<EnrichedReturn[]>([]);
  const [ordersForRate, setOrdersForRate] = useState<Record<string, unknown>[]>([]);
  const [newReturnOpen, setNewReturnOpen] = useState(false);
  const [returnModalInitialOrderId, setReturnModalInitialOrderId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [statFilter, setStatFilter] = useState<StatFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailRecord, setDetailRecord] = useState<EnrichedReturn | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; row: EnrichedReturn } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    if (!branchId) return;
    setLoading(true);
    Promise.all([
      salesService.listReturns(branchId) as Promise<EnrichedReturn[]>,
      salesService.listOrders(branchId, 'completed') as Promise<Record<string, unknown>[]>,
    ])
      .then(([r, o]) => {
        setReturns(Array.isArray(r) ? r : []);
        setOrdersForRate(Array.isArray(o) ? o : []);
      })
      .catch(() => {
        setReturns([]);
        setOrdersForRate([]);
      })
      .finally(() => setLoading(false));
  }, [branchId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (newReturnSeq <= 0) return;
    setReturnModalInitialOrderId(undefined);
    setNewReturnOpen(true);
  }, [newReturnSeq]);

  useEffect(() => {
    const ro = searchParams.get('returnOrderId')?.trim();
    if (!ro || !branchId) return;
    setReturnModalInitialOrderId(ro);
    setNewReturnOpen(true);
    const p = new URLSearchParams(searchParams);
    p.delete('returnOrderId');
    setSearchParams(p, { replace: true });
  }, [branchId, searchParams, setSearchParams]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenu(null);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menu]);

  const monthStart = useMemo(() => startOfMonth(new Date()).getTime(), []);

  const stats = useMemo(() => {
    const inMonth = (r: EnrichedReturn) => parseTs(r.createdAt) >= monthStart;
    const monthRows = returns.filter(inMonth);
    const totalReturnsMonth = monthRows.length;
    const totalRefundMonth = monthRows.reduce((s, r) => s + Number(r.refundAmount ?? 0), 0);
    const pendingMonth = monthRows.filter((r) => String(r.status) === 'open').length;
    const restockedUnitsMonth = monthRows.reduce((s, r) => s + Number(r.itemsRestocked ?? 0), 0);

    let soldQtyMonth = 0;
    for (const o of ordersForRate) {
      if (String((o as { status?: string }).status) !== 'completed') continue;
      if (parseTs((o as { createdAt?: string }).createdAt) < monthStart) continue;
      const rawLines = (o as { lines?: { quantity?: number }[] }).lines;
      const lines: { quantity?: number }[] = Array.isArray(rawLines) ? rawLines : [];
      soldQtyMonth += lines.reduce((a, l) => a + Number(l.quantity ?? 0), 0);
    }
    const returnedQtyMonth = monthRows.reduce((s, r) => s + Number(r.totalReturnQty ?? 0), 0);
    const returnRatePct =
      soldQtyMonth > 0
        ? Math.min(100, Math.round((returnedQtyMonth / soldQtyMonth) * 1000) / 10)
        : 0;

    return {
      totalReturnsMonth,
      totalRefundMonth,
      pendingMonth,
      restockedUnitsMonth,
      returnRatePct,
    };
  }, [returns, ordersForRate, monthStart]);

  const filteredRows = useMemo(() => {
    const inMonth = (r: EnrichedReturn) => parseTs(r.createdAt) >= monthStart;
    let rows = [...returns];

    if (statFilter === 'month') {
      rows = rows.filter(inMonth);
    } else if (statFilter === 'pending') {
      rows = rows.filter((r) => String(r.status) === 'open');
    } else if (statFilter === 'restocked') {
      rows = rows.filter(inMonth).filter((r) => Number(r.itemsRestocked ?? 0) > 0);
    } else if (statFilter === 'refunds') {
      rows = rows.filter(inMonth).sort((a, b) => Number(b.refundAmount ?? 0) - Number(a.refundAmount ?? 0));
    }

    return rows;
  }, [returns, statFilter, monthStart]);

  useEffect(() => {
    if (!selectedId) {
      setDetailRecord(null);
      return;
    }
    const row = returns.find((r) => docId(r as { _id?: string; id?: string }) === selectedId);
    if (row) setDetailRecord(row);
  }, [selectedId, returns]);

  const openOrder = (id: string) => {
    navigate({ pathname: `/sales/orders/${id}`, search: '?tab=returns' });
  };

  const printDetail = () => {
    window.print();
  };

  const statusPill = (row: EnrichedReturn) => {
    const s = String(row.status || '').toLowerCase();
    if (s === 'completed') return { label: 'Completed', cls: 'sales-returns-pill sales-returns-pill--ok' };
    if (s === 'cancelled') return { label: 'Cancelled', cls: 'sales-returns-pill sales-returns-pill--bad' };
    if (s === 'open') return { label: 'Pending', cls: 'sales-returns-pill sales-returns-pill--pending' };
    return { label: s || '—', cls: 'sales-returns-pill' };
  };

  const detailPill = detailRecord ? statusPill(detailRecord) : null;

  const filterHint = useMemo(() => {
    if (statFilter === 'all') return null;
    const labels: Record<Exclude<StatFilter, 'all'>, string> = {
      month: 'This month',
      pending: 'Pending',
      restocked: 'Restocked (this month)',
      refunds: 'Refunds (this month, by amount)',
    };
    return labels[statFilter];
  }, [statFilter]);

  if (!branchId) return <p className="sales-muted">Branch required.</p>;

  return (
    <div className="sales-returns">
      {branchId ? (
        <NewReturnModal
          open={newReturnOpen}
          onClose={() => {
            setNewReturnOpen(false);
            setReturnModalInitialOrderId(undefined);
          }}
          branchId={branchId}
          initialOrderId={returnModalInitialOrderId}
          returnsList={returns as Array<Record<string, unknown> & { originalOrderId?: unknown; lines?: unknown }>}
          onSuccess={() => load()}
        />
      ) : null}

      <div className="sales-returns__stats" role="group" aria-label="Return summary">
        <button
          type="button"
          className={`sales-returns__stat sales-returns__stat--accent-count ${statFilter === 'month' ? 'sales-returns__stat--active' : ''}`}
          onClick={() => setStatFilter((f) => (f === 'month' ? 'all' : 'month'))}
        >
          <span className="sales-returns__stat-label">Returns (this month)</span>
          <span className="sales-returns__stat-value">{stats.totalReturnsMonth}</span>
        </button>
        <button
          type="button"
          className={`sales-returns__stat sales-returns__stat--accent-refund ${statFilter === 'refunds' ? 'sales-returns__stat--active' : ''}`}
          onClick={() => setStatFilter((f) => (f === 'refunds' ? 'all' : 'refunds'))}
        >
          <span className="sales-returns__stat-label">Refund value (month)</span>
          <span className="sales-returns__stat-value">{formatInr(stats.totalRefundMonth)}</span>
        </button>
        <button
          type="button"
          className={`sales-returns__stat sales-returns__stat--accent-pending ${statFilter === 'pending' ? 'sales-returns__stat--active' : ''}`}
          onClick={() => setStatFilter((f) => (f === 'pending' ? 'all' : 'pending'))}
        >
          <span className="sales-returns__stat-label">Pending</span>
          <span className="sales-returns__stat-value">{stats.pendingMonth}</span>
        </button>
        <button
          type="button"
          className={`sales-returns__stat sales-returns__stat--accent-restock ${statFilter === 'restocked' ? 'sales-returns__stat--active' : ''}`}
          onClick={() => setStatFilter((f) => (f === 'restocked' ? 'all' : 'restocked'))}
        >
          <span className="sales-returns__stat-label">Units restocked</span>
          <span className="sales-returns__stat-value">{stats.restockedUnitsMonth}</span>
        </button>
        <button
          type="button"
          className={`sales-returns__stat sales-returns__stat--accent-rate ${statFilter === 'month' ? 'sales-returns__stat--active' : ''}`}
          onClick={() => setStatFilter((f) => (f === 'month' ? 'all' : 'month'))}
          title="Uses this month’s returns vs completed order line qty. Click to filter this month."
        >
          <span className="sales-returns__stat-label">Return rate</span>
          <span className="sales-returns__stat-value">{stats.returnRatePct}%</span>
          <span className="sales-returns__stat-hint">vs units sold this month</span>
        </button>
      </div>

      {filterHint ? (
        <p className="sales-returns__filter-hint">
          Filter: {filterHint}
          <button type="button" className="sales-returns__clear-filter" onClick={() => setStatFilter('all')}>
            Clear
          </button>
        </p>
      ) : null}

      <div className="sales-returns__split">
        <div className="sales-returns__table-wrap">
          {loading ? (
            <p className="sales-muted">Loading…</p>
          ) : (
            <div className="sales-table-wrap sales-returns__table-scroll">
              <table className="sales-table sales-returns-table">
                <thead>
                  <tr>
                    <th>Return #</th>
                    <th>Original order</th>
                    <th>Customer</th>
                    <th>Items</th>
                    <th>Reason</th>
                    <th>Refund</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="sales-muted">
                        No returns match this filter.
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((r) => {
                      const id = docId(r as { _id?: string; id?: string });
                      const pill = statusPill(r);
                      const oid = String(r.originalOrderId ?? '');
                      const active = id && selectedId === id;
                      return (
                        <tr
                          key={id || String(r.returnNumber)}
                          className={active ? 'sales-returns-table__row--active' : undefined}
                          onClick={() => id && setSelectedId(id)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setMenu({ x: e.clientX, y: e.clientY, row: r });
                          }}
                        >
                          <td>{String(r.returnNumber ?? '—')}</td>
                          <td>
                            <button
                              type="button"
                              className="sales-returns-table__link"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (oid) openOrder(oid);
                              }}
                            >
                              {String(r.orderNumber ?? (oid ? oid.slice(0, 8) : '—'))}
                            </button>
                          </td>
                          <td>{String(r.customerName ?? '—')}</td>
                          <td className="sales-returns-table__items">{String(r.itemsSummary ?? '—')}</td>
                          <td>
                            <span className="sales-returns-reason">{String(r.primaryReason ?? '—')}</span>
                          </td>
                          <td>{formatInr(Number(r.refundAmount ?? 0))}</td>
                          <td>
                            <span className={pill.cls}>{pill.label}</span>
                          </td>
                          <td>
                            {r.createdAt
                              ? new Date(String(r.createdAt)).toLocaleString('en-IN', {
                                  dateStyle: 'medium',
                                  timeStyle: 'short',
                                })
                              : '—'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside className="sales-returns__detail no-print">
          {detailRecord ? (
            <>
              <div className="sales-returns-detail__head">
                <h3>{String(detailRecord.returnNumber ?? 'Return')}</h3>
                {detailPill ? <span className={detailPill.cls}>{detailPill.label}</span> : null}
              </div>
              <dl className="sales-returns-detail__dl">
                <div>
                  <dt>Original order</dt>
                  <dd>{String(detailRecord.orderNumber ?? '—')}</dd>
                </div>
                <div>
                  <dt>Customer</dt>
                  <dd>{String(detailRecord.customerName ?? '—')}</dd>
                </div>
                <div>
                  <dt>Items</dt>
                  <dd className="sales-returns-detail__items">{String(detailRecord.itemsSummary ?? '—')}</dd>
                </div>
                <div>
                  <dt>Reason</dt>
                  <dd>{String(detailRecord.primaryReason ?? '—')}</dd>
                </div>
                <div>
                  <dt>Refund</dt>
                  <dd>{formatInr(Number(detailRecord.refundAmount ?? 0))}</dd>
                </div>
                <div>
                  <dt>Date</dt>
                  <dd>
                    {detailRecord.createdAt
                      ? new Date(String(detailRecord.createdAt)).toLocaleString('en-IN', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })
                      : '—'}
                  </dd>
                </div>
              </dl>
              <div className="sales-returns-detail__actions">
                <Button type="button" variant="secondary" onClick={printDetail}>
                  Print
                </Button>
              </div>
            </>
          ) : (
            <p className="sales-muted">Select a return to view details.</p>
          )}
        </aside>
      </div>

      {menu
        ? createPortal(
            <div
              ref={menuRef}
              className="sales-returns-ctx"
              style={{ left: menu.x, top: menu.y }}
              role="menu"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const id = docId(menu.row as { _id?: string });
                  if (id) setSelectedId(id);
                  setMenu(null);
                }}
              >
                View
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const id = docId(menu.row as { _id?: string });
                  if (id) setSelectedId(id);
                  setTimeout(() => printDetail(), 0);
                  setMenu(null);
                }}
              >
                Print
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={String(menu.row.status) !== 'open'}
                title={
                  String(menu.row.status) !== 'open'
                    ? 'Only open returns can be approved when workflow is enabled.'
                    : undefined
                }
                onClick={() => {
                  const id = docId(menu.row as { _id?: string });
                  if (id) setSelectedId(id);
                  setMenu(null);
                }}
              >
                Approve
              </button>
              <button
                type="button"
                role="menuitem"
                className="sales-returns-ctx--danger"
                disabled
                title="Removing a completed return requires inventory adjustment — not available here."
              >
                Reject / Delete
              </button>
            </div>,
            document.body
          )
        : null}
    </div>
  );
};
