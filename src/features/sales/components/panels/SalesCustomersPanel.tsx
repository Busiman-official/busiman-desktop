import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Badge, Button, Checkbox, Input, Select, Textarea } from '@/shared/components/ui';
import { EmptyState, LoadingState } from '@/shared/components/data-display';
import { SideDrawer } from '@/shared/components/modals';
import { salesService } from '@/services/sales.service';
import { docId } from '../../utils/ids';
import { extractErrorMessage } from '@/utils/error';
import type { SalesCustomer } from '@/services/sales.service';
import './SalesCustomersPanel.css';

interface Props {
  branchId: string | null;
  topSearchQuery?: string;
  topFilterSeq?: number;
  topAddSeq?: number;
}

export const SalesCustomersPanel: React.FC<Props> = ({
  branchId,
  topSearchQuery = '',
  topFilterSeq = 0,
  topAddSeq = 0,
}) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [rows, setRows] = useState<SalesCustomer[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [segmentTab] = useState<'all' | 'active' | 'vip' | 'inactive'>('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [showFilters, setShowFilters] = useState(false);
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [filterSegment, setFilterSegment] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [minSpent, setMinSpent] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<SalesCustomer | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    segment: 'regular',
    companyName: '',
    gstNumber: '',
    assignedSalesRepId: '',
    tags: '',
    notes: '',
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const effectiveStatus = useMemo(() => {
    if (segmentTab === 'active') return 'active';
    if (segmentTab === 'inactive') return 'inactive';
    return filterStatus;
  }, [segmentTab, filterStatus]);
  const effectiveSegment = useMemo(() => {
    if (segmentTab === 'vip') return 'vip';
    return filterSegment;
  }, [segmentTab, filterSegment]);

  const load = async () => {
    if (!branchId) return;
    setLoading(true);
    setError(null);
    try {
      const [list, s] = await Promise.all([
        salesService.listCustomers(branchId, {
          q: search || undefined,
          status: effectiveStatus as any,
          segment: effectiveSegment as any,
          dateFrom: filterDateFrom || undefined,
          dateTo: filterDateTo || undefined,
          minSpent: minSpent ? Number(minSpent) : undefined,
          sortBy,
          sortDir,
          page,
          pageSize,
        }),
        salesService.customerStats(branchId),
      ]);
      setRows(list.rows || []);
      setTotal(list.total || 0);
      setStats(s);
    } catch (e: unknown) {
      setError(extractErrorMessage(e, 'Failed to load customers'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [branchId, search, effectiveStatus, effectiveSegment, filterDateFrom, filterDateTo, minSpent, sortBy, sortDir, page, pageSize]);

  useEffect(() => {
    setSearch(topSearchQuery);
    setPage(1);
  }, [topSearchQuery]);

  useEffect(() => {
    if (topFilterSeq <= 0) return;
    setShowFilters((v) => !v);
  }, [topFilterSeq]);

  useEffect(() => {
    if (topAddSeq <= 0) return;
    setEditing(null);
    setForm({
      name: '',
      email: '',
      phone: '',
      segment: 'regular',
      companyName: '',
      gstNumber: '',
      assignedSalesRepId: '',
      tags: '',
      notes: '',
    });
    setFormErrors({});
    setDrawerOpen(true);
  }, [topAddSeq]);

  const validateForm = () => {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = 'Name is required';
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      next.email = 'Invalid email format';
    }
    if (form.phone.trim() && !/^[0-9+\-\s()]{7,20}$/.test(form.phone.trim())) {
      next.phone = 'Invalid phone format';
    }
    if (form.gstNumber.trim() && !/^[0-9A-Z]{15}$/.test(form.gstNumber.trim().toUpperCase())) {
      next.gstNumber = 'Invalid GST number format';
    }
    setFormErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSave = async () => {
    if (!branchId || !validateForm()) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        segment: form.segment as any,
        companyName: form.companyName.trim() || undefined,
        gstNumber: form.gstNumber.trim().toUpperCase() || undefined,
        assignedSalesRepId: form.assignedSalesRepId.trim() || undefined,
        tags: form.tags
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
        notes: form.notes.trim() || undefined,
      };
      if (editing?._id) {
        await salesService.patchCustomer(editing._id, payload, branchId);
      } else {
        await salesService.createCustomer(payload, branchId);
      }
      setDrawerOpen(false);
      setEditing(null);
      setForm({
        name: '',
        email: '',
        phone: '',
        segment: 'regular',
        companyName: '',
        gstNumber: '',
        assignedSalesRepId: '',
        tags: '',
        notes: '',
      });
      await load();
    } catch (e: unknown) {
      setError(extractErrorMessage(e, 'Failed to save customer'));
    } finally {
      setSaving(false);
    }
  };

  if (!branchId) return <p className="sales-muted">Branch required.</p>;

  const openCreate = () => {
    setEditing(null);
    setForm({
      name: '',
      email: '',
      phone: '',
      segment: 'regular',
      companyName: '',
      gstNumber: '',
      assignedSalesRepId: '',
      tags: '',
      notes: '',
    });
    setFormErrors({});
    setDrawerOpen(true);
  };

  const openEdit = (c: SalesCustomer) => {
    setEditing(c);
    setForm({
      name: c.name || '',
      email: c.email || '',
      phone: c.phone || '',
      segment: c.segment || 'regular',
      companyName: c.companyName || '',
      gstNumber: c.gstNumber || '',
      assignedSalesRepId: c.assignedSalesRepId || '',
      tags: (c.tags || []).join(', '),
      notes: c.notes || '',
    });
    setFormErrors({});
    setDrawerOpen(true);
  };

  const doExport = async (format: 'csv' | 'pdf') => {
    if (!branchId) return;
    try {
      const blob = await salesService.exportCustomers(branchId, {
        format,
        q: search || undefined,
        status: effectiveStatus,
        segment: effectiveSegment || undefined,
        dateFrom: filterDateFrom || undefined,
        dateTo: filterDateTo || undefined,
        minSpent: minSpent ? Number(minSpent) : undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `customers-${Date.now()}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(extractErrorMessage(e, 'Export failed'));
    }
  };

  const toggleSort = (field: string) => {
    if (sortBy === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir('asc');
    }
  };

  const allChecked = rows.length > 0 && rows.every((r) => selectedIds.has(r._id));
  const pageFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const pageTo = Math.min(total, page * pageSize);

  return (
    <div className="crm-customers">
      {error ? <div className="sales-panel-error">{error}</div> : null}

      <div className="crm-stats">
        <div className="crm-card"><span>Total Customers</span><strong>{stats?.totalCustomers ?? 0}</strong><em>{stats?.totalCustomersDeltaMonth ?? 0} this month</em></div>
        <div className="crm-card"><span>Active</span><strong>{stats?.activeCustomers ?? 0}</strong><em>{Number(stats?.activePercent ?? 0).toFixed(1)}%</em></div>
        <div className="crm-card"><span>VIP</span><strong>{stats?.vipCustomers ?? 0}</strong><em>AOV ₹{Number(stats?.vipAvgOrderValue ?? 0).toFixed(2)}</em></div>
        <div className="crm-card"><span>New this month</span><strong>{stats?.newCustomersThisMonth ?? 0}</strong><em>Δ {stats?.newCustomersDeltaVsLastMonth ?? 0}</em></div>
      </div>

      {showFilters ? (
        <div className="crm-filters">
          <Select
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value as any); setPage(1); }}
            options={[
              { value: 'all', label: 'All status' },
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ]}
          />
          <Select
            value={filterSegment}
            onChange={(e) => { setFilterSegment(e.target.value); setPage(1); }}
            options={[
              { value: '', label: 'All segments' },
              { value: 'regular', label: 'Regular' },
              { value: 'vip', label: 'VIP' },
              { value: 'corporate', label: 'Corporate' },
              { value: 'wholesale', label: 'Wholesale' },
            ]}
          />
          <Input type="date" value={filterDateFrom} onChange={(e) => { setFilterDateFrom(e.target.value); setPage(1); }} />
          <Input type="date" value={filterDateTo} onChange={(e) => { setFilterDateTo(e.target.value); setPage(1); }} />
          <Input
            type="number"
            placeholder="Min spend"
            value={minSpent}
            onChange={(e) => { setMinSpent(e.target.value); setPage(1); }}
          />
        </div>
      ) : null}

      {selectedIds.size > 0 ? (
        <div className="crm-bulk">
          <span>{selectedIds.size} selected</span>
          <Button variant="secondary" onClick={() => setSelectedIds(new Set())}>Clear</Button>
          <Button variant="secondary" onClick={() => void doExport('csv')}>Bulk export</Button>
          <Button variant="secondary" onClick={async () => {
            if (!branchId) return;
            const ids = Array.from(selectedIds);
            for (const id of ids) {
              await salesService.patchCustomer(id, { tags: ['tagged'] }, branchId);
            }
            setSelectedIds(new Set());
            await load();
          }}>Bulk tag</Button>
          <Button variant="danger" onClick={async () => {
            if (!branchId) return;
            const ids = Array.from(selectedIds);
            for (const id of ids) {
              await salesService.deleteCustomer(id, branchId);
            }
            setSelectedIds(new Set());
            await load();
          }}>Bulk delete</Button>
        </div>
      ) : null}

      <div className="sales-table-wrap crm-table-wrap">
        {loading ? (
          <LoadingState message="Loading customers..." />
        ) : rows.length === 0 ? (
          <EmptyState title="No customers found" message="No customers match your current search/filter." action={<Button variant="primary" onClick={openCreate}>Add first customer</Button>} />
        ) : (
        <table className="sales-table">
          <thead>
            <tr>
              <th>
                <Checkbox
                  checked={allChecked}
                  onChange={(e) => {
                    if (e.target.checked) setSelectedIds(new Set(rows.map((r) => r._id)));
                    else setSelectedIds(new Set());
                  }}
                />
              </th>
              <th onClick={() => toggleSort('name')}>Customer</th>
              <th onClick={() => toggleSort('email')}>Email</th>
              <th onClick={() => toggleSort('phone')}>Phone</th>
              <th>Segment</th>
              <th onClick={() => toggleSort('lastOrderDate')}>Last order</th>
              <th onClick={() => toggleSort('totalSpent')}>Total spent</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={docId(r as any) || String(Math.random())}>
                <td>
                  <Checkbox
                    checked={selectedIds.has(r._id)}
                    onChange={(e) => {
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(r._id);
                        else next.delete(r._id);
                        return next;
                      });
                    }}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="crm-name-btn"
                    onClick={() => {
                      const p = new URLSearchParams(searchParams);
                      if (branchId) p.set('branchId', branchId);
                      p.set('tab', 'customers');
                      navigate(`/sales/customers/${r._id}?${p.toString()}`);
                    }}
                  >
                    {r.name}
                  </button>
                  <div className="crm-sub-id">{r.customerCode}</div>
                </td>
                <td>{r.email || '-'}</td>
                <td>{r.phone || '-'}</td>
                <td>
                  <Badge
                    variant={
                      r.segment === 'vip'
                        ? 'warning'
                        : r.segment === 'corporate'
                          ? 'primary'
                          : r.segment === 'wholesale'
                            ? 'success'
                            : 'neutral'
                    }
                  >
                    {r.segment}
                  </Badge>
                </td>
                <td>{r.lastOrderDate ? new Date(r.lastOrderDate).toLocaleDateString() : '-'}</td>
                <td>₹{Number(r.totalSpent || 0).toFixed(2)}</td>
                <td>
                  <Badge variant={r.isActive ? 'success' : 'neutral'}>{r.isActive ? 'Active' : 'Inactive'}</Badge>
                </td>
                <td>
                  <div className="crm-row-actions">
                    <Button size="sm" variant="secondary" onClick={() => openEdit(r)}>Edit</Button>
                    <Button size="sm" variant="secondary" onClick={async () => {
                      if (!branchId) return;
                      await salesService.patchCustomer(r._id, { isActive: !r.isActive }, branchId);
                      await load();
                    }}>
                      {r.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </div>

      <div className="crm-pagination">
        <span>
          Showing {pageFrom}-{pageTo} of {total}
        </span>
        <Select
          value={String(pageSize)}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(1);
          }}
          options={[
            { value: '10', label: '10' },
            { value: '25', label: '25' },
            { value: '50', label: '50' },
            { value: '100', label: '100' },
          ]}
        />
        <Button variant="secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Prev</Button>
        <span>Page {page}</span>
        <Button variant="secondary" onClick={() => setPage((p) => (p * pageSize < total ? p + 1 : p))} disabled={page * pageSize >= total}>Next</Button>
      </div>

      <SideDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editing ? 'Edit customer' : 'Add customer'}
      >
        <div className="crm-drawer-form">
          <Input
            label="Full name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            error={formErrors.name}
          />
          <Input
            label="Email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            error={formErrors.email}
          />
          <Input
            label="Phone"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            error={formErrors.phone}
          />
          <Select
            label="Segment"
            value={form.segment}
            onChange={(e) => setForm((f) => ({ ...f, segment: e.target.value }))}
            options={[
              { value: 'regular', label: 'Regular' },
              { value: 'vip', label: 'VIP' },
              { value: 'corporate', label: 'Corporate' },
              { value: 'wholesale', label: 'Wholesale' },
              { value: 'government', label: 'Government' },
            ]}
          />
          <Input label="Company name" value={form.companyName} onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))} />
          <Input
            label="GST number"
            value={form.gstNumber}
            onChange={(e) => setForm((f) => ({ ...f, gstNumber: e.target.value }))}
            error={formErrors.gstNumber}
          />
          <Input
            label="Assigned sales rep"
            placeholder="User ID"
            value={form.assignedSalesRepId}
            onChange={(e) => setForm((f) => ({ ...f, assignedSalesRepId: e.target.value }))}
          />
          <Input
            label="Customer tags"
            placeholder="comma separated tags"
            value={form.tags}
            onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
          />
          <Textarea
            label="Notes"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            rows={4}
          />
          <div className="crm-drawer-actions">
            <Button variant="secondary" onClick={() => setDrawerOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={onSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
          </div>
        </div>
      </SideDrawer>
    </div>
  );
};
