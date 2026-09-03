import React from 'react';
import type { CatalogVariantRow } from '@/services/inventory.service';
import type { ItemSearchResult } from '@/features/inventory/types/search.types';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Wraps every occurrence of any query token in `<mark>` — matches the same "any token, anywhere"
 * rule the search itself uses (see search.service.ts's searchItems), so what's underlined here is
 * genuinely why the row matched, not just a naive substring check on the raw query. Case-
 * insensitive; safe on empty/whitespace-only queries (returns the plain text unchanged). */
function highlightMatch(text: string, query: string | undefined): React.ReactNode {
  const tokens = (query ?? '')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0 || !text) return text;

  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'gi');
  const parts = text.split(pattern);
  if (parts.length === 1) return text;

  // String.split with a capturing regex interleaves the captured delimiters at odd indices —
  // relying on that (rather than re-testing each part against `pattern`) sidesteps the classic
  // "stateful .test() with a /g regex inside a loop" bug, where repeated calls on the same regex
  // object silently alternate true/false because of RegExp.lastIndex carrying over between calls.
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="product-search-highlight">
        {part}
      </mark>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    )
  );
}

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
  query,
}: {
  row: CatalogVariantRow;
  query?: string;
}): React.ReactElement {
  return (
    <div className="product-search-option">
      <div className="product-search-option__title">
        <strong>{highlightMatch(row.productName, query)}</strong>
        <span className="product-search-option__sep"> — </span>
        {highlightMatch(row.variantName, query)}
      </div>
      <div className="product-search-option__meta">{highlightMatch(row.sku, query)}</div>
    </div>
  );
}

export function ItemSearchResultOption({
  item,
  query,
}: {
  item: ItemSearchResult;
  query?: string;
}): React.ReactElement {
  const badge = itemSearchMatchBadge(item.searchMatch);
  const vm = item.searchMatch?.variant;
  const showVariantDetail =
    !!vm && (item.searchMatch?.kind === 'variant' || item.searchMatch?.kind === 'both');

  return (
    <>
      <div className="pos-suggest-item__row">
        <span className={`pos-suggest-badge ${badge.className}`}>{badge.label}</span>
        <span className="pos-suggest-name">{highlightMatch(item.name, query)}</span>
      </div>
      {showVariantDetail && vm ? (
        <span className="pos-suggest-variant">
          <span className="pos-suggest-variant__label">Variant</span>
          <span className="pos-suggest-variant__text">
            {highlightMatch(vm.name, query)}
            {vm.code ? (
              <>
                {' · '}
                {highlightMatch(vm.code, query)}
              </>
            ) : null}
          </span>
        </span>
      ) : null}
      <span className="pos-suggest-sku">
        {item.hasVariants && item.searchMatch?.kind === 'master' ? 'Listing SKU: ' : 'SKU: '}
        {highlightMatch(item.sku, query)}
      </span>
    </>
  );
}
