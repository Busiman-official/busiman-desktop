import React from 'react';
import { ProductSearchCombobox } from '@/features/inventory/components/product-search';
import type { ItemSearchResult } from '@/features/inventory/types/search.types';
import type { SearchComboboxSubmitContext } from '@/shared/components/ui/SearchCombobox';

export type PosProductLookupProps = {
  branchId: string;
  salesPointId: string | null;
  value: string;
  onValueChange: (text: string) => void;
  categoryChip?: string | null;
  inputRef?: React.Ref<HTMLInputElement | null>;
  onPickItem: (item: ItemSearchResult) => void | Promise<void>;
  onSubmitQuery: (ctx: SearchComboboxSubmitContext<ItemSearchResult>) => void | Promise<void>;
  clearOnSelect?: boolean;
  /** When set, overrides default disable when sales point is missing (e.g. purchase receipts use location). */
  disabled?: boolean;
  /** When query is empty, Enter focuses checkout (e.g. freight) instead of opening the dropdown. */
  onEmptyEnter?: () => void;
};

export const PosProductLookup: React.FC<PosProductLookupProps> = ({
  branchId,
  salesPointId,
  value,
  onValueChange,
  categoryChip = null,
  inputRef,
  onPickItem,
  onSubmitQuery,
  clearOnSelect = false,
  disabled,
  onEmptyEnter,
}) => (
  <div className="pos-lookup-combobox">
    <div
      className="pos-lookup-form"
      onKeyDownCapture={(e) => {
        if (!onEmptyEnter || disabled) return;
        if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.shiftKey) return;
        if (value.trim()) return;
        e.preventDefault();
        e.stopPropagation();
        onEmptyEnter();
      }}
    >
      <ProductSearchCombobox
        mode="search"
        appearance="pos"
        branchId={branchId}
        categoryFilter={categoryChip}
        value={value}
        onValueChange={onValueChange}
        onSelect={onPickItem}
        onSubmit={onSubmitQuery}
        inputRef={inputRef}
        disabled={disabled ?? !salesPointId}
        clearOnSelect={clearOnSelect}
        className="pos-lookup-form__combobox"
      />
    </div>
  </div>
);
