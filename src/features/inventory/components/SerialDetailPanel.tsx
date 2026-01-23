/**
 * Serial Detail Panel - Side drawer for serial number details
 * Opens from GlobalSearch, ItemMaster, or direct navigation
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { SideDrawer } from '@/shared/components/modals';
import { Button, Card } from '@/shared/components/ui';
import { LoadingState } from '@/shared/components/data-display';
import { inventoryService, SerialResponse, Location, MovementType } from '@/services/inventory.service';
import { extractErrorMessage } from '@/utils/error';
import { logger } from '@/shared/utils/logger';
import { SerialTimeline, type SerialHistoryEntry } from './SerialTimeline';
import { getSerialStatusAppearance } from '../utils/serialUtils';
import { getSerialBreadcrumb } from '../utils/serialNavigation';
import './SerialDetailPanel.css';

export interface SerialDetailPanelProps {
  isOpen: boolean;
  onClose: () => void;
  serialNumber: string | null;
  onStatusUpdate?: () => void; // Callback when serial status is updated
}

export const SerialDetailPanel: React.FC<SerialDetailPanelProps> = ({
  isOpen,
  onClose,
  serialNumber,
  onStatusUpdate,
}) => {
  const navigate = useNavigate();
  const [serial, setSerial] = useState<SerialResponse | null>(null);
  const [history, setHistory] = useState<SerialHistoryEntry[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showStatusUpdate, setShowStatusUpdate] = useState(false);
  const [newStatus, setNewStatus] = useState<string>('');
  const [updating, setUpdating] = useState(false);
  const copyButtonRef = useRef<HTMLButtonElement>(null);

  // Load serial data
  useEffect(() => {
    if (isOpen && serialNumber) {
      loadSerialData();
    } else {
      // Reset state when closed
      setSerial(null);
      setHistory([]);
      setError(null);
    }
  }, [isOpen, serialNumber]);

  const loadSerialData = async () => {
    if (!serialNumber) return;

    setLoading(true);
    setError(null);

    try {
      // Load serial
      const serialData = await inventoryService.getSerialByNumber(serialNumber.trim());
      setSerial(serialData);

      // Load history
      try {
        const historyData = await inventoryService.getSerialHistory(serialNumber.trim());
        setHistory(historyData);
      } catch (err: any) {
        logger.warn('[SerialDetailPanel] Failed to load history', err);
        setHistory([]);
      }

      // Load locations for actions
      if (locations.length === 0) {
        try {
          const locs = await inventoryService.getAllLocations();
          setLocations(locs);
        } catch (err: any) {
          logger.warn('[SerialDetailPanel] Failed to load locations', err);
        }
      }
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to load serial');
      setError(message);
      logger.error('[SerialDetailPanel] Failed to load serial', err);
    } finally {
      setLoading(false);
    }
  };

  // Copy serial number to clipboard
  const handleCopySerial = useCallback(async () => {
    if (!serial) return;

    try {
      await navigator.clipboard.writeText(serial.serialNumber);
      // Visual feedback
      if (copyButtonRef.current) {
        const originalText = copyButtonRef.current.textContent;
        copyButtonRef.current.textContent = 'Copied!';
        setTimeout(() => {
          if (copyButtonRef.current) {
            copyButtonRef.current.textContent = originalText;
          }
        }, 2000);
      }
    } catch (err) {
      logger.error('[SerialDetailPanel] Failed to copy serial', err);
    }
  }, [serial]);

  // Update serial status
  const handleUpdateStatus = async () => {
    if (!serial || !newStatus) return;

    setUpdating(true);
    setError(null);

    try {
      await inventoryService.updateSerialStatus(serial.serialNumber, newStatus);
      // Reload serial data
      await loadSerialData();
      setShowStatusUpdate(false);
      // Notify parent to refresh serial list
      if (onStatusUpdate) {
        onStatusUpdate();
      }
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to update status');
      setError(message);
      logger.error('[SerialDetailPanel] Failed to update status', err);
    } finally {
      setUpdating(false);
    }
  };

  // Quick actions
  const handleMoveSerial = () => {
    if (!serial) return;
    // Navigate to create movement with serial pre-filled
    const params = new URLSearchParams();
    params.set('tab', 'movements');
    params.set('create', '1');
    params.set('movementType', MovementType.TRANSFER);
    params.set('itemId', serial.itemId);
    if (serial.variantId) {
      params.set('variantId', serial.variantId);
    }
    params.set('serialNumber', serial.serialNumber);
    params.set('fromLocationId', serial.currentLocationId);
    navigate(`/inventory?${params.toString()}`);
    onClose();
  };

  const handleBlockSerial = () => {
    if (!serial) return;
    setNewStatus('BLOCKED');
    setShowStatusUpdate(true);
  };

  const handleUnblockSerial = () => {
    if (!serial) return;
    setNewStatus('AVAILABLE');
    setShowStatusUpdate(true);
  };

  const handleMarkDamaged = () => {
    if (!serial) return;
    setNewStatus('DAMAGED');
    setShowStatusUpdate(true);
  };

  const handleViewItem = () => {
    if (!serial) return;
    const params = new URLSearchParams();
    params.set('tab', 'items');
    params.set('itemId', serial.itemId);
    if (serial.variantId) {
      params.set('variantId', serial.variantId);
    }
    navigate(`/inventory?${params.toString()}`);
    onClose();
  };

  const handleViewLocation = useCallback(() => {
    if (!serial) return;
    // Close sidebar first, then navigate
    onClose();
    // Use setTimeout to ensure sidebar closes before navigation
    setTimeout(() => {
      const params = new URLSearchParams();
      params.set('tab', 'locations');
      params.set('locationId', serial.currentLocationId);
      navigate(`/inventory?${params.toString()}`);
    }, 100);
  }, [serial, navigate, onClose]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Shift+C: Copy serial number
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        handleCopySerial();
      }
      // Escape: Close panel
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleCopySerial, onClose]);

  const statusAppearance = serial ? getSerialStatusAppearance(serial) : null;

  const formatDate = (dateString?: string): string => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <SideDrawer isOpen={isOpen} onClose={onClose} title="Serial Details" width="600px">
      {loading && <LoadingState message="Loading serial details..." />}

      {error && (
        <div className="serial-detail-error">
          <div className="error-message">{error}</div>
          <Button variant="secondary" onClick={loadSerialData} size="sm">
            Retry
          </Button>
        </div>
      )}

      {!loading && !error && serial && (
        <div className="serial-detail-panel">
          {/* Breadcrumb */}
          {(() => {
            const breadcrumbs = getSerialBreadcrumb(
              serial.itemId,
              serial.item?.name,
              serial.variantId,
              serial.variant?.name,
              serial.serialNumber
            );
            return breadcrumbs.length > 0 ? (
              <div className="serial-detail-breadcrumb">
                {breadcrumbs.map((crumb, index) => (
                  <React.Fragment key={index}>
                    {crumb.path ? (
                      <button
                        className="breadcrumb-link"
                        onClick={() => navigate(crumb.path!)}
                      >
                        {crumb.label}
                      </button>
                    ) : (
                      <span className="breadcrumb-current">{crumb.label}</span>
                    )}
                    {index < breadcrumbs.length - 1 && (
                      <span className="breadcrumb-separator">›</span>
                    )}
                  </React.Fragment>
                ))}
              </div>
            ) : null;
          })()}

          {/* Header Section */}
          <div className="serial-detail-header">
            <div className="serial-detail-title">
              <h2>{serial.serialNumber}</h2>
              {statusAppearance && (
                <span
                  className={`status-badge ${statusAppearance.badgeClass}`}
                  style={{ color: statusAppearance.color }}
                >
                  {statusAppearance.icon} {statusAppearance.label}
                </span>
              )}
            </div>
            <div className="serial-detail-actions">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopySerial}
                title="Copy serial number (Ctrl+Shift+C)"
              >
                {copyButtonRef.current?.textContent === 'Copied!' ? '✓ Copied' : '📋 Copy'}
              </Button>
              <span className="qr-placeholder" title="QR code (coming soon)">📱</span>
            </div>
          </div>

          {/* Details Section */}
          <Card className="serial-detail-card">
            <h3>Details</h3>
            <div className="detail-grid">
                <div className="detail-item">
                <label>Item</label>
                <div>
                  {serial.item ? (
                    <button className="detail-link" onClick={handleViewItem}>
                      {serial.item.sku} - {serial.item.name}
                    </button>
                  ) : (
                    serial.itemId
                  )}
                </div>
              </div>

              {serial.variant && (
                <div className="detail-item">
                  <label>Variant</label>
                  <div>
                    {serial.variant.code} - {serial.variant.name}
                  </div>
                </div>
              )}

              <div className="detail-item">
                <label>Current Location</label>
                <div>
                  {serial.currentLocation ? (
                    <button className="detail-link" onClick={handleViewLocation}>
                      {serial.currentLocation.code} - {serial.currentLocation.name}
                    </button>
                  ) : (
                    serial.currentLocationId
                  )}
                </div>
              </div>

              {serial.batchNumber && (
                <div className="detail-item">
                  <label>Batch Number</label>
                  <div>{serial.batchNumber}</div>
                </div>
              )}

              {serial.manufacturingDate && (
                <div className="detail-item">
                  <label>Manufacturing Date</label>
                  <div>{formatDate(serial.manufacturingDate)}</div>
                </div>
              )}

              {serial.expiryDate && (
                <div className="detail-item">
                  <label>Expiry Date</label>
                  <div>
                    {formatDate(serial.expiryDate)}
                    {statusAppearance?.badgeClass === 'status-expired' && (
                      <span className="expired-badge"> (Expired)</span>
                    )}
                    {statusAppearance?.badgeClass === 'status-critical' && (
                      <span className="critical-badge"> (Critical)</span>
                    )}
                  </div>
                </div>
              )}

              {serial.warrantyExpiryDate && (
                <div className="detail-item">
                  <label>Warranty Expiry</label>
                  <div>{formatDate(serial.warrantyExpiryDate)}</div>
                </div>
              )}

              <div className="detail-item">
                <label>Created</label>
                <div>{formatDate(serial.firstReceivedDate)}</div>
              </div>

              <div className="detail-item">
                <label>Last Updated</label>
                <div>{formatDate(serial.updatedAt)}</div>
              </div>
            </div>
          </Card>

          {/* Quick Actions */}
          <div className="serial-detail-section">
            <h3>Quick Actions</h3>
            <div className="serial-detail-actions-grid">
              <Button variant="primary" onClick={handleMoveSerial} size="sm" disabled={loading}>
                Move Serial
              </Button>
              {serial.currentStatus === 'BLOCKED' ? (
                <Button variant="secondary" onClick={handleUnblockSerial} size="sm" disabled={loading}>
                  Unblock
                </Button>
              ) : (
                <Button variant="secondary" onClick={handleBlockSerial} size="sm" disabled={loading}>
                  Block
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={handleMarkDamaged}
                size="sm"
                disabled={loading || serial.currentStatus === 'DAMAGED'}
              >
                Mark Damaged
              </Button>
            </div>
          </div>

          {/* Movement Timeline */}
          <div className="serial-detail-section">
            <SerialTimeline
              history={history}
              onMovementClick={(movementId) => {
                // Close sidebar first, then navigate
                onClose();
                // Use setTimeout to ensure sidebar closes before navigation
                setTimeout(() => {
                  const params = new URLSearchParams();
                  params.set('tab', 'movements');
                  params.set('movementId', movementId);
                  navigate(`/inventory?${params.toString()}`);
                }, 100);
              }}
              loading={loading && history.length === 0}
            />
          </div>
        </div>
      )}

      {/* Status Update Modal - Use Modal component for custom content */}
      {showStatusUpdate && serial && (
        <div className="status-update-modal-overlay" onClick={() => {
          setShowStatusUpdate(false);
          setNewStatus('');
        }}>
          <div className="status-update-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Update Serial Status</h3>
            <p>Update status for serial <strong>{serial.serialNumber}</strong>?</p>
            <div style={{ marginTop: '16px' }}>
              <label>New Status</label>
              <select
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value)}
                style={{ width: '100%', padding: '8px', marginTop: '8px', fontSize: '14px' }}
              >
                <option value="">Select Status</option>
                <option value="AVAILABLE">Available</option>
                <option value="RESERVED">Reserved</option>
                <option value="BLOCKED">Blocked</option>
                <option value="DAMAGED">Damaged</option>
                <option value="DISPOSED">Disposed</option>
                <option value="IN_TRANSIT">In Transit</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '20px', justifyContent: 'flex-end' }}>
              <Button
                variant="secondary"
                onClick={() => {
                  setShowStatusUpdate(false);
                  setNewStatus('');
                }}
                size="sm"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleUpdateStatus}
                disabled={!newStatus || updating}
                size="sm"
              >
                {updating ? 'Updating...' : 'Update'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </SideDrawer>
  );
};
