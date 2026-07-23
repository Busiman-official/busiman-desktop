/**
 * Service Reports — List + Detail (desktop, list view only)
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable, type ColumnDef } from '@/shared/components/data-display/DataTable';
import { Badge, type BadgeVariant, Button, Select } from '@/shared/components/ui';
import { SideDrawer } from '@/shared/components/modals/SideDrawer';
import { employeeService } from '@/services/employee.service';
import type { User } from '@/types';
import {
  serviceReportService,
  type ServiceReport,
  type ServiceReportStatus,
  type ServiceReportStatusHistoryEntry,
  type ReasonCode,
} from '@/services/service-report.service';
import './ServiceReportsPage.css';

const STATUS_OPTIONS: { value: ServiceReportStatus | ''; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'CREATED', label: 'Created' },
  { value: 'ASSIGNED', label: 'Assigned' },
  { value: 'SCHEDULED', label: 'Scheduled' },
  { value: 'MATERIAL_ISSUED', label: 'Kit Ready' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const STATUS_LABELS: Record<ServiceReportStatus, string> = {
  CREATED: 'Created',
  ASSIGNED: 'Assigned',
  SCHEDULED: 'Scheduled',
  MATERIAL_ISSUED: 'Kit Ready',
  IN_PROGRESS: 'In Progress',
  PENDING: 'Pending',
  COMPLETED: 'Completed',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

function statusVariant(status: ServiceReportStatus): BadgeVariant {
  switch (status) {
    case 'COMPLETED':
    case 'CLOSED':
      return 'success';
    case 'PENDING':
    case 'IN_PROGRESS':
      return 'warning';
    case 'CANCELLED':
      return 'error';
    default:
      return 'primary';
  }
}

export const ServiceReportsPage: React.FC = () => {
  const [reports, setReports] = useState<ServiceReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<ServiceReportStatus | ''>('');
  const [search, setSearch] = useState('');

  const [selected, setSelected] = useState<ServiceReport | null>(null);
  const [history, setHistory] = useState<ServiceReportStatusHistoryEntry[]>([]);
  const [employees, setEmployees] = useState<User[]>([]);
  const [reasonCodes, setReasonCodes] = useState<ReasonCode[]>([]);

  const [reassignTechId, setReassignTechId] = useState('');
  const [cancelReasonId, setCancelReasonId] = useState('');
  const [cancelNote, setCancelNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await serviceReportService.list({
        status: statusFilter || undefined,
        search: search || undefined,
        limit: 100,
      });
      setReports(result.reports);
    } catch (error) {
      console.error('[ServiceReportsPage] Failed to load list', error);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    employeeService.getAllEmployees().then(setEmployees).catch(() => setEmployees([]));
    serviceReportService.getServiceReasonCodes().then(setReasonCodes).catch(() => setReasonCodes([]));
  }, []);

  const openDetail = useCallback(async (row: ServiceReport) => {
    setSelected(row);
    setReassignTechId(row.assignedTechnicianId ?? '');
    setCancelReasonId('');
    setCancelNote('');
    try {
      const h = await serviceReportService.getHistory(row.id);
      setHistory(h);
    } catch {
      setHistory([]);
    }
  }, []);

  const refreshSelected = useCallback(async (id: string) => {
    const [r, h] = await Promise.all([serviceReportService.getById(id), serviceReportService.getHistory(id)]);
    setSelected(r);
    setHistory(h);
    setReports((prev) => prev.map((row) => (row.id === id ? r : row)));
  }, []);

  const handleReassign = async () => {
    if (!selected || !reassignTechId) return;
    setBusy(true);
    try {
      await serviceReportService.assign(selected.id, reassignTechId);
      await refreshSelected(selected.id);
    } catch (error: any) {
      alert(error?.response?.data?.message || 'Failed to reassign');
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!selected || !cancelReasonId) return;
    if (!window.confirm('Cancel this job? This cannot be undone.')) return;
    setBusy(true);
    try {
      await serviceReportService.cancel(selected.id, cancelReasonId, cancelNote || undefined);
      await refreshSelected(selected.id);
    } catch (error: any) {
      alert(error?.response?.data?.message || 'Failed to cancel');
    } finally {
      setBusy(false);
    }
  };

  const handleClose = async () => {
    if (!selected) return;
    if (!window.confirm('Close this job? Confirm billing/inventory are reconciled first.')) return;
    setBusy(true);
    try {
      await serviceReportService.close(selected.id);
      await refreshSelected(selected.id);
    } catch (error: any) {
      alert(error?.response?.data?.message || 'Failed to close');
    } finally {
      setBusy(false);
    }
  };

  const columns: ColumnDef<ServiceReport>[] = useMemo(
    () => [
      { id: 'reportNumber', header: 'Job', accessor: (r) => r.reportNumber, width: 110 },
      { id: 'customer', header: 'Customer', accessor: (r) => r.customer.name },
      { id: 'type', header: 'Type', accessor: (r) => (r.type === 'ON_SITE' ? 'On-site' : 'In-office'), width: 100 },
      { id: 'technician', header: 'Technician', accessor: (r) => r.assignedTechnicianName ?? '—' },
      {
        id: 'status',
        header: 'Status',
        accessor: (r) => <Badge variant={statusVariant(r.status)}>{STATUS_LABELS[r.status]}</Badge>,
        width: 130,
      },
      {
        id: 'date',
        header: 'Date',
        accessor: (r) => (r.scheduledVisitDate ? new Date(r.scheduledVisitDate).toLocaleDateString() : '—'),
        width: 110,
      },
    ],
    []
  );

  return (
    <div className="service-reports-page">
      <div className="service-reports-header">
        <h1>Service Jobs</h1>
        <div className="service-reports-filters">
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ServiceReportStatus | '')}
            options={STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
        </div>
      </div>

      <DataTable
        data={reports}
        columns={columns}
        loading={loading}
        searchable
        searchPlaceholder="Search customer, job #, serial…"
        onSearch={setSearch}
        onRowClick={openDetail}
        selectedRowId={selected?.id}
        getRowId={(r) => r.id}
        emptyTitle="No service jobs yet"
        emptyMessage="Jobs created from reception or the mobile app will appear here."
      />

      <SideDrawer isOpen={!!selected} onClose={() => setSelected(null)} title={selected ? `Job #${selected.reportNumber}` : ''}>
        {selected ? (
          <div className="service-report-detail">
            <div className="service-report-kv">
              <span>Status</span>
              <Badge variant={statusVariant(selected.status)}>{STATUS_LABELS[selected.status]}</Badge>
            </div>
            <div className="service-report-kv">
              <span>Customer</span>
              <span>{selected.customer.name}{selected.customer.phone ? ` · ${selected.customer.phone}` : ''}</span>
            </div>
            {selected.customer.address ? (
              <div className="service-report-kv">
                <span>Address</span>
                <span>{selected.customer.address}</span>
              </div>
            ) : null}
            <div className="service-report-kv">
              <span>Type</span>
              <span>{selected.type === 'ON_SITE' ? 'On-site' : 'In-office'}</span>
            </div>
            <div className="service-report-kv">
              <span>Issue</span>
              <span>{selected.issueDescription}</span>
            </div>
            <div className="service-report-kv">
              <span>Created via</span>
              <span>{selected.source.replace('_', ' ').toLowerCase()}{selected.selfReported ? ' (self-reported)' : ''}</span>
            </div>
            <div className="service-report-kv">
              <span>Created by</span>
              <span>{selected.createdByName ?? '—'}</span>
            </div>
            {selected.reasonNote ? (
              <div className="service-report-kv">
                <span>Last note</span>
                <span>{selected.reasonNote}</span>
              </div>
            ) : null}

            <h3 className="service-report-section-title">Timeline</h3>
            <div className="service-report-timeline">
              {history.map((h) => (
                <div key={h.id} className="service-report-timeline-row">
                  · {STATUS_LABELS[h.toStatus] ?? h.toStatus} {h.changedByName ? `by ${h.changedByName}` : ''} —{' '}
                  {new Date(h.createdAt).toLocaleString()}
                </div>
              ))}
            </div>

            {selected.materialsIssued?.length ? (
              <>
                <h3 className="service-report-section-title">Materials (kit custody)</h3>
                <div className="service-report-timeline">
                  {selected.materialsIssued.map((line, idx) => (
                    <div key={`${line.itemId ?? line.itemName}-${idx}`} className="service-report-timeline-row">
                      · {line.itemName} × {line.quantity}
                      {line.custodianUserId ? ' — in employee kit' : ' — legacy issue'}
                      {line.serialNumbers?.length ? ` [${line.serialNumbers.join(', ')}]` : ''}
                    </div>
                  ))}
                </div>
                <p className="service-report-hint">
                  Reassign auto-transfers remaining unused kit stock to the new technician.
                </p>
              </>
            ) : null}

            {selected.status !== 'CLOSED' && selected.status !== 'CANCELLED' ? (
              <>
                <h3 className="service-report-section-title">Reassign</h3>
                <div className="service-report-action-row">
                  <Select
                    value={reassignTechId}
                    onChange={(e) => setReassignTechId(e.target.value)}
                    options={[{ value: '', label: 'Select technician' }, ...employees.map((e) => ({ value: e.id, label: e.name }))]}
                  />
                  <Button variant="primary" size="sm" disabled={busy || !reassignTechId} onClick={handleReassign}>
                    Reassign
                  </Button>
                </div>
              </>
            ) : null}

            {selected.status === 'COMPLETED' ? (
              <>
                <h3 className="service-report-section-title">Close job</h3>
                <p className="service-report-hint">Confirm billing and inventory are reconciled before closing.</p>
                <Button variant="primary" size="sm" disabled={busy} onClick={handleClose}>
                  Close Job
                </Button>
              </>
            ) : null}

            {selected.status !== 'CLOSED' && selected.status !== 'CANCELLED' ? (
              <>
                <h3 className="service-report-section-title">Cancel job</h3>
                <div className="service-report-action-col">
                  <Select
                    value={cancelReasonId}
                    onChange={(e) => setCancelReasonId(e.target.value)}
                    options={[{ value: '', label: 'Select reason' }, ...reasonCodes.map((r) => ({ value: r.id, label: r.name }))]}
                  />
                  <input
                    className="service-report-note-input"
                    placeholder="Optional note"
                    value={cancelNote}
                    onChange={(e) => setCancelNote(e.target.value)}
                  />
                  <Button variant="danger" size="sm" disabled={busy || !cancelReasonId} onClick={handleCancel}>
                    Cancel Job
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </SideDrawer>
    </div>
  );
};
