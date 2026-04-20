/**
 * Batch Management Component - Manage batches and FEFO allocation
 */

import React, { useState, useEffect } from 'react';
import {
  inventoryService,
  BatchResponse,
  CreateBatchRequest,
  FEFOAllocation,
  InventoryItem,
} from '@/services/inventory.service';
import { Button, Input, Card, Select } from '@/shared/components/ui';
import { LoadingState, EmptyState, ErrorState } from '@/shared/components/data-display';
import { extractErrorMessage } from '@/utils/error';
import { logger } from '@/shared/utils/logger';
import { ConfirmDialog } from '@/shared/components/modals';
import { movementItemPickerLabel } from '../utils/itemDisplaySku';
import './BatchManagement.css';

type ViewMode = 'list' | 'create' | 'fefo' | 'near-expiry';

export const BatchManagement: React.FC = () => {
  const [batches, setBatches] = useState<BatchResponse[]>([]);
  const [nearExpiryBatches, setNearExpiryBatches] = useState<BatchResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [locations, setLocations] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [fefoResult, setFefoResult] = useState<FEFOAllocation[]>([]);
  const [fefoForm, setFefoForm] = useState({
    itemId: '',
    locationId: '',
    quantity: 0,
  });
  const [showDisposeDialog, setShowDisposeDialog] = useState(false);
  const [batchToDispose, setBatchToDispose] = useState<{ batchNumber: string; itemId: string } | null>(null);
  const [disposeReason, setDisposeReason] = useState('');

  const [formData, setFormData] = useState<CreateBatchRequest>({
    batchNumber: '',
    itemId: '',
    manufacturingDate: new Date().toISOString().split('T')[0],
  });

  // Load functions - defined before useEffects to avoid TDZ errors
  const loadItems = async () => {
    try {
      const data = await inventoryService.getAllItems({ isActive: true });
      setItems(data);
    } catch (err) {
      logger.error('[BatchManagement] Failed to load items', err);
    }
  };

  const loadLocations = async () => {
    try {
      const data = await inventoryService.getAllLocations({ isActive: true });
      setLocations(data.map((loc) => ({ id: loc.id, code: loc.code, name: loc.name })));
    } catch (err) {
      logger.error('[BatchManagement] Failed to load locations', err);
    }
  };

  const loadBatches = async () => {
    if (!selectedItemId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await inventoryService.getBatchesByItem(selectedItemId);
      setBatches(data);
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to load batches');
      setError(message);
      logger.error('[BatchManagement] Failed to load batches', err);
    } finally {
      setLoading(false);
    }
  };

  const loadNearExpiryBatches = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await inventoryService.getNearExpiryBatches(30);
      setNearExpiryBatches(data);
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to load near-expiry batches');
      setError(message);
      logger.error('[BatchManagement] Failed to load near-expiry batches', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
    loadLocations();
  }, []);

  useEffect(() => {
    if (viewMode === 'list' && selectedItemId) {
      loadBatches();
    } else if (viewMode === 'near-expiry') {
      loadNearExpiryBatches();
    }
  }, [viewMode, selectedItemId]);

  const handleCreate = async () => {
    setError(null);
    setSuccess(null);
    try {
      await inventoryService.createBatch(formData);
      setSuccess('Batch created successfully');
      setViewMode('list');
      setFormData({
        batchNumber: '',
        itemId: '',
        manufacturingDate: new Date().toISOString().split('T')[0],
      });
      if (selectedItemId) {
        loadBatches();
      }
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to create batch');
      setError(message);
      logger.error('[BatchManagement] Failed to create batch', err);
    }
  };

  const handleFEFO = async () => {
    setError(null);
    setSuccess(null);
    try {
      const result = await inventoryService.getFEFOStock(
        fefoForm.itemId,
        fefoForm.locationId,
        fefoForm.quantity
      );
      setFefoResult(result);
      setSuccess('FEFO allocation calculated successfully');
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to calculate FEFO allocation');
      setError(message);
      logger.error('[BatchManagement] Failed to calculate FEFO', err);
    }
  };

  const handleDispose = async (reason?: string) => {
    if (!batchToDispose || !reason) return;
    setError(null);
    setSuccess(null);
    try {
      await inventoryService.disposeBatch(batchToDispose.batchNumber, batchToDispose.itemId, reason);
      setSuccess('Batch disposed successfully');
      setShowDisposeDialog(false);
      setBatchToDispose(null);
      setDisposeReason('');
      loadBatches();
      loadNearExpiryBatches();
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to dispose batch');
      setError(message);
      logger.error('[BatchManagement] Failed to dispose batch', err);
    }
  };

  const renderList = () => (
    <div className="batch-management-list">
      <div className="batch-management-toolbar">
        <div className="batch-management-filters">
          <Select
            value={selectedItemId}
            onChange={(e) => setSelectedItemId(e.target.value)}
            style={{ width: '300px' }}
          >
            <option value="">Select Item</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {movementItemPickerLabel(item)}
              </option>
            ))}
          </Select>
        </div>
        <div className="batch-management-actions">
          <Button variant="secondary" onClick={() => setViewMode('near-expiry')}>
            Near Expiry
          </Button>
          <Button variant="secondary" onClick={() => setViewMode('fefo')}>
            FEFO Allocation
          </Button>
          <Button variant="primary" onClick={() => setViewMode('create')}>
            Create Batch
          </Button>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      {!selectedItemId ? (
        <EmptyState message="Please select an item to view batches" />
      ) : loading ? (
        <LoadingState message="Loading batches..." />
      ) : batches.length === 0 ? (
        <EmptyState message="No batches found for this item" />
      ) : (
        <div className="batch-management-table">
          <table>
            <thead>
              <tr>
                <th>Batch Number</th>
                <th>Manufacturing Date</th>
                <th>Expiry Date</th>
                <th>Total Quantity</th>
                <th>Expiry Status</th>
                <th>Is Expired</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((batch) => (
                <tr key={batch.id}>
                  <td>{batch.batchNumber}</td>
                  <td>{new Date(batch.manufacturingDate).toLocaleDateString()}</td>
                  <td>{batch.expiryDate ? new Date(batch.expiryDate).toLocaleDateString() : '-'}</td>
                  <td>{batch.totalQuantity}</td>
                  <td>
                    <span className={`expiry-status-${batch.expiryStatus.toLowerCase()}`}>
                      {batch.expiryStatus}
                    </span>
                  </td>
                  <td>{batch.isExpired ? 'Yes' : 'No'}</td>
                  <td>
                    {batch.isExpired && (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => {
                          setBatchToDispose({
                            batchNumber: batch.batchNumber,
                            itemId: batch.itemId,
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

  const renderNearExpiry = () => (
    <div className="batch-near-expiry">
      <div className="batch-management-toolbar">
        <h2>Near Expiry Batches</h2>
        <Button variant="secondary" onClick={() => setViewMode('list')}>
          Back to List
        </Button>
      </div>
      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}
      {loading ? (
        <LoadingState message="Loading near-expiry batches..." />
      ) : nearExpiryBatches.length === 0 ? (
        <EmptyState message="No batches expiring soon" />
      ) : (
        <div className="batch-management-table">
          <table>
            <thead>
              <tr>
                <th>Batch Number</th>
                <th>Item</th>
                <th>Expiry Date</th>
                <th>Days Until Expiry</th>
                <th>Total Quantity</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {nearExpiryBatches.map((batch) => (
                <tr key={batch.id}>
                  <td>{batch.batchNumber}</td>
                  <td>{batch.item?.name || batch.itemId}</td>
                  <td>{batch.expiryDate ? new Date(batch.expiryDate).toLocaleDateString() : '-'}</td>
                  <td>
                    {batch.expiryDate
                      ? Math.ceil(
                          (new Date(batch.expiryDate).getTime() - new Date().getTime()) /
                            (1000 * 60 * 60 * 24)
                        )
                      : '-'}
                  </td>
                  <td>{batch.totalQuantity}</td>
                  <td>
                    <span className={`expiry-status-${batch.expiryStatus.toLowerCase()}`}>
                      {batch.expiryStatus}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const renderFEFO = () => (
    <Card className="batch-fefo">
      <h2>FEFO Allocation Calculator</h2>
      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      <div className="form-group">
        <label>Item *</label>
        <Select
          value={fefoForm.itemId}
          onChange={(e) => setFefoForm({ ...fefoForm, itemId: e.target.value })}
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
          value={fefoForm.locationId}
          onChange={(e) => setFefoForm({ ...fefoForm, locationId: e.target.value })}
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
        <label>Quantity Required *</label>
        <Input
          type="number"
          value={fefoForm.quantity || ''}
          onChange={(e) =>
            setFefoForm({ ...fefoForm, quantity: parseFloat(e.target.value) || 0 })
          }
          min="0.01"
          step="0.01"
        />
      </div>

      <div className="form-actions">
        <Button variant="secondary" onClick={() => setViewMode('list')}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleFEFO}>
          Calculate FEFO
        </Button>
      </div>

      {fefoResult.length > 0 && (
        <div className="fefo-results">
          <h3>FEFO Allocation Results</h3>
          <table>
            <thead>
              <tr>
                <th>Batch Number</th>
                <th>Quantity</th>
                <th>Expiry Date</th>
              </tr>
            </thead>
            <tbody>
              {fefoResult.map((allocation, index) => (
                <tr key={index}>
                  <td>{allocation.batchNumber}</td>
                  <td>{allocation.quantity}</td>
                  <td>
                    {allocation.expiryDate
                      ? new Date(allocation.expiryDate).toLocaleDateString()
                      : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );

  const renderForm = () => (
    <Card className="batch-management-form">
      <h2>Create Batch</h2>
      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      <div className="form-group">
        <label>Batch Number *</label>
        <Input
          value={formData.batchNumber}
          onChange={(e) =>
            setFormData({ ...formData, batchNumber: e.target.value.toUpperCase() })
          }
          placeholder="BATCH-001"
        />
      </div>

      <div className="form-group">
        <label>Item *</label>
        <Select
          value={formData.itemId}
          onChange={(e) => setFormData({ ...formData, itemId: e.target.value })}
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
        <label>Manufacturing Date *</label>
        <Input
          type="date"
          value={formData.manufacturingDate}
          onChange={(e) => setFormData({ ...formData, manufacturingDate: e.target.value })}
        />
      </div>

      <div className="form-group">
        <label>Expiry Date</label>
        <Input
          type="date"
          value={formData.expiryDate || ''}
          onChange={(e) =>
            setFormData({ ...formData, expiryDate: e.target.value || undefined })
          }
        />
      </div>

      <div className="form-group">
        <label>Manufacturing Location</label>
        <Input
          value={formData.manufacturingLocation || ''}
          onChange={(e) =>
            setFormData({ ...formData, manufacturingLocation: e.target.value || undefined })
          }
          placeholder="Factory location"
        />
      </div>

      <div className="form-group">
        <label>Supplier Batch Number</label>
        <Input
          value={formData.supplierBatchNumber || ''}
          onChange={(e) =>
            setFormData({ ...formData, supplierBatchNumber: e.target.value || undefined })
          }
          placeholder="Supplier batch reference"
        />
      </div>

      <div className="form-actions">
        <Button variant="secondary" onClick={() => setViewMode('list')}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleCreate}>
          Create Batch
        </Button>
      </div>
    </Card>
  );

  return (
    <div className="batch-management">
      {viewMode === 'list' && renderList()}
      {viewMode === 'near-expiry' && renderNearExpiry()}
      {viewMode === 'fefo' && renderFEFO()}
      {viewMode === 'create' && renderForm()}

      <ConfirmDialog
        isOpen={showDisposeDialog}
        title="Dispose Expired Batch"
        message="Please provide a reason for disposing this expired batch."
        requiresReason={true}
        onConfirm={(reason) => handleDispose(reason)}
        onCancel={() => {
          setShowDisposeDialog(false);
          setBatchToDispose(null);
          setDisposeReason('');
        }}
        variant="danger"
      />
    </div>
  );
};
