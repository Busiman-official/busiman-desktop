/**
 * Movement List Component - Unified ledger table (single movements + documents)
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  inventoryService,
  MovementDocumentResponse,
  StockMovementResponse,
  MovementType,
  MovementStatus,
} from '@/services/inventory.service';
import { Button, Input, Select } from '@/shared/components/ui';
import { LoadingState, EmptyState } from '@/shared/components/data-display';
import { extractErrorMessage } from '@/utils/error';
import { logger } from '@/shared/utils/logger';
import './MovementList.css';

export type MovementRowSource = 'movement' | 'document';

export interface MovementSelection {
  source: MovementRowSource;
  id: string;
}

export type MovementRow =
  | { source: 'movement'; data: StockMovementResponse }
  | { source: 'document'; data: MovementDocumentResponse };

interface MovementListProps {
  onSelectMovement: (selection: MovementSelection) => void;
  /** Double-click: open details panel (or Create with prefill when DRAFT). */
  onOpenDetails?: (selection: MovementSelection, doc?: MovementDocumentResponse) => void;
  selectedSelection?: MovementSelection | null;
  onCreateMovement?: () => void;
}

function getRowKey(row: MovementRow): string {
  return row.source === 'movement' ? `movement-${row.data.id}` : `document-${row.data.id}`;
}

function getRowCreatedAt(row: MovementRow): string {
  return row.data.createdAt;
}

function getFromLocationDoc(doc: MovementDocumentResponse) {
  if (doc.lines.length > 0 && doc.lines[0].fromLocation) return doc.lines[0].fromLocation;
  return doc.defaultFromLocation;
}

function getToLocationDoc(doc: MovementDocumentResponse) {
  if (doc.lines.length > 0 && doc.lines[0].toLocation) return doc.lines[0].toLocation;
  return doc.defaultToLocation;
}

