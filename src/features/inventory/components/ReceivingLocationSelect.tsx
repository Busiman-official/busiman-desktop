import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { inventoryService, type Location } from '@/services/inventory.service';
import {
  buildLocationTree,
  filterTreeNodes,
  flattenLocationTree,
  locationTypeBadge,
  pickDefaultReceivingLocationId,
  resolveLocationPathLabel,
  type LocationTreeNode,
} from '@/features/inventory/utils/receivingLocationTree';
import { scrollElementIntoContainer } from '@/shared/utils/scrollIntoContainer';
import './ReceivingLocationSelect.css';

const RECENT_KEY = (branchId: string) => `receiving-location-recent-${branchId}`;

function readRecent(branchId: string): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY(branchId));
    const parsed = JSON.parse(raw || '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function pushRecent(branchId: string, locationId: string): void {
  const next = [locationId, ...readRecent(branchId).filter((id) => id !== locationId)].slice(0, 5);
  localStorage.setItem(RECENT_KEY(branchId), JSON.stringify(next));
}

export type ReceivingLocationSelectProps = {
  branchId: string;
  value: string | null;
  onChange: (locationId: string, meta: { pathLabel: string; location: Location }) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  className?: string;
  appearance?: 'default' | 'header';
};

type VisibleRow =
  | { kind: 'node'; node: LocationTreeNode; depth: number; hasChildren: boolean; expanded: boolean }
  | { kind: 'flat'; node: LocationTreeNode };

