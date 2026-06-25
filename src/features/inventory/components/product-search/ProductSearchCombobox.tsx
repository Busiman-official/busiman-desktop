import React, { useCallback, useEffect } from 'react';
import { SearchCombobox, type SearchComboboxSubmitContext } from '@/shared/components/ui/SearchCombobox';
import type { CatalogVariantRow } from '@/services/inventory.service';
import type { ItemSearchResult } from '@/features/inventory/types/search.types';
import { useCatalogProductSearch } from '@/features/inventory/hooks/useCatalogProductSearch';
import { useItemProductSearch } from '@/features/inventory/hooks/useItemProductSearch';
import {
  CatalogVariantSearchOption,
  ItemSearchResultOption,
  catalogVariantSearchText,
  itemSearchResultKey,
  itemSearchResultText,
} from './productSearchRow';
import './ProductSearchCombobox.css';

export type ProductSearchMode = 'catalog' | 'search';

type ProductSearchComboboxBaseProps = {
  value: string;
  onValueChange: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
  label?: string;
  minSearchLength?: number;
  maxResults?: number;
  debounceMs?: number;
  emptyMessage?: string;
  comboboxAriaLabel?: string;
  inputRef?: React.Ref<HTMLInputElement | null>;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  appearance?: 'default' | 'pos';
  clearOnSelect?: boolean;
};

export type ProductSearchComboboxCatalogProps = ProductSearchComboboxBaseProps & {
  mode?: 'catalog';
  branchId?: string | null;
  onSelect: (row: CatalogVariantRow) => void;
  onSubmit?: (ctx: SearchComboboxSubmitContext<CatalogVariantRow>) => void | Promise<void>;
};

export type ProductSearchComboboxSearchProps = ProductSearchComboboxBaseProps & {
  mode: 'search';
  branchId: string;
  onSelect: (item: ItemSearchResult) => void;
  categoryFilter?: string | null;
  onSubmit?: (ctx: SearchComboboxSubmitContext<ItemSearchResult>) => void | Promise<void>;
};

export type ProductSearchComboboxProps =
  | ProductSearchComboboxCatalogProps
  | ProductSearchComboboxSearchProps;

const POS_SEARCH_ICON = (
  <span className="pos-search-field__icon" aria-hidden>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  </span>
);

function ProductSearchComboboxCatalog({
  branchId,
  onSelect,
  onSubmit,
  value,
  onValueChange,
  disabled = false,
  placeholder,
  className = '',
  id,
  label,
  minSearchLength,
  maxResults = 8,
  debounceMs = 280,
  emptyMessage,
  comboboxAriaLabel,
  inputRef,
  isOpen,
  onOpenChange,
  appearance = 'default',
  clearOnSelect = true,
}: ProductSearchComboboxCatalogProps) {
  const isPos = appearance === 'pos';
  const { items, loading, search, clear } = useCatalogProductSearch({
    branchId,
    limit: maxResults,
    minLength: minSearchLength ?? 1,
  });

  useEffect(() => {
    if (!value.trim()) clear();
  }, [value, clear]);

  const handleSelect = useCallback(
    (row: CatalogVariantRow) => {
      onSelect(row);
      if (clearOnSelect) {
        onValueChange('');
        clear();
      }
    },
    [onSelect, clearOnSelect, onValueChange, clear]
  );

  const rootClass = ['product-search', isPos ? 'product-search--pos' : '', className].filter(Boolean).join(' ');

  return (
    <SearchCombobox<CatalogVariantRow>
      id={id}
      className={rootClass}
      label={label}
      placeholder={placeholder ?? 'Search product or SKU'}
      disabled={disabled}
      value={value}
      onValueChange={onValueChange}
      onSelect={handleSelect}
      items={items}
      getItemId={(row) => row.variantId}
      onSearch={search}
      minSearchLength={minSearchLength ?? 1}
      isLoading={loading}
      debounceMs={debounceMs}
      maxResults={maxResults}
      emptyMessage={emptyMessage ?? 'No matching products. Try another SKU or name.'}
      comboboxAriaLabel={comboboxAriaLabel ?? 'Search products'}
      getSearchableText={catalogVariantSearchText}
      getItemLabel={(row) => `${row.productName} — ${row.variantName}`}
      renderItem={(row) => <CatalogVariantSearchOption row={row} />}
      inputRef={inputRef}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      inputLeading={isPos ? POS_SEARCH_ICON : undefined}
      listClassName={isPos ? 'pos-suggest-panel' : undefined}
      onSubmit={onSubmit}
    />
  );
}

function ProductSearchComboboxSearch({
  branchId,
  categoryFilter = null,
  onSelect,
  onSubmit,
  value,
  onValueChange,
  disabled = false,
  placeholder,
  className = '',
  id,
  label,
  minSearchLength,
  maxResults = 12,
  debounceMs = 280,
  emptyMessage,
  comboboxAriaLabel,
  inputRef,
  isOpen,
  onOpenChange,
  appearance = 'default',
  clearOnSelect = true,
}: ProductSearchComboboxSearchProps) {
  const isPos = appearance === 'pos';
  const { items, loading, search, clear } = useItemProductSearch({
    branchId,
    limit: maxResults,
    categoryFilter,
  });

  useEffect(() => {
    if (!value.trim()) clear();
  }, [value, clear]);

  useEffect(() => {
    const q = value.trim();
    if (q.length >= (minSearchLength ?? 1)) {
      void search(q);
    }
    // Re-run when POS category chip changes; query comes from controlled value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryFilter]);

  const handleSelect = useCallback(
    (item: ItemSearchResult) => {
      onSelect(item);
      if (clearOnSelect) {
        onValueChange('');
        clear();
      }
    },
    [onSelect, clearOnSelect, onValueChange, clear]
  );

  const rootClass = ['product-search', isPos ? 'product-search--pos' : '', className].filter(Boolean).join(' ');

  return (
    <SearchCombobox<ItemSearchResult>
      id={id ?? 'pos-product-lookup-input'}
      className={rootClass}
      label={label}
      placeholder={
        placeholder ??
        (isPos ? 'Scan barcode or type name, SKU… (Enter to add)' : 'Search products…')
      }
      disabled={disabled}
      value={value}
      onValueChange={onValueChange}
      onSelect={handleSelect}
      items={items}
      getItemId={itemSearchResultKey}
      onSearch={search}
      minSearchLength={minSearchLength ?? 1}
      isLoading={loading}
      debounceMs={debounceMs}
      maxResults={maxResults}
      emptyMessage={emptyMessage ?? 'No matching products. Try another term or scan a barcode.'}
      comboboxAriaLabel={comboboxAriaLabel ?? 'Search products'}
      getSearchableText={itemSearchResultText}
      getItemLabel={(item) => item.name}
      renderItem={(item) => <ItemSearchResultOption item={item} />}
      inputRef={inputRef}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      inputLeading={isPos ? POS_SEARCH_ICON : undefined}
      listClassName={isPos ? 'pos-suggest-panel' : undefined}
      onSubmit={onSubmit}
    />
  );
}

export function ProductSearchCombobox(props: ProductSearchComboboxProps) {
  if (props.mode === 'search') {
    return <ProductSearchComboboxSearch {...props} />;
  }
  return <ProductSearchComboboxCatalog {...props} />;
}
