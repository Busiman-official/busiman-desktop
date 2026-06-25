import React from 'react';
import type { CatalogVariantRow } from '@/services/inventory.service';
import type { ItemSearchResult } from '@/features/inventory/types/search.types';

export function itemSearchResultKey(item: ItemSearchResult): string {
  return `${item.id}-${item.searchMatch?.variant?.id ?? 'master'}`;
}

export function itemSearchMatchBadge(searchMatch: ItemSearchResult['searchMatch']): {
  label: string;
  className: string;
  title: string;
} {
  const kind = searchMatch?.kind ?? 'master';
  if (kind === 'variant') {
    return {
      label: 'Variant',
      className: 'pos-suggest-badge--variant',
      title: 'Matched on variant code, name, barcode, or HSN',
    };
  }
  if (kind === 'both') {
    return {
      label: 'Product + variant',
      className: 'pos-suggest-badge--both',
      title: 'Matched on product fields and on a variant',
    };
  }
  return {
    label: 'Product',
    className: 'pos-suggest-badge--master',
    title: 'Matched on product name, SKU, barcode, category, tags, or description',
  };
}

export function catalogVariantSearchText(row: CatalogVariantRow): string {
  return `${row.productName} ${row.variantName} ${row.sku}`;
}

export function itemSearchResultText(item: ItemSearchResult): string {
  const vm = item.searchMatch?.variant;
  return [item.name, item.sku, vm?.name, vm?.code].filter(Boolean).join(' ');
}

export function CatalogVariantSearchOption({
  row,
}: {
  row: CatalogVariantRow;
}): React.ReactElement {
  return (
    <div className="product-search-option">
      <div className="product-search-option__title">
        <strong>{row.productName}</strong>
        <span className="product-search-option__sep"> — </span>
        {row.variantName}
      </div>
      <div className="product-search-option__meta">{row.sku}</div>
    </div>
  );
}

export function ItemSearchResultOption({ item }: { item: ItemSearchResult }): React.ReactElement {
  const badge = itemSearchMatchBadge(item.searchMatch);
  const vm = item.searchMatch?.variant;
  const showVariantDetail =
    !!vm && (item.searchMatch?.kind === 'variant' || item.searchMatch?.kind === 'both');

  return (
    <>
      <div className="pos-suggest-item__row">
        <span className={`pos-suggest-badge ${badge.className}`}>{badge.label}</span>
        <span className="pos-suggest-name">{item.name}</span>
      </div>
      {showVariantDetail && vm ? (
        <span className="pos-suggest-variant">
          <span className="pos-suggest-variant__label">Variant</span>
          <span className="pos-suggest-variant__text">
            {vm.name}
            {vm.code ? ` · ${vm.code}` : ''}
          </span>
        </span>
      ) : null}
      <span className="pos-suggest-sku">
        {item.hasVariants && item.searchMatch?.kind === 'master'
          ? `Listing SKU: ${item.sku}`
          : `SKU: ${item.sku}`}
      </span>
    </>
  );
}
