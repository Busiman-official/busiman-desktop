/**
 * Movement List Component - Main ledger table
 */

import React, { useState, useEffect } from 'react';
import { inventoryService, MovementDocumentResponse, MovementType, MovementStatus } from '@/services/inventory.service';
import { Button, Input, Select } from '@/shared/components/ui';
import { LoadingState, EmptyState } from '@/shared/components/data-display';
import { extractErrorMessage } from '@/utils/error';
import { logger } from '@/shared/utils/logger';
import './MovementList.css';

interface MovementListProps {
  onSelectMovement: (documentId: string) => void;
  /** Double-click: open details panel (or Create with prefill when DRAFT). */
  onOpenDetails?: (doc: MovementDocumentResponse) => void;
  selectedDocumentId?: string;
  onCreateMovement?: () => void;
}

export const MovementList: React.FC<MovementListProps> = ({ onSelectMovement, onOpenDetails, selectedDocumentId, onCreateMovement }) => {
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

  const loadDocuments = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await inventoryService.getAllMovementDocuments({
        movementType: filters.movementType || undefined,
        status: filters.status || undefined,
        createdBy: filters.createdBy || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        myPendingApprovals: filters.myPendingApprovals || undefined,
      });
      setDocuments(data);
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to load movements');
      setError(message);
      logger.error('[MovementList] Failed to load movements', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, [filters]);

  const getFromLocation = (doc: MovementDocumentResponse) => {
    if (doc.lines.length > 0 && doc.lines[0].fromLocation) {
      return doc.lines[0].fromLocation;
    }
    return doc.defaultFromLocation;
  };

  const getToLocation = (doc: MovementDocumentResponse) => {
    if (doc.lines.length > 0 && doc.lines[0].toLocation) {
      return doc.lines[0].toLocation;
    }
    return doc.defaultToLocation;
  };

  if (loading && documents.length === 0) {
    return <LoadingState message="Loading movements..." />;
  }

  if (error && documents.length === 0) {
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

      {documents.length === 0 ? (
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
              {documents.map((doc) => {
                const fromLoc = getFromLocation(doc);
                const toLoc = getToLocation(doc);
                const variantDisplay =
                  doc.lines.length === 1
                    ? (doc.lines[0].variant?.code || doc.lines[0].variant?.name || '-')
                    : new Set(doc.lines.map((l) => l.variant?.id).filter(Boolean)).size <= 1
                    ? (doc.lines[0]?.variant?.code || doc.lines[0]?.variant?.name || '-')
                    : 'Multiple';
                return (
                  <tr
                    key={doc.id}
                    className={`movement-row ${selectedDocumentId === doc.id ? 'selected' : ''}`}
                    onClick={() => onSelectMovement(doc.id)}
                    onDoubleClick={() => onOpenDetails?.(doc)}
                  >
                    <td>{new Date(doc.createdAt).toLocaleString()}</td>
                    <td>{doc.movementType}</td>
                    <td>{doc.totalLines}</td>
                    <td>{variantDisplay}</td>
                    <td>{fromLoc ? `${fromLoc.code} - ${fromLoc.name}` : '-'}</td>
                    <td>{toLoc ? `${toLoc.code} - ${toLoc.name}` : '-'}</td>
                    <td>{doc.totalQuantity}</td>
                    <td>
                      <span className={`status-${doc.status.toLowerCase()}`}>
                        {doc.status}
                      </span>
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
