import React, { useEffect, useRef } from 'react';

type Props = {
  columns: string[];
  highlightedIndex: number;
  rowCount: number;
  emptyMessage: string;
  children: React.ReactNode;
};

export const PurchaseSupplierDetailTable: React.FC<Props> = ({
  columns,
  highlightedIndex,
  rowCount,
  emptyMessage,
  children,
}) => {
  const tableWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (highlightedIndex < 0 || !tableWrapRef.current || rowCount <= 0) return;
    const el = tableWrapRef.current.querySelector<HTMLElement>(
      `[data-list-row-index="${highlightedIndex}"]`
    );
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex, rowCount]);

  return (
    <div className="po-sup-detail__table-wrap" ref={tableWrapRef}>
      <table className="po-sup-detail__table">
        <thead>
          <tr>
            {columns.map((h) => (
              <th key={h || 'action'}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowCount === 0 ? (
            <tr>
              <td colSpan={columns.length} style={{ padding: 16, color: '#64748b' }}>
                {emptyMessage}
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
};

type RowProps = {
  rowIndex: number;
  highlightedIndex: number;
  onHighlightedIndexChange: (index: number) => void;
  rowClassName?: string;
  onActivate?: () => void;
  children: React.ReactNode;
};

export const PurchaseSupplierDetailTableRow: React.FC<RowProps> = ({
  rowIndex,
  highlightedIndex,
  onHighlightedIndexChange,
  rowClassName = '',
  onActivate,
  children,
}) => {
  const highlighted = rowIndex === highlightedIndex;
  return (
    <tr
      data-list-row-index={rowIndex}
      className={`po-sup-detail__row${highlighted ? ' po-sup-detail__row--highlighted' : ''}${rowClassName ? ` ${rowClassName}` : ''}`}
      onMouseEnter={() => onHighlightedIndexChange(rowIndex)}
      onClick={() => {
        onHighlightedIndexChange(rowIndex);
        onActivate?.();
      }}
    >
      {children}
    </tr>
  );
};
