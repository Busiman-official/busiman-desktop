/**
 * DataTable Component - Reusable, feature-rich table component
 */

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { SearchInput } from '../filters/SearchInput';
import { DropdownMenu, DropdownMenuItem } from '../ui/DropdownMenu';
import { LoadingState, EmptyState } from './index';
import './DataTable.css';

export interface ColumnDef<T> {
  id: string;
  header: string;
  accessor: (row: T) => React.ReactNode;
  width?: string | number;
  minWidth?: number;
  maxWidth?: number;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
}

export interface FilterConfig {
  id: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  searchable?: boolean;
  searchPlaceholder?: string;
  onSearch?: (query: string) => void;
  searchFields?: (row: T) => string[]; // Optional: custom search fields extraction
  filters?: FilterConfig[];
  actions?: (row: T) => DropdownMenuItem[];
  onRowClick?: (row: T) => void;
  onRowDoubleClick?: (row: T) => void;
  selectedRowId?: string;
  emptyMessage?: string;
  /** Shown when `data` is empty (before search). Passed to EmptyState as title if set. */
  emptyTitle?: string;
  /** Optional icon for empty state when data is empty. */
  emptyIcon?: React.ReactNode;
  /** Primary CTA when data is empty (e.g. “Add first item”). */
  emptyAction?: React.ReactNode;
  /** When data exists but search/filter hides all rows. */
  filteredEmptyMessage?: string;
  filteredEmptyTitle?: string;
  /**
   * Total rows before this table’s search (e.g. parent status filter already applied to `data`).
   * When `data` is empty but `rowSourceCount > 0`, empty state shows filtered-empty copy, not “no data” CTA.
   */
  rowSourceCount?: number;
  loading?: boolean;
  maxRowHeight?: number;
  className?: string;
  getRowId?: (row: T) => string;
}

