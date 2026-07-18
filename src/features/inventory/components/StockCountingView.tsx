/**
 * Stock Counting View - Count list, Create wizard, Enter Physical, Variance, Detail/Audit
 * Uses CountDocument + CountLine APIs. Replaces inline renderCountingView and legacy StockCounting.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import { authStore } from '@/store/authStore';
import { canApproveCount, canDeleteCount, canSelfApproveCount } from '../utils/countPermissions';
import './StockCountingView.css';

type CountSegment = 'to_do' | 'to_approve' | 'pending' | 'done';

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
  type LineEditPatch = { physicalQuantity?: number; varianceReason?: string; batchNumber?: string; serialNumbers?: string[]; serialAttributes?: Record<string, Record<string, any>>; manufacturingDate?: string; expiryDate?: string };
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
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [segment, setSegment] = useState<CountSegment>('to_do');
  const [actionCountId, setActionCountId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [numberGridForLine, setNumberGridForLine] = useState<{ lineNo: number; tracking: 'SERIAL' | 'BATCH' } | null>(null);
  const approverDefaultSegmentChecked = useRef(false);
  const [hasPendingCounts, setHasPendingCounts] = useState<boolean | null>(null);

  const user = authStore((s) => s.user);
  const selectedId = doc?.id ?? null;

  const loadCounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    const baseFilters = {
      countType: filters.countType || undefined,
      locationId: filters.locationId || undefined,
      itemId: filters.itemId || undefined,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
    };
    try {
      const toList = (raw: unknown): CountDocumentSummary[] =>
        Array.isArray(raw) ? raw.filter((x): x is CountDocumentSummary => x != null && typeof x === 'object') : [];
      const sortByCreated = (list: CountDocumentSummary[]) =>
        list.sort(
          (a, b) =>
            new Date(b?.createdAt ?? 0).getTime() - new Date(a?.createdAt ?? 0).getTime()
        );
      if (segment === 'to_do') {
        const [draft, inProgress] = await Promise.all([
          inventoryService.listCounts({ ...baseFilters, status: CountStatus.DRAFT }),
          inventoryService.listCounts({ ...baseFilters, status: CountStatus.IN_PROGRESS }),
        ]);
        setCounts(sortByCreated([...toList(draft), ...toList(inProgress)]));
      } else if (segment === 'to_approve') {
        const data = await inventoryService.listCounts({ ...baseFilters, status: CountStatus.SUBMITTED });
        setCounts(sortByCreated(toList(data)));
      } else if (segment === 'pending') {
        const data = await inventoryService.listCounts({ ...baseFilters, status: CountStatus.SUBMITTED, submittedByMe: true });
        const list = sortByCreated(toList(data));
        setCounts(list);
        if (list.length === 0) {
          setHasPendingCounts(false);
          setSegment('to_do');
        }
      } else {
        const [approved, rejected] = await Promise.all([
          inventoryService.listCounts({ ...baseFilters, status: CountStatus.APPROVED }),
          inventoryService.listCounts({ ...baseFilters, status: CountStatus.REJECTED }),
        ]);
        setCounts(sortByCreated([...toList(approved), ...toList(rejected)]));
      }
    } catch (err: any) {
      setError(extractErrorMessage(err, 'Failed to load counts'));
      logger.error('[StockCountingView] loadCounts', err);
    } finally {
      setLoading(false);
    }
  }, [segment, filters.countType, filters.locationId, filters.itemId, filters.dateFrom, filters.dateTo]);

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
          byKey.set(key, {
            id: r.item.id,
            sku: r.variant?.code || r.item.sku || "—",
            name: r.item.name,
          });
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

  const handleSaveLines = async (redirectToList?: boolean) => {
    if (!doc) return;
    const lines = Object.entries(lineEdits)
      .filter(([, v]) =>
        v.physicalQuantity != null ||
        (v.varianceReason != null && v.varianceReason !== '') ||
        (v.batchNumber != null && v.batchNumber !== '') ||
        (Array.isArray(v.serialNumbers) && v.serialNumbers.length > 0) ||
        (v.serialAttributes != null && Object.keys(v.serialAttributes).length > 0) ||
        v.manufacturingDate != null ||
        v.expiryDate != null
      )
      .map(([k, v]) => {
        const lineNo = parseInt(k, 10);
        if (Number.isNaN(lineNo)) return null;
        const serverLine = doc.lines?.find((line) => line.lineNo === lineNo);
        const out: { lineNo: number; physicalQuantity?: number; varianceReason?: string; batchNumber?: string; serialNumbers?: string[]; serialAttributes?: Record<string, Record<string, any>>; manufacturingDate?: string; expiryDate?: string; expectedVersion?: number } = { lineNo };
        if (v.physicalQuantity != null) out.physicalQuantity = v.physicalQuantity;
        if (v.varianceReason != null && v.varianceReason !== '') out.varianceReason = v.varianceReason;
        if (v.batchNumber != null && v.batchNumber !== '') out.batchNumber = v.batchNumber;
        if (Array.isArray(v.serialNumbers) && v.serialNumbers.length > 0) out.serialNumbers = v.serialNumbers;
        if (v.serialAttributes != null && Object.keys(v.serialAttributes).length > 0) out.serialAttributes = v.serialAttributes;
        if (v.manufacturingDate != null) out.manufacturingDate = v.manufacturingDate;
        if (v.expiryDate != null) out.expiryDate = v.expiryDate;
        if (serverLine?.lineVersion != null) out.expectedVersion = serverLine.lineVersion;
        return out;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (lines.length === 0) {
      setSuccess('No changes to save');
      setTimeout(() => setSuccess(null), 2500);
      return;
    }
    setSavingLines(true);
    setError(null);
    try {
      const updated = await inventoryService.updateCountLines(doc.id, { lines });
      setDoc(updated);
      setLineEdits({});
      setSuccess('Lines saved');
      setTimeout(() => setSuccess(null), 2000);
      if (redirectToList) {
        setDoc(null);
        setViewMode('list');
        loadCounts();
      }
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
  const getSerialAttributes = (line: CountLineDto) => { const e = getLineEdit(line.lineNo); return e.serialAttributes !== undefined ? e.serialAttributes : line.serialAttributes; };
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
          const serialAttrs = getSerialAttributes(l);
          return {
            lineNo: l.lineNo,
            physicalQuantity: ph,
            varianceReason: (getVarianceReason(l) || '').trim() || undefined,
            batchNumber: batch,
            serialNumbers: serials?.length ? serials : undefined,
            serialAttributes: serialAttrs && Object.keys(serialAttrs).length > 0 ? serialAttrs : undefined,
            manufacturingDate: getMfg(l) || undefined,
            expiryDate: getExpiry(l) || undefined,
            expectedVersion: l.lineVersion,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null && x.physicalQuantity !== undefined);
      if (linesToFlush.length > 0) {
        const updated = await inventoryService.updateCountLines(doc.id, { lines: linesToFlush });
        setDoc(updated);
      }
      const updated = await inventoryService.submitCount(doc.id);
      setDoc(updated);
      setSuccess('Count submitted');
      setDoc(null);
      setViewMode('list');
      loadCounts();
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

  const handleDelete = async () => {
    if (!actionCountId || !user) return;
    setError(null);
    setSuccess(null);
    try {
      await inventoryService.deleteCount(actionCountId);
      setSuccess('Count deleted');
      setShowDeleteDialog(false);
      setActionCountId(null);
      if (doc?.id === actionCountId) {
        setDoc(null);
        setViewMode('list');
      }
      loadCounts();
    } catch (err: any) {
      setError(extractErrorMessage(err, "You don't have permission to delete this count."));
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

  /** System column: show (current stock − system at count) with tooltip when current is available */
  const formatSystemCell = (current: number | undefined, systemAtCount: number) => {
    const sys = systemAtCount ?? 0;
    if (current === undefined || current === null) {
      return { text: String(sys), tooltip: 'System stock at time of count.' };
    }
    const tooltip = 'Current stock − system at count';
    return { text: `${current} − ${sys}`, tooltip };
  };

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

  const canApprove = user ? canApproveCount(user?.role ?? '') : false;

  // For non-approvers (employees): check if they have any counts pending approval (optimized: limit 1)
  useEffect(() => {
    if (viewMode !== 'list' || canApprove || !user) return;
    let cancelled = false;
    inventoryService.listCounts({ status: CountStatus.SUBMITTED, submittedByMe: true, limit: 1 }).then((list) => {
      if (!cancelled) setHasPendingCounts(Array.isArray(list) && list.length > 0);
    }).catch(() => {
      if (!cancelled) setHasPendingCounts(false);
    });
    return () => { cancelled = true; };
  }, [viewMode, canApprove, user]);

  // Default segment for approvers: "To approve" when it has items (plan 2.1)
  useEffect(() => {
    if (!canApprove || approverDefaultSegmentChecked.current) return;
    approverDefaultSegmentChecked.current = true;
    inventoryService.listCounts({ status: CountStatus.SUBMITTED }).then((list) => {
      if (Array.isArray(list) && list.length > 0) setSegment('to_approve');
    }).catch(() => { });
  }, [canApprove]);

  const emptyMessage =
    segment === 'to_do'
      ? 'No counts in progress. Start a new count.'
      : segment === 'to_approve'
        ? 'No counts waiting for approval.'
        : segment === 'pending'
          ? 'No counts pending approval.'
          : 'No completed counts';

  // --- List ---
  const renderList = () => (
    <div className="stock-counting-view-list counting-list">
      <div className="counting-toolbar">
        <div className="stock-counting-view-segments" style={{ display: 'flex', justifyContent: 'space-between', gap: 4, marginBottom: 8 }}>
          <div className="stock-counting-view-filters-container" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div className="stock-counting-view-filters">
              <Select
                value={filters.countType ?? ''}
                onChange={(e) => setFilters({ ...filters, countType: e.target.value })}
                style={{ width: '140px' }}
              >
                <option value="">All types</option>
                {Object.values(CountType).map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                ))}
              </Select>
              <Button variant="ghost" onClick={() => setShowFilters(!showFilters)}>{showFilters ? 'Hide' : 'More'} filters</Button>

            </div>
            {locations.length > 0 ? (
              <Button variant="primary" onClick={handleCreateStart}>Create New Count</Button>
            ) : (
              <span style={{ fontSize: 12, color: '#666' }}>No locations in scope</span>
            )}
          </div>
          <div className="stock-counting-view-segments-container" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={highVarianceOnly} onChange={(e) => setHighVarianceOnly(e.target.checked)} />
              High variance only
            </label>
            <button
              type="button"
              className={segment === 'to_do' ? 'active' : ''}
              style={{
                padding: '6px 12px',
                border: '1px solid #ccc',
                borderRadius: 4,
                background: segment === 'to_do' ? '#e0e0e0' : 'transparent',
                cursor: 'pointer',
              }}
              onClick={() => setSegment('to_do')}
            >
              To do
            </button>
            {canApprove && (
              <button
                type="button"
                className={segment === 'to_approve' ? 'active' : ''}
                style={{
                  padding: '6px 12px',
                  border: '1px solid #ccc',
                  borderRadius: 4,
                  background: segment === 'to_approve' ? '#e0e0e0' : 'transparent',
                  cursor: 'pointer',
                }}
                onClick={() => setSegment('to_approve')}
              >
                To approve
              </button>
            )}
            {!canApprove && hasPendingCounts === true && (
              <button
                type="button"
                className={segment === 'pending' ? 'active' : ''}
                style={{
                  padding: '6px 12px',
                  border: '1px solid #ccc',
                  borderRadius: 4,
                  background: segment === 'pending' ? '#e0e0e0' : 'transparent',
                  cursor: 'pointer',
                }}
                onClick={() => setSegment('pending')}
                title="Counts you submitted, waiting for approval"
              >
                Pending
              </button>
            )}
            <button
              type="button"
              className={segment === 'done' ? 'active' : ''}
              style={{
                padding: '6px 12px',
                border: '1px solid #ccc',
                borderRadius: 4,
                background: segment === 'done' ? '#e0e0e0' : 'transparent',
                cursor: 'pointer',
              }}
              onClick={() => setSegment('done')}
            >
              Done
            </button>
          </div>
        </div>

      </div>
      {showFilters && (
        <div className="stock-counting-view-filter-bar">
          <Select value={filters.locationId ?? ''} onChange={(e) => setFilters({ ...filters, locationId: e.target.value })} style={{ width: '200px' }}>
            <option value="">All locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.code} – {l.name}</option>
            ))}
          </Select>
          <Select value={filters.itemId ?? ''} onChange={(e) => setFilters({ ...filters, itemId: e.target.value })} style={{ width: '220px' }}>
            <option value="">All items</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>{i.sku} – {i.name}</option>
            ))}
          </Select>
          <Input type="date" value={filters.dateFrom ?? ''} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} />
          <Input type="date" value={filters.dateTo ?? ''} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} />
        </div>
      )}
      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}
      {loading ? (
        <LoadingState message="Loading counts..." />
      ) : counts.length === 0 ? (
        <EmptyState
          message={emptyMessage}
          action={segment === 'to_do' ? <Button variant="primary" onClick={handleCreateStart}>New count</Button> : undefined}
        />
      ) : (
        <div className="counting-table">
          <table>
            <thead>
              <tr>
                <th>Count #</th>
                <th>Type</th>
                <th>Location</th>
                <th>Item(s)</th>
                <th title="Current stock − system at count (hover cell for details)">System</th>
                <th>Physical</th>
                <th>Variance</th>
                <th>Status</th>
                <th>Created by</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {counts
                .filter((c): c is CountDocumentSummary => c != null && typeof c === 'object')
                .filter((c) => (highVarianceOnly ? Math.abs(Number(c.variance)) > 5 : true))
                .map((c, idx) => {
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
                  const statusStr = c.status != null ? String(c.status) : '';
                  const createdAt = c.createdAt != null ? new Date(c.createdAt).toLocaleDateString() : '—';
                  return (
                    <tr
                      key={c.id ?? `count-row-${idx}`}
                      onDoubleClick={handleRowDoubleClick}
                      className="stock-counting-view-list-row"
                      title="Double-click to open"
                    >
                      <td>{c.countNumber ?? '—'}</td>
                      <td>{c.countType != null ? String(c.countType).replace(/_/g, ' ') : '—'}</td>
                      <td>{c.location?.code ?? '—'}</td>
                      <td>{c.itemSummary ?? '—'}</td>
                      <td title={formatSystemCell(c.currentStockTotal, c.systemQuantity ?? 0).tooltip}>
                        {formatSystemCell(c.currentStockTotal, c.systemQuantity ?? 0).text}
                      </td>
                      <td>{c.physicalQuantity ?? '—'}</td>
                      <td><span className={varianceClass(Number(c.variance))}>{Number(c.variance) > 0 ? '+' : ''}{c.variance}</span></td>
                      <td><span className={statusStr ? `status-${statusStr.toLowerCase()}` : ''}>{statusStr || '—'}</span></td>
                      <td>{c.createdBy?.name ?? '—'}</td>
                      <td>{createdAt}</td>
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
    const isCreator = user && doc.createdBy?.id === user.id;
    const canSubmitThis = isCreator || canApprove;
    const showDeleteInEnter = user && canDeleteCount(user.role, doc.createdBy?.id ?? '', user.id);
    return (
      <Card className="stock-counting-view-enter counting-details">
        <div className="details-header">
          <h2>Enter Physical Stock</h2>
          <div className="details-actions">
            <Button variant="secondary" onClick={() => setViewMode('list')}>Back to list</Button>
            <Button variant="ghost" onClick={() => handleSaveLines(true)} disabled={savingLines} title="Save entered quantities and variance reasons">Save</Button>
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={!canSubmitThis || !canSubmit}
              title={!canSubmitThis ? 'Only the count creator or an approver can submit' : !canSubmit ? 'Enter physical quantity for every line; add variance reason where there is a difference' : 'Submit count for approval'}
            >
              Submit
            </Button>
            {showDeleteInEnter && (
              <Button variant="danger" onClick={() => { setActionCountId(doc.id); setShowDeleteDialog(true); }}>Delete</Button>
            )}
          </div>
        </div>
        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">{success}</div>}
        <div className="counting-table">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th title="Variant-level counting is mandatory for variant items; product-level adjustment is never allowed.">Variant</th>
                {!blind && <th title="Current stock − system at count (hover cell for details)">System</th>}
                <th>Physical</th>
                <th>Variance</th>
                <th>Variance reason</th>
                <th title="Required for batch-tracked items when there is a variance">Batch</th>
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
                        const sysCell = formatSystemCell(l.currentStock, l.systemQuantity);
                        return (
                          <tr key={l.id} className="stock-counting-view-child-row">
                            <td className="stock-counting-view-indent"></td>
                            <td>{variantLabel(l)}</td>
                            {!blind && <td title={sysCell.tooltip}>{sysCell.text}</td>}
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
                              {l.item?.requiresSerialTracking ? (
                                <span className="stock-counting-view-tracking-cell">
                                  <Button variant="ghost" size="sm" onClick={() => setNumberGridForLine({ lineNo: l.lineNo, tracking: 'SERIAL' })}>Enter serials</Button>
                                  {getSerials(l).length > 0 ? <span className="stock-counting-view-tracking-summary">{getSerials(l).length} serials</span> : null}
                                </span>
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
                  const sysCell = formatSystemCell(l.currentStock, l.systemQuantity);
                  return (
                    <tr key={l.id}>
                      <td>{l.item?.name ?? l.itemId}</td>
                      <td>{variantLabel(l)}</td>
                      {!blind && <td title={sysCell.tooltip}>{sysCell.text}</td>}
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
                        {l.item?.requiresSerialTracking ? (
                          <span className="stock-counting-view-tracking-cell">
                            <Button variant="ghost" size="sm" onClick={() => setNumberGridForLine({ lineNo: l.lineNo, tracking: 'SERIAL' })}>Enter serials</Button>
                            {getSerials(l).length > 0 ? <span className="stock-counting-view-tracking-summary">{getSerials(l).length} serials</span> : null}
                          </span>
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
    const isCreator = user && doc.createdBy?.id === user.id;
    const isSubmitter = user && doc.submittedBy?.id === user.id;
    const showApproveReject =
      doc.status === CountStatus.SUBMITTED &&
      canApprove &&
      (!isSubmitter || canSelfApproveCount(user?.role));
    const showDelete =
      canEdit &&
      user &&
      canDeleteCount(user.role, doc.createdBy?.id ?? '', user.id);
    return (
      <Card className="counting-details stock-counting-view-detail">
        <div className="details-header">
          <h2>Count {doc.countNumber}</h2>
          <div className="details-actions">
            <Button variant="secondary" onClick={() => { setDoc(null); setViewMode('list'); }}>Back to list</Button>
            {canEdit && (isCreator || canApprove) && <Button variant="primary" onClick={() => setViewMode('enter')}>Enter Physical</Button>}
            {showApproveReject && (
              <>
                <Button variant="primary" onClick={() => { setActionCountId(doc.id); setShowApproveDialog(true); }}>Approve</Button>
                <Button variant="danger" onClick={() => { setActionCountId(doc.id); setRejectionReason(''); setShowRejectDialog(true); }}>Reject</Button>
              </>
            )}
            {showDelete && (
              <Button variant="danger" onClick={() => { setActionCountId(doc.id); setShowDeleteDialog(true); }}>Delete</Button>
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
              {doc.submittedAt && (
                <div><label>Submitted</label><div>Submitted by {doc.submittedBy?.name ?? '—'} at {new Date(doc.submittedAt).toLocaleString()}</div></div>
              )}
              {doc.approvedAt && <div><label>Approved</label><div>{new Date(doc.approvedAt).toLocaleString()} by {doc.approvedBy?.name}</div></div>}
              {doc.rejectedAt && (
                <div><label>Rejected</label><div>Rejected by {doc.rejectedBy?.name ?? '—'} at {new Date(doc.rejectedAt).toLocaleString()} – {doc.rejectionReason}</div></div>
              )}
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
                    <th title="Current stock − system at count (hover cell for details)">System</th>
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
                          {!collapsed && lines.map((l) => {
                            const sysCell = formatSystemCell(l.currentStock, l.systemQuantity);
                            return (
                              <tr key={l.id} className="stock-counting-view-child-row">
                                <td className="stock-counting-view-indent"></td>
                                <td>{variantLabel(l)}</td>
                                <td title={sysCell.tooltip}>{sysCell.text}</td>
                                <td>{l.physicalQuantity}</td>
                                <td><span className={varianceClass(l.variance)}>{l.variance > 0 ? '+' : ''}{l.variance}</span></td>
                                <td>{l.varianceReason ?? '—'}</td>
                                <td>{l.batchNumber ?? '—'}</td>
                                <td>{l.expiryDate ? new Date(l.expiryDate).toLocaleDateString() : '—'}</td>
                                <td>{l.serialNumbers?.length ? l.serialNumbers.join(', ') : '—'}</td>
                              </tr>
                            );
                          })}
                        </React.Fragment>
                      );
                    }

                    return lines.map((l) => {
                      const sysCell = formatSystemCell(l.currentStock, l.systemQuantity);
                      return (
                        <tr key={l.id}>
                          <td>{l.item?.name ?? l.itemId}</td>
                          <td>{variantLabel(l)}</td>
                          <td title={sysCell.tooltip}>{sysCell.text}</td>
                          <td>{l.physicalQuantity}</td>
                          <td><span className={varianceClass(l.variance)}>{l.variance > 0 ? '+' : ''}{l.variance}</span></td>
                          <td>{l.varianceReason ?? '—'}</td>
                          <td>{l.batchNumber ?? '—'}</td>
                          <td>{l.expiryDate ? new Date(l.expiryDate).toLocaleDateString() : '—'}</td>
                          <td>{l.serialNumbers?.length ? l.serialNumbers.join(', ') : '—'}</td>
                        </tr>
                      );
                    });
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
            initialSerialAttributes={numberGridForLine.tracking === 'SERIAL' ? getSerialAttributes(ngLineForGrid) : undefined}
            initialBatchRows={numberGridForLine.tracking === 'BATCH' ? [{ batchCode: getBatch(ngLineForGrid) || '', quantity: expectedQty, manufacturingDate: getMfg(ngLineForGrid) || '', expiryDate: getExpiry(ngLineForGrid) || '' }] : []}
            existingSerialsInDoc={[]}
            // Counting is discovery, not fulfillment — the physical count IS whatever you
            // scan, so serial entry shouldn't be locked to a qty pre-typed before opening this.
            allowOverReceive={numberGridForLine.tracking === 'SERIAL' ? true : false}
            allowPartial={numberGridForLine.tracking === 'SERIAL' ? true : false}
            useSerialGrid={numberGridForLine.tracking === 'SERIAL'}
            itemName={ngLineForGrid.item?.name}
            industryFlags={toIndustryFlags(ngLineForGrid.item)}
            fetchAvailableForBatch={undefined}
            locationId={doc.locationId}
            fromLocationId={numberGridForLine.tracking === 'SERIAL' ? (v < 0 ? doc.locationId : undefined) : undefined}
            toLocationId={undefined}
            singleBatchMode={numberGridForLine.tracking === 'BATCH'}
            onApply={(result) => {
              if (numberGridForLine.tracking === 'SERIAL') {
                // Physical qty is derived from however many serials were actually entered —
                // no need to pre-set/fix it up manually before or after scanning. Direction
                // (adding vs. removing stock) is whatever it was when the sheet was opened
                // (v < 0 means we were already removing).
                const direction = v < 0 ? -1 : 1;
                const physicalQuantity = ngLineForGrid.systemQuantity + direction * result.finalSerialList.length;
                setLineEdit(numberGridForLine.lineNo, {
                  serialNumbers: result.finalSerialList,
                  serialAttributes: result.serialAttributes,
                  physicalQuantity,
                });
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
      <ConfirmDialog
        isOpen={showDeleteDialog}
        title="Delete count"
        message="Permanently delete this count? This cannot be undone."
        onConfirm={handleDelete}
        onCancel={() => { setShowDeleteDialog(false); setActionCountId(null); }}
        variant="danger"
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