export const ReceivingLocationSelect: React.FC<ReceivingLocationSelectProps> = ({
  branchId,
  value,
  onChange,
  label,
  placeholder = 'Search or pick storage location…',
  disabled = false,
  error,
  className = '',
  appearance = 'default',
}) => {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentIds, setRecentIds] = useState<string[]>([]);

  useEffect(() => {
    if (!branchId) {
      setLocations([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    inventoryService
      .getAllLocations({ branchId, isActive: true })
      .then((locs) => {
        if (!cancelled) setLocations(locs.filter((l) => l.isActive !== false));
      })
      .catch(() => {
        if (!cancelled) setLocations([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [branchId]);

  useEffect(() => {
    if (branchId) setRecentIds(readRecent(branchId));
  }, [branchId]);

  const tree = useMemo(() => buildLocationTree(locations), [locations]);
  const pathById = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of flattenLocationTree(tree)) {
      map.set(n.location.id, n.pathLabel);
    }
    return map;
  }, [tree]);

  const selectedPath = useMemo(() => {
    if (!value) return '';
    return pathById.get(value) || resolveLocationPathLabel(locations, value);
  }, [locations, pathById, value]);

  useEffect(() => {
    if (!open) setQuery(selectedPath);
  }, [open, selectedPath]);

  useEffect(() => {
    if (!open) return;
    const roots = tree.map((n) => n.location.id);
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of roots) next.add(id);
      if (value) {
        let cur = locations.find((l) => l.id === value);
        while (cur?.parentLocationId) {
          next.add(cur.parentLocationId);
          cur = locations.find((l) => l.id === cur!.parentLocationId);
        }
      }
      return next;
    });
  }, [open, tree, value, locations]);

  const flatSearchResults = useMemo(() => {
    const q = query.trim();
    if (!q || q === selectedPath) return [];
    return filterTreeNodes(tree, q).slice(0, 40);
  }, [query, selectedPath, tree]);

  const treeRows = useMemo((): VisibleRow[] => {
    const rows: VisibleRow[] = [];
    const walk = (nodes: LocationTreeNode[], depth: number) => {
      for (const node of nodes) {
        const hasChildren = node.children.length > 0;
        const isExpanded = expanded.has(node.location.id);
        rows.push({ kind: 'node', node, depth, hasChildren, expanded: isExpanded });
        if (hasChildren && isExpanded) walk(node.children, depth + 1);
      }
    };
    walk(tree, 0);
    return rows;
  }, [expanded, tree]);

  const selectableRows = useMemo(() => {
    if (flatSearchResults.length > 0) {
      return flatSearchResults.map((node) => ({ kind: 'flat' as const, node }));
    }
    return treeRows;
  }, [flatSearchResults, treeRows]);

  const recentNodes = useMemo(() => {
    if (flatSearchResults.length > 0 || !open) return [];
    return recentIds
      .map((id) => flattenLocationTree(tree).find((n) => n.location.id === id))
      .filter((n): n is LocationTreeNode => Boolean(n));
  }, [flatSearchResults.length, open, recentIds, tree]);

  const pick = useCallback(
    (node: LocationTreeNode) => {
      pushRecent(branchId, node.location.id);
      setRecentIds(readRecent(branchId));
      onChange(node.location.id, { pathLabel: node.pathLabel, location: node.location });
      setQuery(node.pathLabel);
      setOpen(false);
      inputRef.current?.blur();
    },
    [branchId, onChange]
  );

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  useEffect(() => {
    if (!open || activeIndex < 0 || !panelRef.current) return;
    const el = panelRef.current.querySelector<HTMLElement>(`[data-loc-index="${activeIndex}"]`);
    if (el) scrollElementIntoContainer(panelRef.current, el);
  }, [activeIndex, open, selectableRows.length]);

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, Math.max(0, selectableRows.length - 1)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter' && open && selectableRows.length > 0) {
      e.preventDefault();
      const row = selectableRows[Math.min(activeIndex, selectableRows.length - 1)];
      if (row.kind === 'flat') pick(row.node);
      else pick(row.node);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setQuery(selectedPath);
    }
  };

  const renderNodeButton = (
    node: LocationTreeNode,
    opts: { depth?: number; active: boolean; selected: boolean; index: number }
  ) => (
    <button
      key={node.location.id}
      type="button"
      role="option"
      aria-selected={opts.selected}
      data-loc-index={opts.index}
      className={`receiving-loc-select__row${opts.active ? ' receiving-loc-select__row--active' : ''}${opts.selected ? ' receiving-loc-select__row--selected' : ''}`}
      style={opts.depth != null ? { paddingLeft: `${10 + opts.depth * 16}px` } : undefined}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => pick(node)}
    >
      <span className="receiving-loc-select__expand-spacer" aria-hidden />
      <span className="receiving-loc-select__label" title={node.pathLabel}>
        {flatSearchResults.length > 0 ? node.pathLabel : node.location.name}
      </span>
      <span className="receiving-loc-select__badge">{locationTypeBadge(node.location.type)}</span>
    </button>
  );

  return (
    <div
      ref={rootRef}
      className={`receiving-loc-select receiving-loc-select--${appearance}${className ? ` ${className}` : ''}`}
    >
      {label && appearance === 'default' ? (
        <span className="receiving-loc-select__label-text">{label}</span>
      ) : null}
      <div
        className={`receiving-loc-select__field${disabled ? ' receiving-loc-select__field--disabled' : ''}${error ? ' receiving-loc-select__field--error' : ''}`}
      >
        <span className="receiving-loc-select__icon" aria-hidden>
          📍
        </span>
        <input
          ref={inputRef}
          type="text"
          className="receiving-loc-select__input"
          value={open ? query : selectedPath || ''}
          placeholder={placeholder}
          disabled={disabled || loading}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          role="combobox"
          onFocus={() => {
            if (disabled) return;
            setOpen(true);
            setQuery(selectedPath);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onInputKeyDown}
        />
        <span className="receiving-loc-select__chevron" aria-hidden>
          ▼
        </span>
      </div>

      {open && !disabled ? (
        <div id={listId} ref={panelRef} className="receiving-loc-select__panel" role="listbox">
          {loading ? (
            <div className="receiving-loc-select__empty">Loading locations…</div>
          ) : tree.length === 0 ? (
            <div className="receiving-loc-select__empty">No receiving locations configured.</div>
          ) : flatSearchResults.length > 0 ? (
            flatSearchResults.map((node, idx) =>
              renderNodeButton(node, { active: idx === activeIndex, selected: node.location.id === value, index: idx })
            )
          ) : (
            <>
              {recentNodes.length > 0 ? (
                <>
                  <div className="receiving-loc-select__section-label">Recent</div>
                  {recentNodes.map((node) =>
                    renderNodeButton(node, { active: false, selected: node.location.id === value, index: -1 })
                  )}
                </>
              ) : null}
              <div className="receiving-loc-select__section-label">All locations</div>
              {treeRows.map((row, idx) => {
                if (row.kind !== 'node') return null;
                const { node, depth, hasChildren, expanded: isExpanded } = row;
                const active = idx === activeIndex;
                const selected = node.location.id === value;
                return (
                  <div key={node.location.id} style={{ display: 'contents' }}>
                    <div
                      data-loc-index={idx}
                      className={`receiving-loc-select__row${active ? ' receiving-loc-select__row--active' : ''}${selected ? ' receiving-loc-select__row--selected' : ''}`}
                      style={{ paddingLeft: `${10 + depth * 16}px` }}
                    >
                      {hasChildren ? (
                        <button
                          type="button"
                          className="receiving-loc-select__expand"
                          aria-label={isExpanded ? 'Collapse' : 'Expand'}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpanded((prev) => {
                              const next = new Set(prev);
                              if (next.has(node.location.id)) next.delete(node.location.id);
                              else next.add(node.location.id);
                              return next;
                            });
                          }}
                        >
                          {isExpanded ? '▼' : '▶'}
                        </button>
                      ) : (
                        <span className="receiving-loc-select__expand-spacer" aria-hidden />
                      )}
                      <button
                        type="button"
                        className="receiving-loc-select__label"
                        style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', textAlign: 'left' }}
                        title={node.pathLabel}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pick(node)}
                      >
                        {node.location.name}
                      </button>
                      <span className="receiving-loc-select__badge">{locationTypeBadge(node.location.type)}</span>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
};

export { pickDefaultReceivingLocationId };
