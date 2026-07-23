/**
 * Serial Lookup Component - Search and view serial number details and history
 */

import React, { useState } from 'react';
import {
  inventoryService,
  SerialResponse,
  Location,
} from '@/services/inventory.service';
import { Button, Input, Card, Select } from '@/shared/components/ui';
import { LoadingState, EmptyState } from '@/shared/components/data-display';
import { extractErrorMessage } from '@/utils/error';
import { logger } from '@/shared/utils/logger';
// SerialStatus enum values
const SerialStatus = {
  AVAILABLE: 'AVAILABLE',
  RESERVED: 'RESERVED',
  BLOCKED: 'BLOCKED',
  DAMAGED: 'DAMAGED',
  SOLD: 'SOLD',
} as const;
import { serialLineSku } from '../utils/itemDisplaySku';
import './SerialLookup.css';

interface SerialHistoryEntry {
  movementId: string;
  movementNumber: string;
  movementType: string;
  date: string;
  fromLocation?: { id: string; code: string; name: string };
  toLocation?: { id: string; code: string; name: string };
  quantity: number;
  status: string;
}

export const SerialLookup: React.FC = () => {
  const [searchInput, setSearchInput] = useState('');
  const [serial, setSerial] = useState<SerialResponse | null>(null);
  const [history, setHistory] = useState<SerialHistoryEntry[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showUpdateLocation, setShowUpdateLocation] = useState(false);
  const [showUpdateStatus, setShowUpdateStatus] = useState(false);
  const [newLocationId, setNewLocationId] = useState('');
  const [newStatus, setNewStatus] = useState('');

  const loadLocations = async () => {
    try {
      const data = await inventoryService.getLocations();
      setLocations(data);
    } catch (err: any) {
      logger.error('[SerialLookup] Failed to load locations', err);
    }
  };

  const handleSearch = async () => {
    if (!searchInput.trim()) {
      setError('Please enter a serial number');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);
    setSerial(null);
    setHistory([]);

    try {
      const serialData = await inventoryService.getSerialByNumber(searchInput.trim());
      setSerial(serialData);

      // Load history
      try {
        const historyData = await inventoryService.getSerialHistory(searchInput.trim());
        setHistory(historyData);
      } catch (err: any) {
        logger.warn('[SerialLookup] Failed to load history', err);
      }

      // Load locations for update actions
      if (locations.length === 0) {
        loadLocations();
      }
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to find serial number');
      setError(message);
      logger.error('[SerialLookup] Failed to search serial', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateLocation = async () => {
    if (!serial || !newLocationId) {
      setError('Please select a location');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Note: This would require a new endpoint or using movement
      // For now, we'll show an error that this needs to be done via movement
      setError('Location updates must be done through stock movements');
      setShowUpdateLocation(false);
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to update location');
      setError(message);
      logger.error('[SerialLookup] Failed to update location', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async () => {
    if (!serial || !newStatus) {
      setError('Please select a status');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const updated = await inventoryService.updateSerialStatus(serial.serialNumber, newStatus);
      setSerial(updated);
      setSuccess('Status updated successfully');
      setShowUpdateStatus(false);
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to update status');
      setError(message);
      logger.error('[SerialLookup] Failed to update status', err);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const formatAttributes = (attributes?: Record<string, any>) => {
    if (!attributes || Object.keys(attributes).length === 0) {
      return 'None';
    }
    return Object.entries(attributes)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');
  };

  return (
    <div className="serial-lookup">
      <Card className="serial-search-card">
        <h2>Serial Number Lookup</h2>
        <div className="search-section">
          <div className="search-input-group">
            <Input
              placeholder="Enter serial number..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleSearch();
                }
              }}
              style={{ flex: 1 }}
            />
            <Button variant="primary" onClick={handleSearch} disabled={loading}>
              Search
            </Button>
          </div>
        </div>

        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">{success}</div>}

        {loading && <LoadingState message="Searching..." />}
      </Card>

      {serial && (
        <>
          <Card className="serial-details-card">
            <h3>Serial Details</h3>
            <div className="details-grid">
              <div className="detail-item">
                <label>Serial Number</label>
                <div className="detail-value">{serial.serialNumber}</div>
              </div>
              <div className="detail-item">
                <label>Item</label>
                <div className="detail-value">
                  {serial.item
                    ? `${serialLineSku(serial)} - ${serial.item.name}`
                    : serial.itemId}
                </div>
              </div>
              {serial.variantId && (
                <div className="detail-item">
                  <label>Variant</label>
                  <div className="detail-value">
                    {serial.variant ? `${serial.variant.code} - ${serial.variant.name}` : serial.variantId}
                  </div>
                </div>
              )}
              <div className="detail-item">
                <label>Current Location</label>
                <div className="detail-value">
                  {serial.currentLocation
                    ? `${serial.currentLocation.code} - ${serial.currentLocation.name}`
                    : serial.currentLocationId}
                </div>
              </div>
              <div className="detail-item">
                <label>Status</label>
                <div className="detail-value">
                  <span className={`status-badge status-${serial.currentStatus.toLowerCase()}`}>
                    {serial.currentStatus}
                  </span>
                </div>
              </div>
              {serial.batchNumber && (
                <div className="detail-item">
                  <label>Batch Number</label>
                  <div className="detail-value">{serial.batchNumber}</div>
                </div>
              )}
              {serial.manufacturingDate && (
                <div className="detail-item">
                  <label>Manufacturing Date</label>
                  <div className="detail-value">{formatDate(serial.manufacturingDate)}</div>
                </div>
              )}
              {serial.expiryDate && (
                <div className="detail-item">
                  <label>Expiry Date</label>
                  <div className="detail-value">{formatDate(serial.expiryDate)}</div>
                </div>
              )}
              {serial.warrantyExpiryDate && (
                <div className="detail-item">
                  <label>Warranty Expiry</label>
                  <div className="detail-value">{formatDate(serial.warrantyExpiryDate)}</div>
                </div>
              )}
              {serial.attributes && Object.keys(serial.attributes).length > 0 && (
                <div className="detail-item full-width">
                  <label>Custom Attributes</label>
                  <div className="detail-value">{formatAttributes(serial.attributes)}</div>
                </div>
              )}
            </div>

            <div className="quick-actions">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowUpdateStatus(true);
                  setNewStatus(serial.currentStatus);
                }}
              >
                Update Status
              </Button>
            </div>
          </Card>

          {history.length > 0 && (
            <Card className="serial-history-card">
              <h3>Movement History</h3>
              <div className="history-timeline">
                {history.map((entry, index) => (
                  <div key={entry.movementId} className="history-entry">
                    <div className="history-date">{formatDate(entry.date)}</div>
                    <div className="history-content">
                      <div className="history-type">{entry.movementType}</div>
                      <div className="history-details">
                        {entry.fromLocation && (
                          <span>From: {entry.fromLocation.code} - {entry.fromLocation.name}</span>
                        )}
                        {entry.toLocation && (
                          <span>To: {entry.toLocation.code} - {entry.toLocation.name}</span>
                        )}
                        <span>Qty: {entry.quantity > 0 ? '+' : ''}{entry.quantity}</span>
                        <span>Status: {entry.status}</span>
                      </div>
                      <div className="history-number">Movement: {entry.movementNumber}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {showUpdateStatus && serial && (
        <Card className="update-modal">
          <h3>Update Status</h3>
          <div className="form-group">
            <label>New Status</label>
            <Select value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
              <option value="AVAILABLE">AVAILABLE</option>
              <option value="RESERVED">RESERVED</option>
              <option value="BLOCKED">BLOCKED</option>
              <option value="DAMAGED">DAMAGED</option>
              <option value="SOLD">SOLD</option>
            </Select>
          </div>
          <div className="form-actions">
            <Button variant="secondary" onClick={() => setShowUpdateStatus(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleUpdateStatus} disabled={loading}>
              Update
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
};