export const MovementList: React.FC<MovementListProps> = ({
  onSelectMovement,
  onOpenDetails,
  selectedSelection,
  onCreateMovement,
}) => {
  const [movements, setMovements] = useState<StockMovementResponse[]>([]);
  const [documents, setDocuments] = useState<MovementDocumentResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    movementType: '' as MovementType | '',
    status: '' as MovementStatus | '',
    dateFrom: '',
    dateTo: '',
    createdBy: '',
    myPendingApprovals: false,
  });
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [movementsData, documentsData] = await Promise.all([
        inventoryService.getAllMovements({
          movementType: filters.movementType || undefined,
          status: filters.status || undefined,
          dateFrom: filters.dateFrom || undefined,
          dateTo: filters.dateTo || undefined,
        }),
        inventoryService.getAllMovementDocuments({
          movementType: filters.movementType || undefined,
          status: filters.status || undefined,
          createdBy: filters.createdBy || undefined,
          dateFrom: filters.dateFrom || undefined,
          dateTo: filters.dateTo || undefined,
          myPendingApprovals: filters.myPendingApprovals || undefined,
        }),
      ]);
      setMovements(movementsData);
      setDocuments(documentsData);
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to load movements');
      setError(message);
      logger.error('[MovementList] Failed to load movements', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [filters]);

  const mergedRows: MovementRow[] = useMemo(() => {
    const documentRows: MovementRow[] = documents.map((data) => ({ source: 'document', data }));
    const documentNumbers = new Set(documents.map((d) => d.movementNumber));
    // Hide line-level ledger movements that were produced by a movement document:
    // the document row already summarizes those lines.
    const movementRows: MovementRow[] = movements
      .filter((m) => !(m.referenceNumber && documentNumbers.has(m.referenceNumber)))
      .map((data) => ({ source: 'movement', data }));
    const all: MovementRow[] = [...movementRows, ...documentRows];
    all.sort((a, b) => new Date(getRowCreatedAt(b)).getTime() - new Date(getRowCreatedAt(a)).getTime());
    return all;
  }, [movements, documents]);

  const isSelected = (row: MovementRow) => {
    if (!selectedSelection) return false;
    return selectedSelection.source === row.source && selectedSelection.id === row.data.id;
  };

  if (loading && mergedRows.length === 0) {
    return <LoadingState message="Loading movements..." />;
  }

  if (error && mergedRows.length === 0) {
    return <div className="error-message">{error}</div>;
  }

  return (
    <div className="movement-list">
      <div className="movement-list-toolbar">
        <div className="movement-list-filters">
          {onCreateMovement && (
            <Button variant="primary" onClick={onCreateMovement} title="Create movement (Ctrl+A)">
              Create Movement
            </Button>
          )}
          <Select
            value={filters.movementType}
            onChange={(e) => setFilters({ ...filters, movementType: e.target.value as MovementType | '' })}
            style={{ width: '200px' }}
          >
            <option value="">All Types</option>
            {Object.values(MovementType).map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </Select>
          <Select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value as MovementStatus | '' })}
            style={{ width: '200px' }}
          >
            <option value="">All Statuses</option>
            {Object.values(MovementStatus).map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </Select>
          <Button
            variant="ghost"
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
          >
            {showAdvancedFilters ? 'Hide Filters' : 'More Filters'}
          </Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => loadData()}
          disabled={loading}
          title="Refresh transactions list"
        >
          {loading ? '…' : '↻ Refresh'}
        </Button>
      </div>

      {showAdvancedFilters && (
        <div className="filter-bar-expanded">
          <div className="filter-row">
            <div className="filter-group">
              <label>Date From</label>
              <Input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
                style={{ width: '150px' }}
              />
            </div>
            <div className="filter-group">
              <label>Date To</label>
              <Input
                type="date"
                value={filters.dateTo}
                onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
                style={{ width: '150px' }}
              />
            </div>
            <div className="filter-group">
              <label>
                <input
                  type="checkbox"
                  checked={filters.myPendingApprovals}
                  onChange={(e) => setFilters({ ...filters, myPendingApprovals: e.target.checked })}
                />
                My Pending Approvals
              </label>
            </div>
            <Button
              variant="ghost"
              onClick={() => {
                setFilters({
                  movementType: '' as MovementType | '',
                  status: '' as MovementStatus | '',
                  dateFrom: '',
                  dateTo: '',
                  createdBy: '',
                  myPendingApprovals: false,
                });
              }}
            >
              Clear Filters
            </Button>
          </div>
        </div>
      )}

      {error && <div className="error-message">{error}</div>}

      {mergedRows.length === 0 ? (
        <EmptyState message="No movements found" />
      ) : (
        <div className="movement-list-table">
          <table>
            <thead>
              <tr>
                <th>Date & Time</th>
                <th>Type</th>
                <th>Total Lines</th>
                <th>Variant</th>
                <th>From Location</th>
                <th>To Location</th>
                <th>Total Quantity</th>
                <th>Status</th>
                <th>Created By</th>
                <th>Approved By</th>
              </tr>
            </thead>
            <tbody>
              {mergedRows.map((row) => {
                const selection: MovementSelection = { source: row.source, id: row.data.id };
                if (row.source === 'movement') {
                  const m = row.data;
                  const fromLoc = m.fromLocation;
                  const toLoc = m.toLocation;
                  const variantDisplay = m.variant?.code || m.variant?.name || '-';
                  return (
                    <tr
                      key={getRowKey(row)}
                      className={`movement-row ${isSelected(row) ? 'selected' : ''}`}
                      onClick={() => onSelectMovement(selection)}
                      onDoubleClick={() => onOpenDetails?.(selection)}
                    >
                      <td>{new Date(m.createdAt).toLocaleString()}</td>
                      <td>{m.movementType}</td>
                      <td>1</td>
                      <td>{variantDisplay}</td>
                      <td>{fromLoc ? `${fromLoc.code} - ${fromLoc.name}` : '-'}</td>
                      <td>{toLoc ? `${toLoc.code} - ${toLoc.name}` : '-'}</td>
                      <td>{m.quantity}</td>
                      <td>
                        <span className={`status-${m.status.toLowerCase()}`}>{m.status}</span>
                      </td>
                      <td>{m.createdBy?.name ?? '-'}</td>
                      <td>{m.approvedBy || '-'}</td>
                    </tr>
                  );
                }
                const doc = row.data;
                const fromLoc = getFromLocationDoc(doc);
                const toLoc = getToLocationDoc(doc);
                const variantDisplay =
                  doc.lines.length === 1
                    ? (doc.lines[0].variant?.code || doc.lines[0].variant?.name || '-')
                    : new Set(doc.lines.map((l) => l.variant?.id).filter(Boolean)).size <= 1
                    ? (doc.lines[0]?.variant?.code || doc.lines[0]?.variant?.name || '-')
                    : 'Multiple';
                return (
                  <tr
                    key={getRowKey(row)}
                    className={`movement-row ${isSelected(row) ? 'selected' : ''}`}
                    onClick={() => onSelectMovement(selection)}
                    onDoubleClick={() => onOpenDetails?.(selection, doc)}
                  >
                    <td>{new Date(doc.createdAt).toLocaleString()}</td>
                    <td>{doc.movementType}</td>
                    <td>{doc.totalLines}</td>
                    <td>{variantDisplay}</td>
                    <td>{fromLoc ? `${fromLoc.code} - ${fromLoc.name}` : '-'}</td>
                    <td>{toLoc ? `${toLoc.code} - ${toLoc.name}` : '-'}</td>
                    <td>{doc.totalQuantity}</td>
                    <td>
                      <span className={`status-${doc.status.toLowerCase()}`}>{doc.status}</span>
                    </td>
                    <td>{doc.createdBy.name}</td>
                    <td>{doc.approvedBy || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
