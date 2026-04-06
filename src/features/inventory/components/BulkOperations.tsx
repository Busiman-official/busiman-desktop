/**
 * Bulk Operations Component - Bulk variant creation, serial attribute updates, etc.
 */

import React, { useState } from 'react';
import {
  inventoryService,
  InventoryItem,
  CreateVariantRequest,
} from '@/services/inventory.service';
import { Button, Input, Card, Select } from '@/shared/components/ui';
import { LoadingState, EmptyState } from '@/shared/components/data-display';
import { extractErrorMessage } from '@/utils/error';
import { logger } from '@/shared/utils/logger';
import { itemDisplaySku } from '../utils/itemDisplaySku';
import './BulkOperations.css';

type BulkOperationType = 'variants' | 'serial-attributes';

export const BulkOperations: React.FC = () => {
  const [operationType, setOperationType] = useState<BulkOperationType>('variants');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [csvData, setCsvData] = useState<string>('');
  const [results, setResults] = useState<Array<{ success: boolean; message: string }>>([]);

  React.useEffect(() => {
    loadItems();
  }, []);

  const loadItems = async () => {
    try {
      const data = await inventoryService.getAllItems({});
      setItems(data.filter((item) => item.hasVariants));
    } catch (err: any) {
      logger.error('[BulkOperations] Failed to load items', err);
    }
  };

  const parseCSV = (csv: string): string[][] => {
    const lines = csv.trim().split('\n');
    return lines.map((line) => {
      // Handle quoted values
      const values: string[] = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim());
      return values;
    });
  };

  const handleBulkCreateVariants = async () => {
    if (!selectedItemId || !csvData.trim()) {
      setError('Please select an item and provide CSV data');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);
    setResults([]);

    try {
      const lines = parseCSV(csvData);
      if (lines.length === 0) {
        setError('CSV data is empty');
        return;
      }

      const results: Array<{ success: boolean; message: string }> = [];

      // Expected format: code, name, isDefault (optional), barcode (optional)
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.length < 2) {
          results.push({ success: false, message: `Line ${i + 1}: Insufficient columns` });
          continue;
        }

        const [code, name, isDefault, barcode] = line;

        try {
          const variantData: CreateVariantRequest = {
            itemId: selectedItemId,
            code: code.trim().toUpperCase(),
            name: name.trim(),
            isDefault: isDefault?.toLowerCase() === 'true' || isDefault?.toLowerCase() === 'yes',
            barcode: barcode?.trim() || undefined,
          };

          await inventoryService.createVariant(variantData);
          results.push({ success: true, message: `Line ${i + 1}: Created variant ${code}` });
        } catch (err: any) {
          const message = extractErrorMessage(err, `Line ${i + 1}: Failed`);
          results.push({ success: false, message });
        }
      }

      setResults(results);
      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success).length;
      setSuccess(`Completed: ${successCount} succeeded, ${failCount} failed`);
      setCsvData('');
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to process bulk operation');
      setError(message);
      logger.error('[BulkOperations] Failed to bulk create variants', err);
    } finally {
      setLoading(false);
    }
  };

  const handleBulkUpdateSerialAttributes = async () => {
    if (!csvData.trim()) {
      setError('Please provide CSV data');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);
    setResults([]);

    try {
      const lines = parseCSV(csvData);
      if (lines.length === 0) {
        setError('CSV data is empty');
        return;
      }

      const results: Array<{ success: boolean; message: string }> = [];

      // Expected format: serialNumber, attributeKey1, attributeValue1, attributeKey2, attributeValue2, ...
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.length < 3 || line.length % 2 === 0) {
          results.push({ success: false, message: `Line ${i + 1}: Invalid format (need serialNumber and key-value pairs)` });
          continue;
        }

        const serialNumber = line[0].trim().toUpperCase();
        const attributes: Record<string, any> = {};

        // Parse key-value pairs
        for (let j = 1; j < line.length; j += 2) {
          if (j + 1 < line.length) {
            const key = line[j].trim();
            const value = line[j + 1].trim();
            attributes[key] = value;
          }
        }

        try {
          await inventoryService.updateSerialAttributes(serialNumber, attributes);
          results.push({ success: true, message: `Line ${i + 1}: Updated ${serialNumber}` });
        } catch (err: any) {
          const message = extractErrorMessage(err, `Line ${i + 1}: Failed`);
          results.push({ success: false, message });
        }
      }

      setResults(results);
      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success).length;
      setSuccess(`Completed: ${successCount} succeeded, ${failCount} failed`);
      setCsvData('');
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to process bulk operation');
      setError(message);
      logger.error('[BulkOperations] Failed to bulk update serial attributes', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bulk-operations">
      <Card className="bulk-operations-card">
        <h2>Bulk Operations</h2>

        <div className="operation-selector">
          <label>Operation Type</label>
          <Select
            value={operationType}
            onChange={(e) => {
              setOperationType(e.target.value as BulkOperationType);
              setCsvData('');
              setResults([]);
              setError(null);
              setSuccess(null);
            }}
          >
            <option value="variants">Bulk Create Variants</option>
            <option value="serial-attributes">Bulk Update Serial Attributes</option>
          </Select>
        </div>

        {operationType === 'variants' && (
          <div className="form-group">
            <label>Item *</label>
            <Select
              value={selectedItemId}
              onChange={(e) => setSelectedItemId(e.target.value)}
            >
              <option value="">Select Item</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {itemDisplaySku(item)} - {item.name}
                </option>
              ))}
            </Select>
          </div>
        )}

        <div className="form-group">
          <label>
            CSV Data *
            <span className="help-text">
              {operationType === 'variants'
                ? 'Format: code, name, isDefault (optional), barcode (optional)'
                : 'Format: serialNumber, attributeKey1, attributeValue1, attributeKey2, attributeValue2, ...'}
            </span>
          </label>
          <textarea
            value={csvData}
            onChange={(e) => setCsvData(e.target.value)}
            rows={10}
            placeholder={
              operationType === 'variants'
                ? 'VARIANT-001, Red - 32GB, true, BARCODE123\nVARIANT-002, Blue - 64GB, false, BARCODE124'
                : 'SN12345, customer, John Doe, state, CA\nSN12346, customer, Jane Smith, state, NY'
            }
            className="csv-input"
          />
        </div>

        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">{success}</div>}

        <div className="form-actions">
          <Button
            variant="primary"
            onClick={
              operationType === 'variants'
                ? handleBulkCreateVariants
                : handleBulkUpdateSerialAttributes
            }
            disabled={loading || !csvData.trim()}
          >
            {loading ? 'Processing...' : 'Execute Bulk Operation'}
          </Button>
        </div>

        {results.length > 0 && (
          <div className="results-section">
            <h3>Results</h3>
            <div className="results-list">
              {results.map((result, index) => (
                <div
                  key={index}
                  className={`result-item ${result.success ? 'success' : 'error'}`}
                >
                  {result.success ? '✓' : '✗'} {result.message}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};