export function DataTable<T extends Record<string, any>>({
  data,
  columns,
  searchable = false,
  searchPlaceholder = 'Search...',
  onSearch,
  searchFields,
  filters = [],
  actions,
  onRowClick,
  onRowDoubleClick,
  selectedRowId,
  emptyMessage = 'No data available',
  emptyTitle,
  emptyIcon,
  emptyAction,
  filteredEmptyMessage = 'No rows match your search or filter.',
  filteredEmptyTitle = 'No matches',
  rowSourceCount,
  loading = false,
  maxRowHeight,
  className = '',
  getRowId,
}: DataTableProps<T>) {
  const [searchQuery, setSearchQuery] = useState('');
  const tableRef = useRef<HTMLDivElement>(null);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    onSearch?.(query);
  };

  // Helper to extract text from React nodes for search
  const extractTextFromReactNode = useCallback((node: React.ReactNode): string => {
    if (typeof node === 'string') return node;
    if (typeof node === 'number') return String(node);
    if (React.isValidElement(node)) {
      if (node.props.children) {
        return React.Children.toArray(node.props.children)
          .map(extractTextFromReactNode)
          .join(' ');
      }
      return node.props.value || node.props.label || node.props.title || '';
    }
    return '';
  }, []);

  const filteredData = useMemo(() => {
    let result = data;

    // Apply search filter
    if (searchable && searchQuery) {
      const searchLower = searchQuery.toLowerCase();
      result = result.filter((row) => {
        // Use custom search fields if provided, otherwise extract from rendered content
        if (searchFields) {
          const searchableText = searchFields(row)
            .join(' ')
            .toLowerCase();
          return searchableText.includes(searchLower);
        }
        
        // Fallback to extracting text from rendered columns
        const searchableText = columns
          .map(col => {
            const cellContent = col.accessor(row);
            return extractTextFromReactNode(cellContent);
          })
          .join(' ')
          .toLowerCase();
        return searchableText.includes(searchLower);
      });
    }

    return result;
  }, [data, searchQuery, searchable, columns, searchFields, extractTextFromReactNode]);

  const rowId = getRowId || ((row: T) => (row.id as string) || String(row));
  const columnCount = columns.length + (actions ? 1 : 0);

  // Build grid template columns string
  const gridTemplateColumns = useMemo(() => {
    const cols = columns.map(col => {
      if (col.width) {
        return typeof col.width === 'number' ? `${col.width}px` : col.width;
      }
      if (col.minWidth && col.maxWidth) {
        return `minmax(${col.minWidth}px, ${col.maxWidth}px)`;
      }
      if (col.minWidth) {
        return `minmax(${col.minWidth}px, 1fr)`;
      }
      return '1fr';
    });
    if (actions) {
      cols.push('50px'); // Fixed width for actions column
    }
    return cols.join(' ');
  }, [columns, actions]);

  useEffect(() => {
    if (tableRef.current) {
      tableRef.current.style.setProperty('--column-count', String(columnCount));
      tableRef.current.style.setProperty('--grid-template-columns', gridTemplateColumns);
    }
  }, [columnCount, gridTemplateColumns]);

  if (loading) {
    return <LoadingState message="Loading data..." />;
  }

  const baseRowCount = rowSourceCount ?? data.length;
  const isTrueEmpty = filteredData.length === 0 && baseRowCount === 0;

  return (
    <div className={`data-table ${className}`}>
      {(searchable || filters.length > 0) && (
        <div className="data-table-header">
          {searchable && (
            <div className="data-table-search">
              <SearchInput
                value={searchQuery}
                onChange={handleSearch}
                placeholder={searchPlaceholder}
                debounceMs={300}
              />
            </div>
          )}
          {filters.length > 0 && (
            <div className="data-table-filters">
              {filters.map((filter) => (
                <select
                  key={filter.id}
                  value={filter.value}
                  onChange={(e) => filter.onChange(e.target.value)}
                  className="data-table-filter-select"
                >
                  {filter.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="data-table-content" ref={tableRef}>
        {filteredData.length === 0 ? (
          <EmptyState
            title={isTrueEmpty ? emptyTitle ?? 'No data found' : filteredEmptyTitle}
            message={isTrueEmpty ? emptyMessage : filteredEmptyMessage}
            icon={isTrueEmpty ? emptyIcon : undefined}
            action={isTrueEmpty ? emptyAction : undefined}
          />
        ) : (
          <div className="data-table-wrapper">
            <div className="data-table-grid">
              <div className="data-table-header-row">
                {columns.map((column) => (
                  <div
                    key={column.id}
                    className="data-table-header-cell"
                    style={{
                      width: column.width,
                      minWidth: column.minWidth,
                      maxWidth: column.maxWidth,
                      textAlign: column.align || 'left',
                    }}
                  >
                    {column.header}
                  </div>
                ))}
                {actions && <div className="data-table-header-cell data-table-actions-header" />}
              </div>

              {filteredData.map((row) => {
                const id = rowId(row);
                const isSelected = selectedRowId === id;
                const rowActions = actions ? actions(row) : [];

                return (
                  <div
                    key={id}
                    data-row-id={id}
                    className={`data-table-row ${isSelected ? 'data-table-row--selected' : ''} ${onRowClick || onRowDoubleClick ? 'data-table-row--clickable' : ''}`}
                    style={typeof maxRowHeight === 'number' && maxRowHeight > 0 ? { maxHeight: `${maxRowHeight}px` } : undefined}
                    onClick={() => onRowClick?.(row)}
                    onDoubleClick={() => onRowDoubleClick?.(row)}
                  >
                    {columns.map((column) => (
                      <div
                        key={column.id}
                        className="data-table-cell"
                        style={{
                          width: column.width,
                          minWidth: column.minWidth,
                          maxWidth: column.maxWidth,
                          textAlign: column.align || 'left',
                        }}
                      >
                        {column.accessor(row)}
                      </div>
                    ))}
                    {actions && rowActions.length > 0 && (
                      <div
                        className="data-table-cell data-table-actions-cell"
                        onDoubleClick={(e) => e.stopPropagation()}
                      >
                        <DropdownMenu
                          trigger={
                            <button
                              type="button"
                              className="data-table-action-trigger"
                              aria-label="Actions"
                            >
                              ⋮
                            </button>
                          }
                          items={rowActions}
                          align="right"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
