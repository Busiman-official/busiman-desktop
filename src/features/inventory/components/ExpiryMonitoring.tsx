/**
 * Expiry Monitoring Component - Monitor and manage expiry dates
 */

import React, { useState, useEffect } from 'react';
import {
  inventoryService,
  ExpiryAlert,
  InventoryItem,
  Location,
} from '@/services/inventory.service';
import { Button, Input, Card, Select } from '@/shared/components/ui';
import { LoadingState, EmptyState, ErrorState } from '@/shared/components/data-display';
import { extractErrorMessage } from '@/utils/error';
import { logger } from '@/shared/utils/logger';
import { ConfirmDialog } from '@/shared/components/modals';
import { movementItemPickerLabel } from '../utils/itemDisplaySku';
import './ExpiryMonitoring.css';

type ViewMode = 'alerts' | 'dispose';

export const ExpiryMonitoring: React.FC = () => {
  const [alerts, setAlerts] = useState<ExpiryAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('alerts');
  const [daysAhead, setDaysAhead] = useState(30);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [showDisposeDialog, setShowDisposeDialog] = useState(false);
  const [itemToDispose, setItemToDispose] = useState<{
    itemId: string;
    locationId: string;
    batchNumber: string;
  } | null>(null);
  const [disposeReason, setDisposeReason] = useState('');

  const [disposeForm, setDisposeForm] = useState({
    itemId: '',
    locationId: '',
    batchNumber: '',
    reason: '',
  });

  // Load functions - defined before useEffects to avoid TDZ errors
  const loadAlerts = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await inventoryService.getExpiryAlerts(daysAhead);
      setAlerts(data);
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to load expiry alerts');
      setError(message);
      logger.error('[ExpiryMonitoring] Failed to load alerts', err);
    } finally {
      setLoading(false);
    }
  };

  const loadItems = async () => {
    try {
      const data = await inventoryService.getAllItems({ isActive: true });
      setItems(data);
    } catch (err) {
      logger.error('[ExpiryMonitoring] Failed to load items', err);
    }
  };

  const loadLocations = async () => {
    try {
      const data = await inventoryService.getAllLocations({ isActive: true });
      setLocations(data);
    } catch (err) {
      logger.error('[ExpiryMonitoring] Failed to load locations', err);
    }
  };

  useEffect(() => {
    loadAlerts();
    loadItems();
    loadLocations();
  }, [daysAhead]);

  const handleDispose = async (reason?: string) => {
    if (!itemToDispose || !reason) return;
    setError(null);
    setSuccess(null);
    try {
      await inventoryService.disposeExpiredStock({
        itemId: itemToDispose.itemId,
        locationId: itemToDispose.locationId,
        batchNumber: itemToDispose.batchNumber,
        reason,
      });
      setSuccess('Expired stock disposed successfully');
      setShowDisposeDialog(false);
      setItemToDispose(null);
      setDisposeReason('');
      loadAlerts();
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to dispose expired stock');
      setError(message);
      logger.error('[ExpiryMonitoring] Failed to dispose stock', err);
    }
  };

  const handleDisposeForm = async () => {
    setError(null);
    setSuccess(null);
    try {
      await inventoryService.disposeExpiredStock({
        itemId: disposeForm.itemId,
        locationId: disposeForm.locationId,
        batchNumber: disposeForm.batchNumber,
        reason: disposeForm.reason,
      });
      setSuccess('Expired stock disposed successfully');
      setDisposeForm({
        itemId: '',
        locationId: '',
        batchNumber: '',
        reason: '',
      });
      loadAlerts();
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to dispose expired stock');
      setError(message);
      logger.error('[ExpiryMonitoring] Failed to dispose stock', err);
    }
  };

  const renderAlerts = () => (
    <div className="expiry-alerts">
      <div className="expiry-monitoring-toolbar">
        <div className="expiry-monitoring-filters">
          <label>
            Days Ahead:
            <Input
              type="number"
              value={daysAhead}
              onChange={(e) => setDaysAhead(parseInt(e.target.value, 10) || 30)}
              style={{ width: '100px', marginLeft: '10px' }}
              min="1"
            />
          </label>
        </div>
        <Button variant="secondary" onClick={() => setViewMode('dispose')}>
          Dispose Expired Stock
        </Button>
      </div>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      {loading ? (
        <LoadingState message="Loading expiry alerts..." />
      ) : alerts.length === 0 ? (
        <EmptyState message="No items expiring in the selected period" />
      ) : (
        <div className="expiry-alerts-table">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Location</th>
                <th>Batch</th>
                <th>Quantity</th>
                <th>Expiry Date</th>
                <th>Days Until Expiry</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((alert, index) => (
                <tr key={index}>
                  <td>{alert.item.name}</td>
                  <td>{alert.location.code}</td>
                  <td>{alert.batchNumber || '-'}</td>
                  <td>{alert.quantity}</td>
                  <td>{new Date(alert.expiryDate).toLocaleDateString()}</td>
                  <td>
                    <span
                      className={
                        alert.daysUntilExpiry <= 0
                          ? 'days-expired'
                          : alert.daysUntilExpiry <= 7
                          ? 'days-critical'
                          : alert.daysUntilExpiry <= 30
                          ? 'days-warning'
                          : 'days-ok'
                      }
                    >
                      {alert.daysUntilExpiry}
                    </span>
                  </td>
                  <td>
                    <span className={`expiry-status-${alert.expiryStatus.toLowerCase()}`}>
                      {alert.expiryStatus}
                    </span>
                  </td>
                  <td>
                    {alert.daysUntilExpiry <= 0 && (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => {
                          setItemToDispose({
                            itemId: alert.itemId,
                            locationId: alert.locationId,
                            batchNumber: alert.batchNumber || '',
                          });
                          setShowDisposeDialog(true);
                        }}
                      >
                        Dispose
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const renderDispose = () => (
    <Card className="expiry-dispose-form">
      <h2>Dispose Expired Stock</h2>
      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      <div className="form-group">
        <label>Item *</label>
        <Select
          value={disposeForm.itemId}
          onChange={(e) => setDisposeForm({ ...disposeForm, itemId: e.target.value })}
        >
          <option value="">Select Item</option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {movementItemPickerLabel(item)}
            </option>
          ))}
        </Select>
      </div>

      <div className="form-group">
        <label>Location *</label>
        <Select
          value={disposeForm.locationId}
          onChange={(e) => setDisposeForm({ ...disposeForm, locationId: e.target.value })}
        >
          <option value="">Select Location</option>
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.code} - {loc.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="form-group">
        <label>Batch Number *</label>
        <Input
          value={disposeForm.batchNumber}
          onChange={(e) =>
            setDisposeForm({ ...disposeForm, batchNumber: e.target.value.toUpperCase() })
          }
          placeholder="BATCH-001"
        />
      </div>

      <div className="form-group">
        <label>Reason *</label>
        <textarea
          value={disposeForm.reason}
          onChange={(e) => setDisposeForm({ ...disposeForm, reason: e.target.value })}
          rows={3}
          placeholder="Reason for disposal"
        />
      </div>

      <div className="form-actions">
        <Button variant="secondary" onClick={() => setViewMode('alerts')}>
          Cancel
        </Button>
        <Button variant="danger" onClick={handleDisposeForm}>
          Dispose Stock
        </Button>
      </div>
    </Card>
  );

  return (
    <div className="expiry-monitoring">
      {viewMode === 'alerts' && renderAlerts()}
      {viewMode === 'dispose' && renderDispose()}

      <ConfirmDialog
        isOpen={showDisposeDialog}
        title="Dispose Expired Stock"
        message="Please provide a reason for disposing this expired stock."
        requiresReason={true}
        onConfirm={(reason) => handleDispose(reason)}
        onCancel={() => {
          setShowDisposeDialog(false);
          setItemToDispose(null);
          setDisposeReason('');
        }}
        variant="danger"
      />
    </div>
  );
};
