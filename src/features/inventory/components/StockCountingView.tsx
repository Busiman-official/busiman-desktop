/**
 * Stock Counting View - Count list, Create wizard, Enter Physical, Variance, Detail/Audit
 * Uses CountDocument + CountLine APIs. Replaces inline renderCountingView and legacy StockCounting.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  inventoryService,
  CountType,
  CountStatus,
  CountDocumentSummary,
  CountDocumentResponse,
  CreateCountRequest,
  IndustryType,
  MovementType,
} from '@/services/inventory.service';
import type { IndustryFlags, InventoryItem, Location, CountLineDto } from '@/services/inventory.service';
import { Button, Input, Card, Select } from '@/shared/components/ui';
import { LoadingState, EmptyState } from '@/shared/components/data-display';
import { extractErrorMessage } from '@/utils/error';
import { logger } from '@/shared/utils/logger';
import { ConfirmDialog, Modal } from '@/shared/components/modals';
import { Textarea } from '@/shared/components/ui';
import { NumberGrid } from './NumberGrid';
import './StockCountingView.css';

function toIndustryFlags(item: CountLineDto['item']): IndustryFlags {
  return {
    isPerishable: item?.isPerishable ?? false,
    requiresBatchTracking: item?.requiresBatchTracking ?? false,
    requiresSerialTracking: item?.requiresSerialTracking ?? false,
    hasExpiryDate: !!(item?.isPerishable && item?.requiresBatchTracking),
    isHighValue: false,
    industryType: IndustryType.WAREHOUSE,
  };
}

type ViewMode = 'list' | 'wizard' | 'enter' | 'detail';
type WizardStep = 1 | 2 | 3;

export interface StockCountingViewProps {
  onViewMovementDocument?: (movementDocumentId: string) => void;
}

export const StockCountingView: React.FC<StockCountingViewProps> = ({ onViewMovementDocument }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [counts, setCounts] = useState<CountDocumentSummary[]>([]);
  const [doc, setDoc] = useState<CountDocumentResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);

  // List filters
  const [filters, setFilters] = useState<{
    countType: string;
    status: string;
    locationId: string;
    itemId: string;
    dateFrom: string;
    dateTo: string;
  }>({ countType: '', status: '', locationId: '', itemId: '', dateFrom: '', dateTo: '' });
  const [showFilters, setShowFilters] = useState(false);
  const [highVarianceOnly, setHighVarianceOnly] = useState(false);

  // Create wizard
  const [createForm, setCreateForm] = useState<{
    countType: CountType | string;
    locationId: string;
    itemIds: string[];
    freezeMovements: boolean;
    blindCount: boolean;
  }>({
    countType: CountType.CYCLE_COUNT,
    locationId: '',
    itemIds: [],
    freezeMovements: false,
    blindCount: false,
  });
  const [scopeItems, setScopeItems] = useState<{ id: string; sku: string; name: string }[]>([]);
  const [scopeLoading, setScopeLoading] = useState(false);

  // Enter physical: line edits (lineNo -> { physicalQuantity?, varianceReason?, batchNumber?, serialNumbers?, manufacturingDate?, expiryDate? })
  type LineEditPatch = { physicalQuantity?: number; varianceReason?: string; batchNumber?: string; serialNumbers?: string[]; manufacturingDate?: string; expiryDate?: string };
  const [lineEdits, setLineEdits] = useState<Record<number, LineEditPatch>>({});
  const [bulkReason, setBulkReason] = useState('');
  const [savingLines, setSavingLines] = useState(false);

  // Collapse state for variant groups (itemIds that are collapsed)
  const [collapsedItems, setCollapsedItems] = useState<Set<string>>(new Set());
  const toggleCollapse = (itemId: string) => {
    setCollapsedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  // Dialogs
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [actionCountId, setActionCountId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [numberGridForLine, setNumberGridForLine] = useState<{ lineNo: number; tracking: 'SERIAL' | 'BATCH' } | null>(null);

  const selectedId = doc?.id ?? null;

  const loadCounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await inventoryService.listCounts({
        countType: filters.countType || undefined,
        status: filters.status || undefined,
        locationId: filters.locationId || undefined,
        itemId: filters.itemId || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
      });
      setCounts(data);
    } catch (err: any) {
      setError(extractErrorMessage(err, 'Failed to load counts'));
      logger.error('[StockCountingView] loadCounts', err);
    } finally {
      setLoading(false);
    }
  }, [filters.countType, filters.status, filters.locationId, filters.itemId, filters.dateFrom, filters.dateTo]);

  const loadDoc = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const d = await inventoryService.getCountDocument(id);
      setDoc(d);
      setLineEdits({});
      setCollapsedItems(new Set());
    } catch (err: any) {
      setError(extractErrorMessage(err, 'Failed to load count'));
      logger.error('[StockCountingView] loadDoc', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadItems = useCallback(async () => {
    try {
      const data = await inventoryService.getAllItems({ isActive: true });
      setItems(data);
    } catch (err) {
      logger.error('[StockCountingView] loadItems', err);
    }
  }, []);

  const loadLocations = useCallback(async () => {
    try {
      const data = await inventoryService.getAllLocations({ isActive: true });
      setLocations(data);
    } catch (err) {
      logger.error('[StockCountingView] loadLocations', err);
    }
  }, []);

  const loadScopeForFull = useCallback(async (locationId: string) => {
    if (!locationId) {
      setScopeItems([]);
      return;
    }
    setScopeLoading(true);
    try {
      const rows = await inventoryService.getStockByLocation(locationId);
      const byKey = new Map<string, { id: string; sku: string; name: string }>();
      for (const r of rows) {
        const key = `${r.itemId}|${r.variantId ?? ''}`;
        if (!byKey.has(key) && r.item) {
          byKey.set(key, { id: r.item.id, sku: r.item.sku, name: r.item.name });
        }
      }
      setScopeItems(Array.from(byKey.values()));
    } catch (err) {
      logger.error('[StockCountingView] loadScopeForFull', err);
      setScopeItems([]);
    } finally {
      setScopeLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
    loadLocations();
  }, [loadItems, loadLocations]);

  useEffect(() => {
    if (viewMode === 'list') loadCounts();
  }, [viewMode, loadCounts]);

  useEffect(() => {
    if (createForm.countType === CountType.FULL_COUNT && createForm.locationId) {
      loadScopeForFull(createForm.locationId);
    } else {
      setScopeItems([]);
    }
  }, [createForm.countType, createForm.locationId, loadScopeForFull]);

  const handleCreateStart = () => {
    setError(null);
    setSuccess(null);
    setCreateForm({
      countType: CountType.CYCLE_COUNT,
      locationId: '',
      itemIds: [],
      freezeMovements: false,
      blindCount: false,
    });
    setWizardStep(1);
    setViewMode('wizard');
  };

  const handleWizardNext = async () => {
    setError(null);
    if (wizardStep === 1) {
      setWizardStep(2);
      return;
    }
    if (wizardStep === 2) {
      if (!createForm.locationId) {
        setError('Location is required');
        return;
      }
      if (createForm.countType !== CountType.FULL_COUNT && (!createForm.itemIds || createForm.itemIds.length === 0)) {
        setError('At least one item is required for Cycle Count or Spot Check');
        return;
      }
      setLoading(true);
      try {
        const payload: CreateCountRequest = {
          countType: createForm.countType as CountType,
          locationId: createForm.locationId,
          itemIds: createForm.countType === CountType.FULL_COUNT ? undefined : createForm.itemIds,
          freezeMovements: createForm.freezeMovements,
          blindCount: createForm.blindCount,
        };
        const d = await inventoryService.createCount(payload);
        setDoc(d);
        setWizardStep(3);
      } catch (err: any) {
        setError(extractErrorMessage(err, 'Failed to create count'));
        logger.error('[StockCountingView] createCount', err);
      } finally {
        setLoading(false);
      }
      return;
    }
    if (wizardStep === 3) {
      if (!doc) return;
      try {
        await inventoryService.setCountRules(doc.id, {
          freezeMovements: createForm.freezeMovements,
          blindCount: createForm.blindCount,
        });
        await loadDoc(doc.id);
        setViewMode('enter');
      } catch (err: any) {
        setError(extractErrorMessage(err, 'Failed to update rules'));
      }
    }
  };

  const handleWizardBack = () => {
    if (wizardStep === 1) {
      setViewMode('list');
      return;
    }
    if (wizardStep === 2) setWizardStep(1);
    if (wizardStep === 3) setWizardStep(2);
  };

  const handleSaveLines = async () => {
    if (!doc) return;
    const lines = Object.entries(lineEdits)
      .filter(([, v]) =>
        v.physicalQuantity != null ||
        (v.varianceReason != null && v.varianceReason !== '') ||
        (v.batchNumber != null && v.batchNumber !== '') ||
        (Array.isArray(v.serialNumbers) && v.serialNumbers.length > 0) ||
        v.manufacturingDate != null ||
        v.expiryDate != null
      )
      .map(([k, v]) => ({
        lineNo: parseInt(k, 10),
        physicalQuantity: v.physicalQuantity,
        varianceReason: v.varianceReason,
        batchNumber: v.batchNumber,
        serialNumbers: v.serialNumbers,
        manufacturingDate: v.manufacturingDate,
        expiryDate: v.expiryDate,
        expectedVersion: doc.lines.find((line) => line.lineNo === parseInt(k, 10))?.lineVersion,
      }));
    if (lines.length === 0) return;
    setSavingLines(true);
    setError(null);
    try {
      const updated = await inventoryService.updateCountLines(doc.id, { lines });
      setDoc(updated);
      setLineEdits({});
      setSuccess('Lines saved');
      setTimeout(() => setSuccess(null), 2000);
    } catch (err: any) {
      const msg = extractErrorMessage(err, 'Failed to save lines');
      if (msg.toLowerCase().includes('changed by another user') || msg.toLowerCase().includes('conflict')) {
        setError('Count changed on another session. Reloaded latest data.');
        await loadDoc(doc.id);
      } else {
        setError(msg);
      }
    } finally {
      setSavingLines(false);
    }
  };

  const getLineEdit = (lineNo: number) => lineEdits[lineNo] ?? {};
  const setLineEdit = (lineNo: number, patch: Partial<LineEditPatch>) => {
    setLineEdits((prev) => {
      const next = { ...prev };
      const cur = next[lineNo] ?? {};
      next[lineNo] = { ...cur, ...patch };
      return next;
    });
  };

  const getPhysical = (line: { lineNo: number; physicalQuantity: number; physicalEntered?: boolean }) => {
    const e = getLineEdit(line.lineNo);
    if (e.physicalQuantity !== undefined) return e.physicalQuantity;
    if (line.physicalEntered) return line.physicalQuantity;
    return undefined;
  };
  const getVarianceReason = (line: { lineNo: number; varianceReason?: string }) => {
    const e = getLineEdit(line.lineNo);
    return e.varianceReason != null ? e.varianceReason : line.varianceReason ?? '';
  };
  const getBatch = (line: CountLineDto) => { const e = getLineEdit(line.lineNo); return e.batchNumber !== undefined ? e.batchNumber : (line.batchNumber ?? ''); };
  const getSerials = (line: CountLineDto) => { const e = getLineEdit(line.lineNo); return e.serialNumbers !== undefined ? e.serialNumbers : (line.serialNumbers ?? []); };
  const toDateValue = (d: string | Date | undefined) => (d ? (typeof d === 'string' ? d : new Date(d).toISOString().slice(0, 10)) : '');
  const getExpiry = (line: CountLineDto) => { const e = getLineEdit(line.lineNo); return e.expiryDate !== undefined ? e.expiryDate : toDateValue(line.expiryDate); };
  const getMfg = (line: CountLineDto) => { const e = getLineEdit(line.lineNo); return e.manufacturingDate !== undefined ? e.manufacturingDate : toDateValue(line.manufacturingDate); };

  const canSubmit = doc?.lines?.every((l) => {
    const ph = getPhysical(l);
    if (ph == null || ph < 0) return false;
    const v = ph - l.systemQuantity;
    if (v !== 0 && (getVarianceReason(l) || '').trim().length === 0) return false;
    if (v !== 0) {
      if (l.item?.requiresBatchTracking && !(getBatch(l) || '').trim()) return false;
      if (l.item?.requiresSerialTracking) { const s = getSerials(l) ?? []; if (s.length !== Math.abs(v)) return false; }
      if (l.item?.isPerishable && l.item?.requiresBatchTracking && !getExpiry(l)) return false;
    }
    return true;
  });

  const handleSubmit = async () => {
    if (!doc || !canSubmit) return;
    setError(null);
    setSuccess(null);
    try {
      const linesToFlush = (doc.lines || [])
        .map((l) => {
          const ph = getPhysical(l);
          if (ph === undefined) return null;
          const batch = (getBatch(l) || '').trim() || undefined;
          const serials = getSerials(l);
          return {
            lineNo: l.lineNo,
            physicalQuantity: ph,
            varianceReason: (getVarianceReason(l) || '').trim() || undefined,
            batchNumber: batch,
            serialNumbers: serials?.length ? serials : undefined,
            manufacturingDate: getMfg(l) || undefined,
            expiryDate: getExpiry(l) || undefined,
            expectedVersion: l.lineVersion,
          };
        })
        .filter((x): x is { lineNo: number; physicalQuantity: number; varianceReason?: string; batchNumber?: string; serialNumbers?: string[]; manufacturingDate?: string; expiryDate?: string } => x !== null && x.physicalQuantity !== undefined);
      if (linesToFlush.length > 0) {
        const updated = await inventoryService.updateCountLines(doc.id, { lines: linesToFlush });
        setDoc(updated);
      }
      const updated = await inventoryService.submitCount(doc.id);
      setDoc(updated);
      setSuccess('Count submitted');
      setViewMode('detail');
    } catch (err: any) {
      setError(extractErrorMessage(err, 'Failed to submit count'));
    }
  };

  const handleApprove = async () => {
    if (!actionCountId) return;
    setError(null);
    setSuccess(null);
    try {
      await inventoryService.approveCount(actionCountId);
      setSuccess('Count approved');
      setShowApproveDialog(false);
      setActionCountId(null);
      loadCounts();
      if (selectedId === actionCountId) {
        setViewMode('list');
        setDoc(null);
      }
    } catch (err: any) {
      setError(extractErrorMessage(err, 'Failed to approve count'));
    }
  };

  const handleReject = async () => {
    if (!actionCountId) return;
    setError(null);
    setSuccess(null);
    try {
      await inventoryService.rejectCount(actionCountId, rejectionReason || 'Rejected');
      setSuccess('Count rejected');
      setShowRejectDialog(false);
      setActionCountId(null);
      setRejectionReason('');
      loadCounts();
      if (selectedId === actionCountId) await loadDoc(actionCountId);
    } catch (err: any) {
      setError(extractErrorMessage(err, 'Failed to reject count'));
    }
  };

  const varianceClass = (v: number) =>
    v === 0 ? 'variance-zero' : v > 0 ? 'variance-positive' : 'variance-negative';

  /** Group lines by itemId for variant parent/child rendering */
  const groupLinesByItemId = (lines: CountLineDto[]): Map<string, CountLineDto[]> => {
    const m = new Map<string, CountLineDto[]>();
    for (const l of lines || []) {
      const id = l.itemId;
      if (!m.has(id)) m.set(id, []);
      m.get(id)!.push(l);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.lineNo - b.lineNo);
    return m;
  };

  const variantLabel = (l: CountLineDto) =>
    l.variant ? (l.variant.name ?? l.variant.code ?? '—') : '—';

  const handleExportCsv = () => {
    if (!doc?.lines?.length) return;
    const escape = (s: string | number) => {
      const t = String(s ?? '');
      return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const header = 'Item,Variant,System,Physical,Variance,Reason';
    const rows = doc.lines.map((l) =>
      [escape(l.item?.name ?? l.itemId), escape(variantLabel(l)), l.systemQuantity, l.physicalQuantity, l.variance, escape(l.varianceReason ?? '')].join(',')
    );
    const csv = header + '\r\n' + rows.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `count-${doc.countNumber}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const applyBulkReasonToVarianceLines = () => {
    if (!doc || !bulkReason.trim()) return;
    setLineEdits((prev) => {
      const next = { ...prev };
      for (const line of doc.lines || []) {
        const ph = getPhysical(line);
        if (ph == null) continue;
        const variance = ph - line.systemQuantity;
        if (variance !== 0) {
          next[line.lineNo] = { ...(next[line.lineNo] ?? {}), varianceReason: bulkReason.trim() };
        }
      }
      return next;
    });
  };

  // --- List ---
  const renderList = () => (
    <div className="stock-counting-view-list counting-list">
      <p className="stock-counting-view-help" title="Stock counts verify actual stock. They don't change inventory until approved.">
        Stock counts verify actual stock. They don't change inventory until approved.
      </p>
      <div className="counting-toolbar">
        <div className="stock-counting-view-filters">
          <Select
            value={filters.countType}
            onChange={(e) => setFilters({ ...filters, countType: e.target.value })}
            style={{ width: '140px' }}
          >
            <option value="">All types</option>
            {Object.values(CountType).map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
            ))}
          </Select>
          <Select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            style={{ width: '140px' }}
          >
            <option value="">All statuses</option>
            {[CountStatus.DRAFT, CountStatus.IN_PROGRESS, CountStatus.SUBMITTED, CountStatus.APPROVED, CountStatus.REJECTED].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
          <Button variant="ghost" onClick={() => setShowFilters(!showFilters)}>{showFilters ? 'Hide' : 'More'} filters</Button>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={highVarianceOnly} onChange={(e) => setHighVarianceOnly(e.target.checked)} />
            High variance only
          </label>
        </div>
        <Button variant="primary" onClick={handleCreateStart}>Create New Count</Button>
      </div>
      {showFilters && (
        <div className="stock-counting-view-filter-bar">
          <Select value={filters.locationId} onChange={(e) => setFilters({ ...filters, locationId: e.target.value })} style={{ width: '200px' }}>
            <option value="">All locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.code} – {l.name}</option>
            ))}
          </Select>
          <Select value={filters.itemId} onChange={(e) => setFilters({ ...filters, itemId: e.target.value })} style={{ width: '220px' }}>
            <option value="">All items</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>{i.sku} – {i.name}</option>
            ))}
          </Select>
          <Input type="date" value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} />
          <Input type="date" value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} />
        </div>
      )}
      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}
      {loading ? (
        <LoadingState message="Loading counts..." />
      ) : counts.length === 0 ? (
        <EmptyState message="No stock counts found" />
      ) : (
        <div className="counting-table">
          <table>
            <thead>
              <tr>
                <th>Count #</th>
                <th>Type</th>
                <th>Location</th>
                <th>Item(s)</th>
                <th>System</th>
                <th>Physical</th>
                <th>Variance</th>
                <th>Status</th>
                <th>Created by</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {counts.filter((c) => (highVarianceOnly ? Math.abs(c.variance) > 5 : true)).map((c) => {
                const handleRowDoubleClick = () => {
                  if (c.status === CountStatus.DRAFT || c.status === CountStatus.IN_PROGRESS) {
                    loadDoc(c.id);
                    setViewMode('enter');
                  } else {
                    setDoc(null);
                    loadDoc(c.id);
                    setViewMode('detail');
                  }
                };
                return (
                  <tr 
                    key={c.id} 
                    onDoubleClick={handleRowDoubleClick}
                    className="stock-counting-view-list-row"
                    title="Double-click to open"
                  >
                    <td>{c.countNumber}</td>
                    <td>{String(c.countType).replace(/_/g, ' ')}</td>
                    <td>{c.location?.code ?? '-'}</td>
                    <td>{c.itemSummary}</td>
                    <td>{c.systemQuantity}</td>
                    <td>{c.physicalQuantity}</td>
                    <td><span className={varianceClass(c.variance)}>{c.variance > 0 ? '+' : ''}{c.variance}</span></td>
                    <td><span className={`status-${String(c.status).toLowerCase()}`}>{c.status}</span></td>
                    <td>{c.createdBy?.name ?? '-'}</td>
                    <td>{new Date(c.createdAt).toLocaleDateString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  // --- Wizard ---
  const renderWizard = () => (
    <Card className="counting-form stock-counting-view-wizard">
      <h2>Create Count – Step {wizardStep}</h2>
      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      {wizardStep === 1 && (
        <>
          <p className="form-hint" title="Cycle Count for daily checks. Full Count for audits. Spot Check for quick verification.">Cycle Count for daily checks. Full Count for audits. Spot Check for quick verification.</p>
          <div className="form-group">
            <label>Count type *</label>
            <div className="stock-counting-view-type-cards">
              {[CountType.CYCLE_COUNT, CountType.FULL_COUNT, CountType.SPOT_CHECK].map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`stock-counting-view-type-card ${createForm.countType === t ? 'active' : ''}`}
                  onClick={() => setCreateForm({ ...createForm, countType: t })}
                >
                  {t.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {wizardStep === 2 && (
        <>
          <p className="form-hint">This is the system's current stock before physical verification.</p>
          <div className="form-group">
            <label>Location *</label>
            <Select value={createForm.locationId} onChange={(e) => setCreateForm({ ...createForm, locationId: e.target.value })} style={{ width: '100%' }}>
              <option value="">Select location</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.code} – {l.name}</option>
              ))}
            </Select>
          </div>
          {createForm.countType === CountType.FULL_COUNT ? (
            <div className="form-group">
              <label>Items</label>
              <div className="form-hint">
                {scopeLoading ? 'Loading…' : `All at location (${scopeItems.length} item–variant combinations)`}
              </div>
            </div>
          ) : (
            <div className="form-group">
              <label>Items * (at least one)</label>
              <p className="form-hint">Items with variants will be expanded into one row per variant at Enter Physical.</p>
              <Select
                multiple
                value={createForm.itemIds}
                onChange={(e) => {
                  const sel = Array.from(e.target.selectedOptions, (o) => o.value);
                  setCreateForm({ ...createForm, itemIds: sel });
                }}
                style={{ width: '100%', minHeight: 120 }}
              >
                {items.map((i) => (
                  <option key={i.id} value={i.id}>{i.sku} – {i.name}{i.hasVariants ? ' (Variants)' : ''}</option>
                ))}
              </Select>
            </div>
          )}
        </>
      )}

      {wizardStep === 3 && (
        <>
          <p className="form-hint">Blind counts reduce bias during audits.</p>
          <div className="form-group">
            <label>
              <input type="checkbox" checked={createForm.freezeMovements} onChange={(e) => setCreateForm({ ...createForm, freezeMovements: e.target.checked })} />
              Freeze movements during count
            </label>
          </div>
          <div className="form-group">
            <label>
              <input type="checkbox" checked={createForm.blindCount} onChange={(e) => setCreateForm({ ...createForm, blindCount: e.target.checked })} />
              Blind count (hide system qty until physical entered)
            </label>
          </div>
        </>
      )}

      <div className="form-actions">
        <Button variant="secondary" onClick={handleWizardBack}>Back</Button>
        <Button variant="primary" onClick={handleWizardNext} disabled={loading}>
          {wizardStep === 3 ? 'Go to Enter Physical' : 'Next'}
        </Button>
      </div>
    </Card>
  );

  // --- Enter Physical ---
  const renderEnter = () => {
    if (!doc) return <LoadingState message="Loading…" />;
    const blind = doc.blindCount;
    return (
      <Card className="stock-counting-view-enter counting-details">
        <div className="details-header">
          <h2>Enter Physical – {doc.countNumber}</h2>
          <div className="details-actions">
            <Button variant="secondary" onClick={() => setViewMode('list')}>Back to list</Button>
            <Button variant="ghost" onClick={handleSaveLines} disabled={savingLines}>Save</Button>
            <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit}>Submit</Button>
          </div>
        </div>
        <p className="form-hint">Enter what you physically see. For lines with a difference, a variance reason is required.</p>
        <p className="form-hint">If an item has variants, count is required per variant. Variants represent unique versions of this item. Each variant has its own stock.</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <Input value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} placeholder="Bulk variance reason" />
          <Button variant="ghost" onClick={applyBulkReasonToVarianceLines}>Apply to all variance lines</Button>
        </div>
        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">{success}</div>}
        <div className="counting-table">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th title="Variant-level counting is mandatory for variant items; product-level adjustment is never allowed.">Variant</th>
                {!blind && <th>System</th>}
                <th>Physical</th>
                <th>Variance</th>
                <th>Variance reason</th>
                <th title="Required for batch-tracked items when there is a variance">Batch</th>
                <th title="Required for perishable batch-tracked items when there is a variance">Expiry</th>
                <th title="For serial-tracked items: enter one serial per unit of variance">Serials</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(groupLinesByItemId(doc.lines || []).entries()).map(([itemId, lines]) => {
                const first = lines[0];
                const hasVariants = first?.item?.hasVariants === true;
                const isVariantGroup = hasVariants && lines.length > 1;
                const collapsed = collapsedItems.has(itemId);

                if (isVariantGroup) {
                  return (
                    <React.Fragment key={itemId}>
                      <tr
                        className="stock-counting-view-parent-row"
                        onClick={() => toggleCollapse(itemId)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCollapse(itemId); } }}
                      >
                        <td><span className="stock-counting-view-chevron">{collapsed ? '▸' : '▾'}</span> {first?.item?.name ?? itemId}</td>
                        <td>{lines.length} variants</td>
                        {!blind && <td>—</td>}
                        <td colSpan={6}>—</td>
                      </tr>
                      {!collapsed && lines.map((l) => {
                        const ph = getPhysical(l);
                        const v = ph != null ? ph - l.systemQuantity : 0;
                        const needReason = v !== 0;
                        return (
                          <tr key={l.id} className="stock-counting-view-child-row">
                            <td className="stock-counting-view-indent"></td>
                            <td>{variantLabel(l)}</td>
                            {!blind && <td>{l.systemQuantity}</td>}
                            <td>
                              <Input
                                type="number"
                                min={0}
                                step={1}
                                value={ph ?? ''}
                                onChange={(e) => setLineEdit(l.lineNo, { physicalQuantity: e.target.value === '' ? undefined : Number(e.target.value) })}
                                onBlur={() => { if (Object.keys(lineEdits).length > 0) handleSaveLines(); }}
                              />
                            </td>
                            <td>{ph != null ? <span className={varianceClass(v)}>{v > 0 ? '+' : ''}{v}</span> : '—'}</td>
                            <td>
                              <Input
                                value={getVarianceReason(l)}
                                onChange={(e) => setLineEdit(l.lineNo, { varianceReason: e.target.value })}
                                placeholder={needReason ? 'Required' : 'Optional'}
                                onBlur={() => { if (Object.keys(lineEdits).length > 0) handleSaveLines(); }}
                              />
                            </td>
                            <td>
                              {l.item?.requiresBatchTracking ? (
                                v !== 0 ? (
                                  <span className="stock-counting-view-tracking-cell">
                                    <Button variant="ghost" size="sm" onClick={() => setNumberGridForLine({ lineNo: l.lineNo, tracking: 'BATCH' })}>Enter batch</Button>
                                    {(getBatch(l) || '').trim() ? <span className="stock-counting-view-tracking-summary">{(getBatch(l) || '').trim()}</span> : null}
                                  </span>
                                ) : '—'
                              ) : '—'}
                            </td>
                            <td>
                              {l.item?.isPerishable && l.item?.requiresBatchTracking ? (v !== 0 ? (getExpiry(l) || '—') : '—') : '—'}
                            </td>
                            <td>
                              {l.item?.requiresSerialTracking ? (
                                v !== 0 ? (
                                  <span className="stock-counting-view-tracking-cell">
                                    <Button variant="ghost" size="sm" onClick={() => setNumberGridForLine({ lineNo: l.lineNo, tracking: 'SERIAL' })}>Enter serials</Button>
                                    {getSerials(l).length > 0 ? <span className="stock-counting-view-tracking-summary">{getSerials(l).length} serials</span> : null}
                                  </span>
                                ) : '—'
                              ) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                }

                return lines.map((l) => {
                  const ph = getPhysical(l);
                  const v = ph != null ? ph - l.systemQuantity : 0;
                  const needReason = v !== 0;
                  return (
                    <tr key={l.id}>
                      <td>{l.item?.name ?? l.itemId}</td>
                      <td>{variantLabel(l)}</td>
                      {!blind && <td>{l.systemQuantity}</td>}
                      <td>
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          value={ph ?? ''}
                          onChange={(e) => setLineEdit(l.lineNo, { physicalQuantity: e.target.value === '' ? undefined : Number(e.target.value) })}
                          onBlur={() => { if (Object.keys(lineEdits).length > 0) handleSaveLines(); }}
                        />
                      </td>
                      <td>{ph != null ? <span className={varianceClass(v)}>{v > 0 ? '+' : ''}{v}</span> : '—'}</td>
                      <td>
                        <Input
                          value={getVarianceReason(l)}
                          onChange={(e) => setLineEdit(l.lineNo, { varianceReason: e.target.value })}
                          placeholder={needReason ? 'Required' : 'Optional'}
                          onBlur={() => { if (Object.keys(lineEdits).length > 0) handleSaveLines(); }}
                        />
                      </td>
                      <td>
                        {l.item?.requiresBatchTracking ? (
                          v !== 0 ? (
                            <span className="stock-counting-view-tracking-cell">
                              <Button variant="ghost" size="sm" onClick={() => setNumberGridForLine({ lineNo: l.lineNo, tracking: 'BATCH' })}>Enter batch</Button>
                              {(getBatch(l) || '').trim() ? <span className="stock-counting-view-tracking-summary">{(getBatch(l) || '').trim()}</span> : null}
                            </span>
                          ) : '—'
                        ) : '—'}
                      </td>
                      <td>
                        {l.item?.isPerishable && l.item?.requiresBatchTracking ? (v !== 0 ? (getExpiry(l) || '—') : '—') : '—'}
                      </td>
                      <td>
                        {l.item?.requiresSerialTracking ? (
                          v !== 0 ? (
                            <span className="stock-counting-view-tracking-cell">
                              <Button variant="ghost" size="sm" onClick={() => setNumberGridForLine({ lineNo: l.lineNo, tracking: 'SERIAL' })}>Enter serials</Button>
                              {getSerials(l).length > 0 ? <span className="stock-counting-view-tracking-summary">{getSerials(l).length} serials</span> : null}
                            </span>
                          ) : '—'
                        ) : '—'}
                      </td>
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
      </Card>
    );
  };

  // --- Detail / Audit ---
  const renderDetail = () => {
    if (!doc) return <LoadingState message="Loading…" />;
    const canEdit = doc.status === CountStatus.DRAFT || doc.status === CountStatus.IN_PROGRESS;
    return (
      <Card className="counting-details stock-counting-view-detail">
        <div className="details-header">
          <h2>Count {doc.countNumber}</h2>
          <div className="details-actions">
            <Button variant="secondary" onClick={() => { setDoc(null); setViewMode('list'); }}>Back to list</Button>
            {canEdit && <Button variant="primary" onClick={() => setViewMode('enter')}>Enter Physical</Button>}
            {doc.status === CountStatus.SUBMITTED && (
              <>
                <Button variant="primary" onClick={() => { setActionCountId(doc.id); setShowApproveDialog(true); }}>Approve</Button>
                <Button variant="danger" onClick={() => { setActionCountId(doc.id); setRejectionReason(''); setShowRejectDialog(true); }}>Reject</Button>
              </>
            )}
            {doc.adjustmentMovementDocumentId && onViewMovementDocument && (
              <Button variant="ghost" onClick={() => onViewMovementDocument(doc.adjustmentMovementDocumentId!)}>View Adjustment</Button>
            )}
            <Button variant="ghost" onClick={handleExportCsv} disabled={!doc.lines?.length}>Export CSV</Button>
          </div>
        </div>
        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">{success}</div>}
        <div className="details-content">
          <div className="details-section">
            <h3>Document</h3>
            <div className="details-grid">
              <div><label>Count #</label><div>{doc.countNumber}</div></div>
              <div><label>Type</label><div>{String(doc.countType).replace(/_/g, ' ')}</div></div>
              <div><label>Status</label><div><span className={`status-${String(doc.status).toLowerCase()}`}>{doc.status}</span></div></div>
              <div><label>Location</label><div>{doc.location ? `${doc.location.code} – ${doc.location.name}` : doc.locationId}</div></div>
              <div><label>Created by</label><div>{doc.createdBy?.name ?? '-'}</div></div>
              <div><label>Created</label><div>{doc.createdAt ? new Date(doc.createdAt).toLocaleString() : '-'}</div></div>
              {doc.submittedAt && <div><label>Submitted</label><div>{new Date(doc.submittedAt).toLocaleString()}</div></div>}
              {doc.approvedAt && <div><label>Approved</label><div>{new Date(doc.approvedAt).toLocaleString()} by {doc.approvedBy?.name}</div></div>}
              {doc.rejectedAt && <div><label>Rejected</label><div>{new Date(doc.rejectedAt).toLocaleString()} – {doc.rejectionReason}</div></div>}
            </div>
          </div>
          <div className="details-section">
            <h3>Lines</h3>
            <div className="counting-table">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th title="Variant-level counting is mandatory for variant items; product-level adjustment is never allowed.">Variant</th>
                    <th>System</th>
                    <th>Physical</th>
                    <th>Variance</th>
                    <th>Reason</th>
                    <th>Batch</th>
                    <th>Expiry</th>
                    <th>Serials</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(groupLinesByItemId(doc.lines || []).entries()).map(([itemId, lines]) => {
                    const first = lines[0];
                    const hasVariants = first?.item?.hasVariants === true;
                    const isVariantGroup = hasVariants && lines.length > 1;
                    const collapsed = collapsedItems.has(itemId);

                    if (isVariantGroup) {
                      return (
                        <React.Fragment key={itemId}>
                          <tr
                            className="stock-counting-view-parent-row"
                            onClick={() => toggleCollapse(itemId)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCollapse(itemId); } }}
                          >
                            <td><span className="stock-counting-view-chevron">{collapsed ? '▸' : '▾'}</span> {first?.item?.name ?? itemId}</td>
                            <td>{lines.length} variants</td>
                            <td>—</td>
                            <td colSpan={6}>—</td>
                          </tr>
                          {!collapsed && lines.map((l) => (
                            <tr key={l.id} className="stock-counting-view-child-row">
                              <td className="stock-counting-view-indent"></td>
                              <td>{variantLabel(l)}</td>
                              <td>{l.systemQuantity}</td>
                              <td>{l.physicalQuantity}</td>
                              <td><span className={varianceClass(l.variance)}>{l.variance > 0 ? '+' : ''}{l.variance}</span></td>
                              <td>{l.varianceReason ?? '—'}</td>
                              <td>{l.batchNumber ?? '—'}</td>
                              <td>{l.expiryDate ? new Date(l.expiryDate).toLocaleDateString() : '—'}</td>
                              <td>{l.serialNumbers?.length ? l.serialNumbers.join(', ') : '—'}</td>
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    }

                    return lines.map((l) => (
                      <tr key={l.id}>
                        <td>{l.item?.name ?? l.itemId}</td>
                        <td>{variantLabel(l)}</td>
                        <td>{l.systemQuantity}</td>
                        <td>{l.physicalQuantity}</td>
                        <td><span className={varianceClass(l.variance)}>{l.variance > 0 ? '+' : ''}{l.variance}</span></td>
                        <td>{l.varianceReason ?? '—'}</td>
                        <td>{l.batchNumber ?? '—'}</td>
                        <td>{l.expiryDate ? new Date(l.expiryDate).toLocaleDateString() : '—'}</td>
                        <td>{l.serialNumbers?.length ? l.serialNumbers.join(', ') : '—'}</td>
                      </tr>
                    ));
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Card>
    );
  };

  const ngLineForGrid = numberGridForLine && doc ? doc.lines?.find((x) => x.lineNo === numberGridForLine.lineNo) : undefined;

  return (
    <div className="stock-counting-view">
      {viewMode === 'list' && renderList()}
      {viewMode === 'wizard' && renderWizard()}
      {viewMode === 'enter' && renderEnter()}
      {viewMode === 'detail' && renderDetail()}

      {ngLineForGrid && numberGridForLine && doc && (() => {
        const ph = getPhysical(ngLineForGrid);
        const v = (ph ?? ngLineForGrid.systemQuantity) - ngLineForGrid.systemQuantity;
        const expectedQty = Math.abs(v) || 1;
        return (
          <NumberGrid
            key={`ng-${numberGridForLine.lineNo}-${numberGridForLine.tracking}`}
            isOpen
            mode="INPUT"
            trackingType={numberGridForLine.tracking}
            movementType={MovementType.COUNT_ADJUSTMENT}
            itemId={ngLineForGrid.itemId}
            variantId={ngLineForGrid.variantId}
            expectedQuantity={expectedQty}
            initialSerialNumbers={numberGridForLine.tracking === 'SERIAL' ? getSerials(ngLineForGrid) : []}
            initialBatchRows={numberGridForLine.tracking === 'BATCH' ? [{ batchCode: getBatch(ngLineForGrid) || '', quantity: expectedQty, manufacturingDate: getMfg(ngLineForGrid) || '', expiryDate: getExpiry(ngLineForGrid) || '' }] : []}
            existingSerialsInDoc={[]}
            allowOverReceive={false}
            allowPartial={false}
            industryFlags={toIndustryFlags(ngLineForGrid.item)}
            fetchAvailableForBatch={undefined}
            locationId={doc.locationId}
            fromLocationId={numberGridForLine.tracking === 'SERIAL' ? (v < 0 ? doc.locationId : undefined) : undefined}
            toLocationId={undefined}
            singleBatchMode={numberGridForLine.tracking === 'BATCH'}
            onApply={(result) => {
              if (numberGridForLine.tracking === 'SERIAL') {
                setLineEdit(numberGridForLine.lineNo, { serialNumbers: result.finalSerialList });
              } else {
                setLineEdit(numberGridForLine.lineNo, {
                  batchNumber: result.finalBatchList[0]?.batchCode || undefined,
                  manufacturingDate: result.finalBatchList[0]?.manufacturingDate || undefined,
                  expiryDate: result.finalBatchList[0]?.expiryDate || undefined,
                });
              }
              setNumberGridForLine(null);
            }}
            onCancel={() => setNumberGridForLine(null)}
          />
        );
      })()}

      <ConfirmDialog
        isOpen={showApproveDialog}
        title="Approve count"
        message="Approve this count? A COUNT_ADJUSTMENT movement will be created for variances. Stock will be updated."
        onConfirm={handleApprove}
        onCancel={() => { setShowApproveDialog(false); setActionCountId(null); }}
        variant="info"
      />
      <Modal
        isOpen={showRejectDialog}
        onClose={() => { setShowRejectDialog(false); setActionCountId(null); setRejectionReason(''); }}
        title="Reject count"
        size="md"
      >
        <div className="confirm-dialog">
          <p>Rejecting returns the count to Draft so physical quantities can be edited. Optionally provide a reason.</p>
          <div className="form-group" style={{ marginTop: 16 }}>
            <Textarea
              label="Rejection reason (optional)"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="e.g. Need to re-verify on site"
              rows={3}
            />
          </div>
          <div className="form-actions" style={{ marginTop: 16 }}>
            <Button variant="secondary" onClick={() => { setShowRejectDialog(false); setActionCountId(null); setRejectionReason(''); }}>Cancel</Button>
            <Button variant="danger" onClick={handleReject}>Reject</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
