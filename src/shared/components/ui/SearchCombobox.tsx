/**
 * SearchCombobox — generic searchable combobox with optional async search and create action.
 */

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Skeleton } from './Skeleton';
import './SearchCombobox.css';

export type SearchComboboxCreatePolicy = 'never' | 'empty-only' | 'always';

export type SearchComboboxSubmitContext<T> = {
  query: string;
  items: T[];
  activeIndex: number;
  isLoading: boolean;
};

export type SearchComboboxProps<T> = {
  id?: string;
  label?: string;
  required?: boolean;
  showRequired?: boolean;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  className?: string;

  value: string;
  selectedId?: string | null;
  onValueChange: (text: string) => void;
  onSelect: (item: T) => void;
  onClear?: () => void;

  items: T[];
  recentItems?: T[];
  getItemId: (item: T) => string;
  filterItems?: (items: T[], query: string) => T[];

  onSearch?: (query: string) => void | Promise<void>;
  minSearchLength?: number;
  isLoading?: boolean;
  debounceMs?: number;

  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  maxResults?: number;
  showViewAllFooter?: boolean;
  onViewAll?: () => void;
  emptyMessage?: string;
  recentSectionLabel?: string;

  renderItem: (item: T, state: { active: boolean }) => React.ReactNode;
  getSearchableText?: (item: T) => string;
  getItemLabel?: (item: T) => string;

  createPolicy?: SearchComboboxCreatePolicy;
  minCreateLength?: number;
  onCreateRequest?: (query: string) => void;
  createLabel?: (query: string) => string;
  renderCreateAction?: (state: { query: string; active: boolean }) => React.ReactNode;
  canCreate?: boolean | ((query: string) => boolean);
  createDisabled?: boolean;
  createDisabledReason?: string;
  isCreating?: boolean;
  showCreateWhenNoExactMatch?: boolean;

  hint?: React.ReactNode;
  comboboxAriaLabel?: string;

  /** Merged with the internal input ref (e.g. POS focus shortcut). */
  inputRef?: React.Ref<HTMLInputElement | null>;
  /** Optional content before the input (e.g. search icon). */
  inputLeading?: React.ReactNode;
  fieldClassName?: string;
  inputClassName?: string;
  listClassName?: string;
  /**
   * When set, Enter runs this instead of selecting a row.
   * Useful for barcode scan + add flows (POS).
   */
  onSubmit?: (ctx: SearchComboboxSubmitContext<T>) => void | Promise<void>;
};

function defaultFilter<T>(items: T[], query: string, getSearchableText?: (item: T) => string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    const text = (getSearchableText?.(item) ?? String(item)).toLowerCase();
    return text.includes(q);
  });
}

function resolveCanCreate(
  canCreate: boolean | ((query: string) => boolean) | undefined,
  query: string
): boolean {
  if (canCreate === undefined) return true;
  return typeof canCreate === 'function' ? canCreate(query) : canCreate;
}

