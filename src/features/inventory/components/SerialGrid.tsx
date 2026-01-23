/**
 * Serial Grid Component - Enhanced table with sorting, filtering, and multi-select
 */

import React, { useMemo, useCallback } from 'react';
import { SerialResponse } from '@/services/inventory.service';
import {
  filterSerialsByStatus,
  filterSerialsByLocation,
  searchSerials,
  sortSerials,
  getSerialStatusAppearance,
  formatSerialDate,
} from '../utils/serialUtils';
import { LoadingState, EmptyState } from '@/shared/components/data-display';
import './SerialGrid.css';

export interface SerialGridProps {
  serials: SerialResponse[];
  selectedSerials: Set<string>;
  onSerialClick: (serial: SerialResponse) => void;
  onSerialSelect: (serialId: string, selected: boolean) => void;
  onSelectAll: (selected: boolean) => void;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc';
  onSort: (column: string, direction: 'asc' | 'desc') => void;
  filters: {
    status?: string;
    locationId?: string;
    search?: string;
  };
  onFilterChange: (filters: { status?: string; locationId?: string; search?: string }) => void;
  loading?: boolean;
  selectedSerialId?: string | null; // Highlight this serial
}

export const SerialGrid: React.FC<SerialGridProps> = ({
  serials,
  selectedSerials,
  onSerialClick,
  onSerialSelect,
  onSelectAll,
  sortColumn,
  sortDirection,
  onSort,
  filters,
  onFilterChange,
  loading = false,
  selectedSerialId,
}) => {
  // Apply filters and sorting
  const processedSerials = useMemo(() => {
    let result = [...serials];
    
    // Apply search
    if (filters.search) {
      result = searchSerials(result, filters.search);
    }
    
    // Apply status filter
    if (filters.status) {
      result = filterSerialsByStatus(result, filters.status);
    }
    
    // Apply location filter
    if (filters.locationId) {
      result = filterSerialsByLocation(result, filters.locationId);
    }
    
    // Apply sorting
    if (sortColumn) {
      result = sortSerials(result, sortColumn, sortDirection);
    }
    
    return result;
  }, [serials, filters, sortColumn, sortDirection]);

  const handleSort = useCallback(
    (column: string) => {
      if (sortColumn === column) {
        // Toggle direction
        onSort(column, sortDirection === 'asc' ? 'desc' : 'asc');
      } else {
        // New column, default to asc
        onSort(column, 'asc');
      }
    },
    [sortColumn, sortDirection, onSort]
  );

  const handleSelectAll = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onSelectAll(e.target.checked);
    },
    [onSelectAll]
  );

  const handleRowClick = useCallback(
    (serial: SerialResponse) => {
      onSerialClick(serial);
    },
    [onSerialClick]
  );

  const allSelected = processedSerials.length > 0 && processedSerials.every((s) => selectedSerials.has(s.id));
  const someSelected = processedSerials.some((s) => selectedSerials.has(s.id)) && !allSelected;

  if (loading) {
    return <LoadingState message="Loading serials..." />;
  }

  if (processedSerials.length === 0) {
    return (
      <EmptyState
        message={
          filters.search || filters.status || filters.locationId
            ? 'No serials match your filters'
            : 'No serials found'
        }
      />
    );
  }

  return (
    <div className="serial-grid">
      <div className="serial-grid-table-wrapper">
        <table className="serial-grid-table">
          <thead>
            <tr>
              <th className="serial-grid-checkbox-col">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(input) => {
                    if (input) input.indeterminate = someSelected;
                  }}
                  onChange={handleSelectAll}
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Select all serials"
                />
              </th>
              <th
                className="serial-grid-sortable"
                onClick={() => handleSort('serialNumber')}
              >
                Serial Number
                {sortColumn === 'serialNumber' && (
                  <span className="sort-indicator">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                )}
              </th>
              <th
                className="serial-grid-sortable"
                onClick={() => handleSort('itemName')}
              >
                Item
                {sortColumn === 'itemName' && (
                  <span className="sort-indicator">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                )}
              </th>
              <th
                className="serial-grid-sortable"
                onClick={() => handleSort('location')}
              >
                Location
                {sortColumn === 'location' && (
                  <span className="sort-indicator">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                )}
              </th>
              <th
                className="serial-grid-sortable"
                onClick={() => handleSort('status')}
              >
                Status
                {sortColumn === 'status' && (
                  <span className="sort-indicator">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                )}
              </th>
              <th
                className="serial-grid-sortable"
                onClick={() => handleSort('batch')}
              >
                Batch
                {sortColumn === 'batch' && (
                  <span className="sort-indicator">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                )}
              </th>
              <th
                className="serial-grid-sortable"
                onClick={() => handleSort('expiryDate')}
              >
                Expiry
                {sortColumn === 'expiryDate' && (
                  <span className="sort-indicator">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {processedSerials.map((serial) => {
              const appearance = getSerialStatusAppearance(serial);
              const isSelected = selectedSerials.has(serial.id);
              const isHighlighted = selectedSerialId === serial.serialNumber;
              
              return (
                <tr
                  key={serial.id}
                  className={`serial-grid-row ${isSelected ? 'selected' : ''} ${isHighlighted ? 'highlighted' : ''}`}
                  onClick={() => handleRowClick(serial)}
                  onDoubleClick={() => handleRowClick(serial)}
                >
                  <td className="serial-grid-checkbox-col">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => {
                        e.stopPropagation();
                        onSerialSelect(serial.id, e.target.checked);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select serial ${serial.serialNumber}`}
                    />
                  </td>
                  <td className="serial-grid-serial-col">
                    <strong>{serial.serialNumber}</strong>
                  </td>
                  <td>
                    {serial.item ? (
                      <div>
                        <div>{serial.item.sku}</div>
                        <div className="serial-grid-subtext">{serial.item.name}</div>
                        {serial.variant && (
                          <div className="serial-grid-variant">Variant: {serial.variant.name}</div>
                        )}
                      </div>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td>
                    {serial.currentLocation ? (
                      <div>
                        <div>{serial.currentLocation.code}</div>
                        <div className="serial-grid-subtext">{serial.currentLocation.name}</div>
                      </div>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td>
                    <span
                      className={`serial-status-badge ${appearance.badgeClass}`}
                      style={{
                        color: appearance.color,
                        backgroundColor: appearance.bgColor,
                      }}
                      title={appearance.label}
                    >
                      {appearance.icon} {appearance.label}
                    </span>
                  </td>
                  <td>{serial.batchNumber || '-'}</td>
                  <td>
                    {serial.expiryDate ? (
                      <div>
                        <div>{formatSerialDate(serial.expiryDate)}</div>
                        {appearance.badgeClass.includes('expired') && (
                          <div className="serial-grid-expired-label">Expired</div>
                        )}
                        {appearance.badgeClass.includes('critical') && (
                          <div className="serial-grid-critical-label">Critical</div>
                        )}
                      </div>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      
      {processedSerials.length > 0 && (
        <div className="serial-grid-footer">
          <span className="serial-grid-count">
            Showing {processedSerials.length} of {serials.length} serials
          </span>
        </div>
      )}
    </div>
  );
};
