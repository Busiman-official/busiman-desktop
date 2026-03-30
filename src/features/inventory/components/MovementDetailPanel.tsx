/**
 * Movement Detail Panel Component - Document or single movement view with tabs
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  inventoryService,
  MovementDocumentResponse,
  StockMovementResponse,
  MovementStatus,
} from '@/services/inventory.service';
import { Button, Card } from '@/shared/components/ui';
import { LoadingState } from '@/shared/components/data-display';
import { extractErrorMessage } from '@/utils/error';
import { logger } from '@/shared/utils/logger';
import { ConfirmDialog } from '@/shared/components/modals';
import './MovementDetailPanel.css';

interface MovementDetailPanelProps {
  documentId: string | null;
  movementId: string | null;
  onClose: () => void;
  onRefresh?: () => void;
}

type DetailTab = 'overview' | 'lines' | 'audit' | 'reversal';

export const MovementDetailPanel: React.FC<MovementDetailPanelProps> = ({
  documentId,
  movementId,
  onClose,
  onRefresh,
}) => {
  const [document, setDocument] = useState<MovementDocumentResponse | null>(null);
  const [movement, setMovement] = useState<StockMovementResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [approveAction, setApproveAction] = useState<'approve' | 'reject' | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showReverseDialog, setShowReverseDialog] = useState(false);
  const [reversalReason, setReversalReason] = useState('');
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const hasSelection = !!(documentId || movementId);

  useEffect(() => {
    if (movementId) {
      setDocument(null);
      loadMovement();
    } else if (documentId) {
      setMovement(null);
      loadDocument();
    } else {
      setDocument(null);
      setMovement(null);
    }
  }, [documentId, movementId]);

  // ESC to close details (use window.document to avoid shadowing the state variable "document")
  useEffect(() => {
    if (!hasSelection) return;
    const doc = typeof window !== 'undefined' ? window.document : null;
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showApproveDialog || showReverseDialog) return;
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    };
    doc.addEventListener('keydown', onKey, true);
    return () => doc.removeEventListener('keydown', onKey, true);
  }, [hasSelection, showApproveDialog, showReverseDialog]);

  const loadDocument = async () => {
    if (!documentId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await inventoryService.getMovementDocument(documentId);
      setDocument(data);
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to load movement details');
      setError(message);
      logger.error('[MovementDetailPanel] Failed to load document', err);
    } finally {
      setLoading(false);
    }
  };

  const loadMovement = async () => {
    if (!movementId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await inventoryService.getMovementById(movementId);
      setMovement(data);
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to load movement details');
      setError(message);
      logger.error('[MovementDetailPanel] Failed to load movement', err);
    } finally {
      setLoading(false);
    }
  };

  const handleApproveDocument = async (approved: boolean, rejectionReason?: string) => {
    if (!document) return;
    setError(null);
    try {
      // TODO: Implement approveMovement for documents (batch approval flow)
      setShowApproveDialog(false);
      if (onRefresh) onRefresh();
      await loadDocument();
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to process approval');
      setError(message);
      logger.error('[MovementDetailPanel] Failed to approve', err);
    }
  };

  const handleApproveMovement = async (approved: boolean, rejectionReason?: string) => {
    if (!movement) return;
    setError(null);
    try {
      await inventoryService.approveMovement(movement.id, approved, rejectionReason);
      setShowApproveDialog(false);
      if (onRefresh) onRefresh();
      await loadMovement();
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to process approval');
      setError(message);
      logger.error('[MovementDetailPanel] Failed to approve', err);
    }
  };

  const handleReverseDocument = async () => {
    if (!document || !reversalReason.trim()) return;
    setError(null);
    try {
      // TODO: Implement full document reversal with line-level support
      await inventoryService.reverseMovement(document.id, reversalReason);
      setShowReverseDialog(false);
      setReversalReason('');
      if (onRefresh) onRefresh();
      await loadDocument();
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to reverse movement');
      setError(message);
      logger.error('[MovementDetailPanel] Failed to reverse', err);
    }
  };

  const handleReverseMovement = async () => {
    if (!movement || !reversalReason.trim()) return;
    setError(null);
    try {
      await inventoryService.reverseMovement(movement.id, reversalReason);
      setShowReverseDialog(false);
      setReversalReason('');
      if (onRefresh) onRefresh();
      await loadMovement();
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to reverse movement');
      setError(message);
      logger.error('[MovementDetailPanel] Failed to reverse', err);
    }
  };

  if (!hasSelection) {
    return (
      <div className="movement-detail-placeholder">
        <h3>No Movement Selected</h3>
        <p>Select a movement from the list to view details</p>
      </div>
    );
  }

  if (loading) {
    return <LoadingState message="Loading movement details..." />;
  }

  if (error && !document && !movement) {
    return <div className="error-message">{error}</div>;
  }

  if (movement) {
    return (
      <div className="movement-detail-panel">
        <div className="movement-detail-header-tabs">
          <div className="movement-detail-header">
            <div>
              <h2>Movement {movement.movementNumber}</h2>
              <div className="movement-detail-meta">
                <span className={`status-badge status-${movement.status.toLowerCase()}`}>
                  {movement.status}
                </span>
                <span className="movement-type">{movement.movementType}</span>
              </div>
            </div>
            <div className="movement-detail-actions">
              {movement.status === MovementStatus.PENDING && (
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => { setApproveAction('approve'); setShowApproveDialog(true); }}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => { setApproveAction('reject'); setShowApproveDialog(true); }}
                  >
                    Reject
                  </Button>
                </>
              )}
              {(movement.status === MovementStatus.COMPLETED || movement.status === MovementStatus.APPROVED) && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowReverseDialog(true)}
                >
                  Reverse
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={onClose} title="Close (Esc)" aria-label="Close">×</Button>
            </div>
          </div>
          <div className="movement-detail-tabs">
            <button className={`tab-button ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>Overview</button>
            <button className={`tab-button ${activeTab === 'lines' ? 'active' : ''}`} onClick={() => setActiveTab('lines')}>Line</button>
            <button className={`tab-button ${activeTab === 'audit' ? 'active' : ''}`} onClick={() => setActiveTab('audit')}>Audit</button>
            <button className={`tab-button ${activeTab === 'reversal' ? 'active' : ''}`} onClick={() => setActiveTab('reversal')}>Reversal</button>
          </div>
        </div>
        <div className="movement-detail-content">
          {activeTab === 'overview' && (
            <div className="detail-section">
              <h3>Movement Information</h3>
              <div className="detail-grid">
                <div><label>Movement Number</label><div>{movement.movementNumber}</div></div>
                <div><label>Type</label><div>{movement.movementType}</div></div>
                <div><label>Status</label><div><span className={`status-${movement.status.toLowerCase()}`}>{movement.status}</span></div></div>
                <div><label>Quantity</label><div>{movement.quantity} {movement.unitOfMeasure}</div></div>
                <div><label>Reason Code</label><div>{movement.reasonCode}</div></div>
                {movement.reasonDescription && <div><label>Reason Description</label><div>{movement.reasonDescription}</div></div>}
              </div>
              <h3>Item & Locations</h3>
              <div className="detail-grid">
                <div><label>Item</label><div>{movement.item?.sku || movement.itemId} - {movement.item?.name || '-'}</div></div>
                {movement.variant && <div><label>Variant</label><div>{movement.variant.code} - {movement.variant.name}</div></div>}
                {movement.fromLocation && <div><label>From Location</label><div>{movement.fromLocation.code} - {movement.fromLocation.name}</div></div>}
                {movement.toLocation && <div><label>To Location</label><div>{movement.toLocation.code} - {movement.toLocation.name}</div></div>}
                {movement.batchNumber && <div><label>Batch</label><div>{movement.batchNumber}</div></div>}
              </div>
              <h3>Audit</h3>
              <div className="detail-grid">
                <div><label>Created By</label><div>{movement.createdBy?.name ?? '-'} {movement.createdBy?.email ? `(${movement.createdBy.email})` : ''}</div></div>
                <div><label>Created At</label><div>{new Date(movement.createdAt).toLocaleString()}</div></div>
                {movement.approvedBy && <div><label>Approved By</label><div>{movement.approvedBy}</div></div>}
                {movement.approvedAt && <div><label>Approved At</label><div>{new Date(movement.approvedAt).toLocaleString()}</div></div>}
              </div>
            </div>
          )}
          {activeTab === 'lines' && (
            <div className="detail-section">
              <h3>Line</h3>
              <div className="lines-table-container">
                <table>
                  <thead><tr><th>Item</th><th>Variant</th><th>From</th><th>To</th><th>Quantity</th><th>UoM</th><th>Batch/Serial</th></tr></thead>
                  <tbody>
                    <tr>
                      <td>{movement.item?.name || movement.itemId}</td>
                      <td>{movement.variant?.code || movement.variant?.name || '-'}</td>
                      <td>{movement.fromLocation?.code || '-'}</td>
                      <td>{movement.toLocation?.code || '-'}</td>
                      <td>{movement.quantity}</td>
                      <td>{movement.unitOfMeasure}</td>
                      <td>{movement.batchNumber || (movement.serialNumbers?.length ? `Serials: ${movement.serialNumbers.length}` : '-')}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {activeTab === 'audit' && (
            <div className="detail-section">
              <h3>Audit Trail</h3>
              <div className="audit-timeline">
                <div className="audit-event">
                  <div className="audit-event-time">{new Date(movement.createdAt).toLocaleString()}</div>
                  <div className="audit-event-action">Created</div>
                  <div className="audit-event-user">By {movement.createdBy?.name ?? '-'}</div>
                </div>
                {(movement.status === MovementStatus.COMPLETED || movement.status === MovementStatus.APPROVED) && movement.approvedAt && (
                  <div className="audit-event">
                    <div className="audit-event-time">{new Date(movement.approvedAt).toLocaleString()}</div>
                    <div className="audit-event-action">Approved</div>
                    {movement.approvedBy && <div className="audit-event-user">By {movement.approvedBy}</div>}
                  </div>
                )}
              </div>
            </div>
          )}
          {activeTab === 'reversal' && (
            <div className="detail-section">
              <h3>Reverse Movement</h3>
              {(movement.status === MovementStatus.COMPLETED || movement.status === MovementStatus.APPROVED) ? (
                <div>
                  <p>This will create a reversal movement.</p>
                  <div className="reversal-form">
                    <label>Reversal Reason *</label>
                    <textarea value={reversalReason} onChange={(e) => setReversalReason(e.target.value)} placeholder="Enter reason for reversal" rows={4} />
                    <Button variant="danger" onClick={() => setShowReverseDialog(true)} disabled={!reversalReason.trim()}>Reverse Movement</Button>
                  </div>
                </div>
              ) : (
                <p>Only completed movements can be reversed.</p>
              )}
            </div>
          )}
        </div>
        <ConfirmDialog
          isOpen={showApproveDialog}
          title={approveAction === 'approve' ? 'Approve Movement' : 'Reject Movement'}
          message={approveAction === 'approve' ? 'Are you sure you want to approve this movement?' : 'Please provide a reason for rejecting this movement.'}
          requiresReason={approveAction === 'reject'}
          onConfirm={(reason) => { handleApproveMovement(approveAction === 'approve', reason); setShowApproveDialog(false); setApproveAction(null); setRejectionReason(''); }}
          onCancel={() => { setShowApproveDialog(false); setApproveAction(null); setRejectionReason(''); }}
          variant={approveAction === 'approve' ? 'primary' : 'danger'}
        />
        <ConfirmDialog
          isOpen={showReverseDialog}
          title="Reverse Movement"
          message={`Are you sure you want to reverse movement ${movement.movementNumber}?`}
          onConfirm={handleReverseMovement}
          onCancel={() => { setShowReverseDialog(false); setReversalReason(''); }}
          variant="danger"
        />
      </div>
    );
  }

  if (!document) {
    return null;
  }

  const handleApprove = handleApproveDocument;
  const handleReverse = handleReverseDocument;

  return (
    <div className="movement-detail-panel">
      <div className="movement-detail-header-tabs">
        <div className="movement-detail-header">
          <div>
            <h2>Movement {document.movementNumber}</h2>
            <div className="movement-detail-meta">
              <span className={`status-badge status-${document.status.toLowerCase()}`}>
                {document.status}
              </span>
              <span className="movement-type">{document.movementType}</span>
            </div>
          </div>
          <div className="movement-detail-actions">
            {document.status === MovementStatus.PENDING && (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => { setApproveAction('approve'); setShowApproveDialog(true); }}
                >
                  Approve
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => { setApproveAction('reject'); setShowApproveDialog(true); }}
                >
                  Reject
                </Button>
              </>
            )}
            {document.status === MovementStatus.COMPLETED && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowReverseDialog(true)}
              >
                Reverse
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              title="Close (Esc)"
              aria-label="Close"
            >
              ×
            </Button>
          </div>
        </div>

        <div className="movement-detail-tabs">
        <button
          className={`tab-button ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        <button
          className={`tab-button ${activeTab === 'lines' ? 'active' : ''}`}
          onClick={() => setActiveTab('lines')}
        >
          Lines & Tracking
        </button>
        <button
          className={`tab-button ${activeTab === 'audit' ? 'active' : ''}`}
          onClick={() => setActiveTab('audit')}
        >
          Audit
        </button>
        <button
          className={`tab-button ${activeTab === 'reversal' ? 'active' : ''}`}
          onClick={() => setActiveTab('reversal')}
        >
          Reversal
        </button>
      </div>
      </div>

      <div className="movement-detail-content">
        {activeTab === 'overview' && (
          <div className="detail-section">
            <h3>Document Information</h3>
            <div className="detail-grid">
              <div>
                <label>Movement Number</label>
                <div>{document.movementNumber}</div>
              </div>
              <div>
                <label>Type</label>
                <div>{document.movementType}</div>
              </div>
              <div>
                <label>Status</label>
                <div>
                  <span className={`status-${document.status.toLowerCase()}`}>
                    {document.status}
                  </span>
                </div>
              </div>
              <div>
                <label>Total Lines</label>
                <div>{document.totalLines}</div>
              </div>
              <div>
                <label>Total Quantity</label>
                <div>{document.totalQuantity}</div>
              </div>
              <div>
                <label>Requires Approval</label>
                <div>{document.requiresApproval ? 'Yes' : 'No'}</div>
              </div>
            </div>

            <h3>Location Information</h3>
            <div className="detail-grid">
              {document.defaultFromLocation && (
                <div>
                  <label>Default From Location</label>
                  <div>
                    {document.defaultFromLocation.code} - {document.defaultFromLocation.name}
                  </div>
                </div>
              )}
              {document.defaultToLocation && (
                <div>
                  <label>Default To Location</label>
                  <div>
                    {document.defaultToLocation.code} - {document.defaultToLocation.name}
                  </div>
                </div>
              )}
            </div>

            <h3>Reason & Notes</h3>
            <div className="detail-grid">
              <div>
                <label>Reason Code</label>
                <div>{document.reasonCode}</div>
              </div>
              {document.reasonDescription && (
                <div>
                  <label>Reason Description</label>
                  <div>{document.reasonDescription}</div>
                </div>
              )}
              {document.documentNotes && (
                <div>
                  <label>Document Notes</label>
                  <div>{document.documentNotes}</div>
                </div>
              )}
            </div>

            <h3>Approval Information</h3>
            <div className="detail-grid">
              <div>
                <label>Created By</label>
                <div>{document.createdBy.name} ({document.createdBy.email})</div>
              </div>
              <div>
                <label>Created At</label>
                <div>{new Date(document.createdAt).toLocaleString()}</div>
              </div>
              {document.approvedBy && (
                <>
                  <div>
                    <label>Approved By</label>
                    <div>{document.approvedBy}</div>
                  </div>
                  {document.approvedAt && (
                    <div>
                      <label>Approved At</label>
                      <div>{new Date(document.approvedAt).toLocaleString()}</div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {activeTab === 'lines' && (
          <div className="detail-section">
            <h3>Movement Lines</h3>
            <div className="lines-table-container">
              <table>
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Item</th>
                    <th>Variant</th>
                    <th>From Location</th>
                    <th>To Location</th>
                    <th>Quantity</th>
                    <th>UoM</th>
                    <th>Batch/Serial</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {document.lines.map((line) => (
                    <tr key={line.id}>
                      <td>{line.lineNo}</td>
                      <td>{line.item?.name || line.itemId}</td>
                      <td>{line.variant?.code || line.variant?.name || '-'}</td>
                      <td>{line.fromLocation?.code || '-'}</td>
                      <td>{line.toLocation?.code || '-'}</td>
                      <td>{line.quantity}</td>
                      <td>{line.unitOfMeasure}</td>
                      <td>
                        {line.batchNumber && <span>Batch: {line.batchNumber}</span>}
                        {line.serialNumbers && line.serialNumbers.length > 0 && (
                          <span>Serials: {line.serialNumbers.length}</span>
                        )}
                      </td>
                      <td>
                        <span className={`status-${line.lineStatus.toLowerCase()}`}>
                          {line.lineStatus}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'audit' && (
          <div className="detail-section">
            <h3>Audit Trail</h3>
            <div className="audit-timeline">
              <div className="audit-event">
                <div className="audit-event-time">{new Date(document.createdAt).toLocaleString()}</div>
                <div className="audit-event-action">Created</div>
                <div className="audit-event-user">By {document.createdBy.name}</div>
              </div>
              {document.status !== MovementStatus.DRAFT && (
                <div className="audit-event">
                  <div className="audit-event-time">
                    {document.status === MovementStatus.PENDING
                      ? 'Pending approval'
                      : document.approvedAt
                      ? new Date(document.approvedAt).toLocaleString()
                      : 'N/A'}
                  </div>
                  <div className="audit-event-action">
                    {document.status === MovementStatus.APPROVED || document.status === MovementStatus.COMPLETED
                      ? 'Approved'
                      : document.status === MovementStatus.REJECTED
                      ? 'Rejected'
                      : 'Status: ' + document.status}
                  </div>
                  {document.approvedBy && (
                    <div className="audit-event-user">By {document.approvedBy}</div>
                  )}
                </div>
              )}
              {document.status === MovementStatus.COMPLETED && (
                <div className="audit-event">
                  <div className="audit-event-time">Executed</div>
                  <div className="audit-event-action">All lines processed</div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'reversal' && (
          <div className="detail-section">
            <h3>Reverse Movement</h3>
            {document.status === MovementStatus.COMPLETED ? (
              <div>
                <p>This will create a reversal movement document that reverses all lines in this movement.</p>
                <div className="reversal-form">
                  <label>Reversal Reason *</label>
                  <textarea
                    value={reversalReason}
                    onChange={(e) => setReversalReason(e.target.value)}
                    placeholder="Enter reason for reversal"
                    rows={4}
                  />
                  <Button
                    variant="danger"
                    onClick={() => setShowReverseDialog(true)}
                    disabled={!reversalReason.trim()}
                  >
                    Reverse Movement
                  </Button>
                </div>
              </div>
            ) : (
              <p>Only completed movements can be reversed.</p>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={showApproveDialog}
        title={approveAction === 'approve' ? 'Approve Movement' : 'Reject Movement'}
        message={
          approveAction === 'approve'
            ? 'Are you sure you want to approve this movement?'
            : 'Please provide a reason for rejecting this movement.'
        }
        requiresReason={approveAction === 'reject'}
        onConfirm={(reason) => {
          handleApprove(approveAction === 'approve', reason);
          setShowApproveDialog(false);
          setApproveAction(null);
          setRejectionReason('');
        }}
        onCancel={() => {
          setShowApproveDialog(false);
          setApproveAction(null);
          setRejectionReason('');
        }}
        variant={approveAction === 'approve' ? 'primary' : 'danger'}
      />

      <ConfirmDialog
        isOpen={showReverseDialog}
        title="Reverse Movement"
        message={`Are you sure you want to reverse movement ${document.movementNumber}?`}
        onConfirm={handleReverse}
        onCancel={() => {
          setShowReverseDialog(false);
          setReversalReason('');
        }}
        variant="danger"
      />
    </div>
  );
};
