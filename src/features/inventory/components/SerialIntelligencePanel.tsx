/**
 * Serial Intelligence Panel - Enhanced serial tracking interface
 * Transformed from SerialLookup with grid, filters, and bulk operations
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { normalizeSerialNumber } from '../utils/serialNumber';
import { useSearchParams } from 'react-router-dom';
import {
  inventoryService,
  SerialResponse,
  Location,
} from '@/services/inventory.service';
import { Button, Input, Select } from '@/shared/components/ui';
import { LoadingState, EmptyState } from '@/shared/components/data-display';
import { SearchInput } from '@/shared/components/filters';
import { extractErrorMessage } from '@/utils/error';
import { logger } from '@/shared/utils/logger';
import { SerialGrid } from './SerialGrid';
import { SerialDetailPanel } from './SerialDetailPanel';
import { SerialBreadcrumb } from './SerialBreadcrumb';
import { applySerialFilters, searchSerials } from '../utils/serialUtils';
import { useOpenSerialDetail, useCloseSerialDetail } from '../utils/serialNavigation';
import './SerialIntelligencePanel.css';

interface SerialIntelligencePanelProps {
  itemId?: string;
  variantId?: string;
  locationId?: string;
  initialSearchQuery?: string;
}

export const SerialIntelligencePanel: React.FC<SerialIntelligencePanelProps> = ({
  itemId,
  variantId,
  locationId,
  initialSearchQuery = '',
}) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [serials, setSerials] = useState<SerialResponse[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Search and filters
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [filters, setFilters] = useState<{ status?: string; locationId?: string }>({
    locationId: locationId,
  });
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  
  // Selection
  const [selectedSerials, setSelectedSerials] = useState<Set<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  
  // Refs
  const searchInputRef = useRef<HTMLInputElement>(null);
  const openSerialDetail = useOpenSerialDetail();
  const closeSerialDetail = useCloseSerialDetail();

  // Load locations for filters
  useEffect(() => {
    const loadLocations = async () => {
      try {
        const data = await inventoryService.getAllLocations({ isActive: true });
        setLocations(data);
      } catch (err: any) {
        logger.error('[SerialIntelligencePanel] Failed to load locations', err);
      }
    };
    loadLocations();
  }, []);

  // Load serials
  useEffect(() => {
    if (itemId) {
      loadSerials();
    } else if (locationId) {
      // TODO: Load serials by location if endpoint exists
      loadSerials();
    }
  }, [itemId, variantId, locationId]);

  const loadSerials = async () => {
    if (!itemId) return;

    setLoading(true);
    setError(null);

    try {
      const data = await inventoryService.getSerialsByItem(
        itemId,
        locationId,
        undefined,
        variantId
      );
      setSerials(data);
      // Auto-select first result if search query matches
      if (searchQuery.trim() && data.length > 0) {
        const matching = data.find((s) =>
          s.serialNumber.includes(searchQuery.trim())
        );
        if (matching) {
          setFocusedIndex(data.indexOf(matching));
        }
      }
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to load serials');
      setError(message);
      logger.error('[SerialIntelligencePanel] Failed to load serials', err);
      setSerials([]);
    } finally {
      setLoading(false);
    }
  };

  // Apply filters and search
  const filteredSerials = useMemo(() => {
    let result = serials;

    // Apply filters
    result = applySerialFilters(result, {
      status: filters.status,
      locationId: filters.locationId,
      itemId: itemId,
      variantId: variantId,
    });

    // Apply search
    if (searchQuery.trim()) {
      result = searchSerials(result, searchQuery);
    }

    return result;
  }, [serials, filters, searchQuery, itemId, variantId]);

  // Handle serial click
  const handleSerialClick = useCallback(
    (serial: SerialResponse) => {
      openSerialDetail(serial.serialNumber, serial.itemId, serial.variantId);
    },
    [openSerialDetail]
  );

  // Handle sort
  const handleSort = useCallback((column: string, direction: 'asc' | 'desc') => {
    setSortColumn(column);
    setSortDirection(direction);
  }, []);

  // Handle filter change
  const handleFilterChange = useCallback(
    (newFilters: { status?: string; locationId?: string }) => {
      setFilters((prev) => ({ ...prev, ...newFilters }));
    },
    []
  );

  // Handle select all
  const handleSelectAll = useCallback(
    (selected: boolean) => {
      if (selected) {
        setSelectedSerials(new Set(filteredSerials.map((s) => s.id)));
      } else {
        setSelectedSerials(new Set());
      }
    },
    [filteredSerials]
  );

  // Handle serial select
  const handleSerialSelect = useCallback((serialId: string, selected: boolean) => {
    setSelectedSerials((prev) => {
      const newSet = new Set(prev);
      if (selected) {
        newSet.add(serialId);
      } else {
        newSet.delete(serialId);
      }
      return newSet;
    });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+F: Focus search
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Get selected serial for breadcrumb
  const selectedSerialNumber = searchParams.get('serialNumber');
  const selectedSerial = serials.find((s) => s.serialNumber === selectedSerialNumber);

  return (
    <div className="serial-intelligence-panel">
      {/* Breadcrumb */}
      {selectedSerial && (
        <SerialBreadcrumb
          itemId={selectedSerial.itemId}
          itemName={selectedSerial.item?.name}
          variantId={selectedSerial.variantId}
          variantName={selectedSerial.variant?.name}
          serialNumber={selectedSerial.serialNumber}
        />
      )}

      {/* Header: Search and Filters */}
      <div className="serial-intelligence-header">
        <div className="serial-search-wrapper">
          <SearchInput
            ref={searchInputRef}
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search by serial, item, location, or batch..."
            debounceMs={200}
          />
        </div>

        <div className="serial-filters">
          <Select
            value={filters.status || ''}
            onChange={(e) =>
              handleFilterChange({ status: e.target.value || undefined })
            }
            style={{ minWidth: '150px' }}
          >
            <option value="">All Statuses</option>
            <option value="AVAILABLE">Available</option>
            <option value="RESERVED">Reserved</option>
            <option value="BLOCKED">Blocked</option>
            <option value="DAMAGED">Damaged</option>
            <option value="DISPOSED">Disposed</option>
            <option value="IN_TRANSIT">In Transit</option>
          </Select>

          <Select
            value={filters.locationId || ''}
            onChange={(e) =>
              handleFilterChange({ locationId: e.target.value || undefined })
            }
            style={{ minWidth: '200px' }}
          >
            <option value="">All Locations</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.code} - {loc.name}
              </option>
            ))}
          </Select>

          {(filters.status || filters.locationId) && (
            <Button
              variant="ghost"
              onClick={() => setFilters({})}
              title="Clear filters"
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {selectedSerials.size > 0 && (
        <div className="serial-bulk-actions">
          <span className="bulk-selection-count">
            {selectedSerials.size} serial{selectedSerials.size !== 1 ? 's' : ''} selected
          </span>
          <div className="bulk-actions-buttons">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                // TODO: Implement bulk move
                logger.info('Bulk move not yet implemented');
              }}
            >
              Bulk Move
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                // TODO: Implement bulk block/unblock
                logger.info('Bulk block/unblock not yet implemented');
              }}
            >
              Bulk Block/Unblock
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                // Export CSV
                const selected = serials.filter((s) => selectedSerials.has(s.id));
                const csv = [
                  ['Serial Number', 'Item', 'Location', 'Status', 'Batch', 'Expiry'],
                  ...selected.map((s) => [
                    s.serialNumber,
                    s.item?.name || s.itemId,
                    s.currentLocation?.name || s.currentLocationId,
                    s.currentStatus,
                    s.batchNumber || '',
                    s.expiryDate || '',
                  ]),
                ]
                  .map((row) => row.map((cell) => `"${cell}"`).join(','))
                  .join('\n');
                const blob = new Blob([csv], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `serials-${new Date().toISOString().split('T')[0]}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Export CSV
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedSerials(new Set())}
            >
              Clear Selection
            </Button>
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="serial-intelligence-error" role="alert">
          {error}
        </div>
      )}

      {/* Main Content: Serial Grid */}
      <div className="serial-intelligence-content">
        {loading && serials.length === 0 ? (
          <LoadingState message="Loading serials..." />
        ) : filteredSerials.length === 0 ? (
          <EmptyState
            message={
              searchQuery.trim() || filters.status || filters.locationId
                ? 'No serials match your search or filters'
                : 'No serials found. Create a movement to register serials.'
            }
          />
        ) : (
          <SerialGrid
            serials={filteredSerials}
            selectedSerials={selectedSerials}
            onSerialClick={handleSerialClick}
            onSerialSelect={handleSerialSelect}
            onSelectAll={handleSelectAll}
            sortColumn={sortColumn}
            sortDirection={sortDirection}
            onSort={handleSort}
            filters={filters}
            onFilterChange={handleFilterChange}
            loading={loading}
            selectedSerialId={selectedSerialNumber}
          />
        )}
      </div>

      {/* Serial Detail Panel */}
      <SerialDetailPanel
        isOpen={!!selectedSerialNumber}
        onClose={closeSerialDetail}
        serialNumber={selectedSerialNumber}
      />
    </div>
  );
};