export function SearchCombobox<T>({
  id: idProp,
  label,
  showRequired = false,
  placeholder = 'Search…',
  error,
  disabled = false,
  className = '',

  value,
  onValueChange,
  onSelect,

  items,
  recentItems = [],
  getItemId,
  filterItems,

  onSearch,
  minSearchLength = 2,
  isLoading = false,
  debounceMs = 280,

  isOpen: isOpenControlled,
  onOpenChange,
  maxResults = 6,
  showViewAllFooter = false,
  onViewAll,
  emptyMessage = 'No results found',
  recentSectionLabel,

  renderItem,
  getSearchableText,
  getItemLabel,

  createPolicy = 'never',
  minCreateLength,
  onCreateRequest,
  createLabel = (q) => `Create "${q}"`,
  renderCreateAction,
  canCreate,
  createDisabled = false,
  createDisabledReason,
  isCreating = false,
  showCreateWhenNoExactMatch = false,

  hint,
  comboboxAriaLabel,
  inputRef: inputRefProp,
  inputLeading,
  fieldClassName = '',
  inputClassName = '',
  listClassName = '',
  onSubmit,
}: SearchComboboxProps<T>) {
  const autoId = useId();
  const inputId = idProp ?? `search-combobox-${autoId}`;
  const listId = `${inputId}-listbox`;
  const minCreate = minCreateLength ?? minSearchLength;

  const rootRef = useRef<HTMLDivElement>(null);
  const localInputRef = useRef<HTMLInputElement | null>(null);

  const setInputRef = useCallback(
    (node: HTMLInputElement | null) => {
      localInputRef.current = node;
      if (!inputRefProp) return;
      if (typeof inputRefProp === 'function') {
        inputRefProp(node);
      } else {
        (inputRefProp as React.MutableRefObject<HTMLInputElement | null>).current = node;
      }
    },
    [inputRefProp]
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isOpenInternal, setIsOpenInternal] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [debouncing, setDebouncing] = useState(false);

  const isOpen = isOpenControlled ?? isOpenInternal;
  const setOpen = useCallback(
    (open: boolean) => {
      if (isOpenControlled === undefined) setIsOpenInternal(open);
      onOpenChange?.(open);
      if (!open) setActiveIndex(-1);
    },
    [isOpenControlled, onOpenChange]
  );

  const query = value.trim();
  const isSearchMode = query.length >= minSearchLength;

  const filteredAll = useMemo(() => {
    if (!isSearchMode) return recentItems.slice(0, 5);
    return filterItems
      ? filterItems(items, query)
      : defaultFilter(items, query, getSearchableText);
  }, [isSearchMode, recentItems, filterItems, items, query, getSearchableText]);

  const displayedItems = useMemo(
    () => (isSearchMode ? filteredAll.slice(0, maxResults) : filteredAll),
    [filteredAll, isSearchMode, maxResults]
  );

  const labelForItem = useCallback(
    (item: T) => {
      const raw = getItemLabel?.(item) ?? getSearchableText?.(item) ?? String(item);
      return raw.trim();
    },
    [getItemLabel, getSearchableText]
  );

  const hasExactMatch = useMemo(() => {
    if (!isSearchMode || !query) return false;
    const q = query.toLowerCase();
    return filteredAll.some((item) => labelForItem(item).toLowerCase() === q);
  }, [filteredAll, isSearchMode, query, labelForItem]);

  const showLoading = isLoading || debouncing;

  const showCreate = useMemo(() => {
    if (createPolicy === 'never' || !onCreateRequest || !isSearchMode) return false;
    if (query.length < minCreate) return false;
    if (showLoading) return false;
    if (!resolveCanCreate(canCreate, query)) return false;
    if (createPolicy === 'always') return true;
    if (createPolicy === 'empty-only' && displayedItems.length === 0) return true;
    if (showCreateWhenNoExactMatch && displayedItems.length > 0 && !hasExactMatch) return true;
    return false;
  }, [
    createPolicy,
    onCreateRequest,
    isSearchMode,
    query,
    minCreate,
    showLoading,
    canCreate,
    displayedItems.length,
    showCreateWhenNoExactMatch,
    hasExactMatch,
  ]);

  const createIndex = showCreate ? displayedItems.length : -1;
  const maxActiveIndex = showCreate ? displayedItems.length : Math.max(0, displayedItems.length - 1);

  useEffect(() => {
    if (!isOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [isOpen, setOpen]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!onSearch || query.length < minSearchLength) {
      setDebouncing(false);
      return;
    }
    setDebouncing(true);
    debounceRef.current = setTimeout(() => {
      setDebouncing(false);
      void Promise.resolve(onSearch(query));
    }, debounceMs);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, onSearch, minSearchLength, debounceMs]);

  const selectItem = useCallback(
    (item: T) => {
      onSelect(item);
      setOpen(false);
      localInputRef.current?.blur();
    },
    [onSelect, setOpen]
  );

  const requestCreate = useCallback(() => {
    if (!onCreateRequest || createDisabled || isCreating) return;
    onCreateRequest(query);
    setOpen(false);
  }, [onCreateRequest, createDisabled, isCreating, query, setOpen]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!isOpen) {
      if (e.key === 'Enter' && onSubmit && query.trim()) {
        e.preventDefault();
        void Promise.resolve(
          onSubmit({
            query,
            items: displayedItems,
            activeIndex: 0,
            isLoading: showLoading,
          })
        );
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setOpen(true);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => {
        if (i < 0) return 0;
        return Math.min(i + 1, maxActiveIndex);
      });
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (showCreate && activeIndex === createIndex) {
        requestCreate();
        return;
      }
      if (onSubmit) {
        void Promise.resolve(
          onSubmit({
            query,
            items: displayedItems,
            activeIndex: activeIndex >= 0 ? activeIndex : 0,
            isLoading: showLoading,
          })
        );
        return;
      }
      const item = displayedItems[activeIndex >= 0 ? activeIndex : 0];
      if (item) selectItem(item);
    }
  };

  const listHasStickyCreate = showCreate && createPolicy === 'always';
  const showEmptyBeforeCreate =
    showCreate && displayedItems.length === 0 && !showLoading && isSearchMode;

  const defaultCreateContent = (_active: boolean) => (
    <>
      <span className="search-combobox__create-icon" aria-hidden>
        +
      </span>
      {createLabel(query)}
    </>
  );

  const renderCreateRow = () => {
    const active = activeIndex === createIndex;
    const disabled = createDisabled || isCreating;
    const title = createDisabled ? createDisabledReason : undefined;

    if (isCreating) {
      return (
        <div className="search-combobox__create search-combobox__create--loading">
          <Skeleton height={14} width="75%" />
        </div>
      );
    }

    return (
      <button
        type="button"
        className={`search-combobox__create${active ? ' search-combobox__create--active' : ''}`}
        disabled={disabled}
        title={title}
        onMouseEnter={() => setActiveIndex(createIndex)}
        onMouseDown={(e) => e.preventDefault()}
        onClick={requestCreate}
      >
        {renderCreateAction
          ? renderCreateAction({ query, active })
          : defaultCreateContent(active)}
      </button>
    );
  };

  return (
    <div className={`search-combobox ${className}`.trim()} ref={rootRef}>
      {label ? (
        <label
          htmlFor={inputId}
          className="search-combobox__label"
          data-show-required={showRequired ? 'true' : undefined}
        >
          {label}
        </label>
      ) : null}

      <div className={`search-combobox__field${fieldClassName ? ` ${fieldClassName}` : ''}`}>
        {inputLeading}
        <input
          ref={setInputRef}
          id={inputId}
          type="text"
          className={`search-combobox__input${error ? ' search-combobox__input--error' : ''}${inputClassName ? ` ${inputClassName}` : ''}`}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={comboboxAriaLabel ?? label}
        aria-invalid={error ? true : undefined}
        onChange={(e) => onValueChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        />
      </div>

      {error ? <p className="search-combobox__error">{error}</p> : null}
      {!error && hint ? <div className="search-combobox__hint">{hint}</div> : null}

      {isOpen ? (
        <div
          id={listId}
          className={`search-combobox__list${listHasStickyCreate ? ' search-combobox__list--with-sticky-create' : ''}${listClassName ? ` ${listClassName}` : ''}`}
          role="listbox"
        >
          <div className="search-combobox__list-body">
            {!isSearchMode && recentSectionLabel && recentItems.length > 0 ? (
              <div className="search-combobox__section-label">{recentSectionLabel}</div>
            ) : null}

            {showLoading ? (
              <>
                {[1, 2, 3].map((i) => (
                  <div key={i} className="search-combobox__skeleton">
                    <Skeleton height={14} width="70%" />
                    <Skeleton height={12} width="45%" />
                  </div>
                ))}
              </>
            ) : (
              displayedItems.map((item, index) => {
                const active = index === activeIndex;
                return (
                  <button
                    key={getItemId(item)}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`search-combobox__option${active ? ' search-combobox__option--active' : ''}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectItem(item)}
                  >
                    {renderItem(item, { active })}
                  </button>
                );
              })
            )}

            {showEmptyBeforeCreate ? (
              <>
                <div className="search-combobox__empty">{emptyMessage}</div>
                <div className="search-combobox__divider" role="separator" />
              </>
            ) : null}

            {!showLoading && isSearchMode && showViewAllFooter ? (
              <button type="button" className="search-combobox__footer" onClick={onViewAll}>
                View all results →
              </button>
            ) : null}
          </div>

          {showCreate && displayedItems.length > 0 && !listHasStickyCreate ? (
            <div className="search-combobox__divider" role="separator" />
          ) : null}

          {showCreate ? (
            <div
              className={
                listHasStickyCreate || (showCreate && displayedItems.length > 0)
                  ? 'search-combobox__create-footer'
                  : undefined
              }
            >
              {renderCreateRow()}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
