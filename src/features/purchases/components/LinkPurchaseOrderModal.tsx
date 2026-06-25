/**
 * Receipts tab — pick an open PO to receive against (search + scroll list).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '@/shared/components/modals/Modal';
import { Spinner } from '@/shared/components/ui';
import { purchaseService, type PurchaseOrder } from '@/services/purchase.service';
import { isReceivablePurchaseOrder } from '../utils/receivablePurchaseOrders';
import { scrollElementIntoContainer } from '@/shared/utils/scrollIntoContainer';
import './LinkPurchaseOrderModal.css';

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 280;
const MAX_EMPTY_PAGES = 8;

type Props = {
  isOpen: boolean;
  branchId: string | null;
  selectedPurchaseOrderId?: string | null;
  onClose: () => void;
  onLink: (order: PurchaseOrder) => void;
  /** Called when Esc is pressed while a PO is linked (before close). */
  onUnlink?: () => void;
};

function mergeOrders(prev: PurchaseOrder[], next: PurchaseOrder[]): PurchaseOrder[] {
  if (next.length === 0) return prev;
  const ids = new Set(prev.map((o) => o.id));
  const added = next.filter((o) => !ids.has(o.id));
  return added.length ? [...prev, ...added] : prev;
}

export const LinkPurchaseOrderModal: React.FC<Props> = ({
  isOpen,
  branchId,
  selectedPurchaseOrderId,
  onClose,
  onLink,
  onUnlink,
}) => {
  const linkedId = selectedPurchaseOrderId?.trim() || '';
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadGenRef = useRef(0);
  const linkedFetchRef = useRef<string | null>(null);

  const [query, setQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const fetchReceivablePage = useCallback(
    async (pageNum: number, search: string) => {
      const data = await purchaseService.listOrders(
        {
          page: pageNum,
          pageSize: PAGE_SIZE,
          search: search.trim() || undefined,
        },
        branchId
      );
      return {
        receivable: data.rows.filter(isReceivablePurchaseOrder),
        hasMore: pageNum * PAGE_SIZE < data.total,
        pageNum,
      };
    },
    [branchId]
  );

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setDebouncedSearch('');
    setOrders([]);
    setPage(0);
    setHasMore(true);
    setError(null);
    setActiveIndex(-1);
    linkedFetchRef.current = null;
    loadGenRef.current += 1;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const t = window.setTimeout(() => setDebouncedSearch(query), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [isOpen, query]);

  useEffect(() => {
    if (!isOpen) return;
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !branchId) {
      if (isOpen && !branchId) setError('Branch required.');
      return;
    }

    const gen = ++loadGenRef.current;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      setOrders([]);
      setPage(0);
      setHasMore(true);
      setActiveIndex(-1);

      let pageNum = 1;
      let collected: PurchaseOrder[] = [];
      let more = true;

      try {
        while (more && pageNum <= MAX_EMPTY_PAGES) {
          const { receivable, hasMore: nextHasMore } = await fetchReceivablePage(pageNum, debouncedSearch);
          if (cancelled || gen !== loadGenRef.current) return;
          collected = mergeOrders(collected, receivable);
          more = nextHasMore;
          if (collected.length > 0 || !more) break;
          pageNum += 1;
        }
        setOrders(collected);
        setPage(pageNum);
        setHasMore(more);
      } catch {
        if (!cancelled && gen === loadGenRef.current) {
          setError('Could not load open purchase orders.');
          setOrders([]);
          setHasMore(false);
        }
      } finally {
        if (!cancelled && gen === loadGenRef.current) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [branchId, debouncedSearch, fetchReceivablePage, isOpen]);

  const loadMore = useCallback(async () => {
    if (!branchId || loading || loadingMore || !hasMore) return;

    const gen = loadGenRef.current;
    setLoadingMore(true);

    try {
      let pageNum = page + 1;
      let more = true;

      while (more && pageNum <= page + MAX_EMPTY_PAGES) {
        const { receivable, hasMore: nextHasMore } = await fetchReceivablePage(pageNum, debouncedSearch);
        if (gen !== loadGenRef.current) return;

        more = nextHasMore;
        if (receivable.length > 0) {
          setOrders((prev) => mergeOrders(prev, receivable));
          setPage(pageNum);
          setHasMore(more);
          return;
        }
        if (!more) {
          setPage(pageNum);
          setHasMore(false);
          return;
        }
        pageNum += 1;
      }

      setPage(pageNum);
      setHasMore(more);
    } catch {
      if (gen === loadGenRef.current) setHasMore(false);
    } finally {
      if (gen === loadGenRef.current) setLoadingMore(false);
    }
  }, [branchId, debouncedSearch, fetchReceivablePage, hasMore, loading, loadingMore, page]);

  useEffect(() => {
    const root = listRef.current;
    const sentinel = sentinelRef.current;
    if (!isOpen || !root || !sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { root, rootMargin: '120px', threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isOpen, loadMore, orders.length]);

  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const container = listRef.current;
    const el = container.querySelector<HTMLElement>(`[data-po-index="${activeIndex}"]`);
    if (el) scrollElementIntoContainer(container, el);
  }, [activeIndex, orders.length]);

  useEffect(() => {
    if (!isOpen || loading || !linkedId || !branchId) return;
    const idx = orders.findIndex((o) => o.id === linkedId);
    if (idx >= 0) {
      setActiveIndex(idx);
      return;
    }
    if (linkedFetchRef.current === linkedId) return;
    linkedFetchRef.current = linkedId;
    let cancelled = false;
    purchaseService
      .getOrder(linkedId, branchId)
      .then((po) => {
        if (cancelled || !isReceivablePurchaseOrder(po)) return;
        setOrders((prev) => (prev.some((o) => o.id === po.id) ? prev : [po, ...prev]));
        setActiveIndex(0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [branchId, isOpen, linkedId, loading, orders]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (linkedId) onUnlink?.();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isOpen, linkedId, onClose, onUnlink]);

  const handleSelect = useCallback(
    (order: PurchaseOrder) => {
      onLink(order);
      onClose();
    },
    [onClose, onLink]
  );

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (orders.length === 0) return;
      setActiveIndex((i) => (i < orders.length - 1 ? i + 1 : 0));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (orders.length === 0) return;
      setActiveIndex((i) => (i <= 0 ? orders.length - 1 : i - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const pick = activeIndex >= 0 ? orders[activeIndex] : orders[0];
      if (pick) handleSelect(pick);
    }
  };

  if (!isOpen) return null;

  const emptyMessage = loading
    ? 'Loading open orders…'
    : debouncedSearch.trim()
      ? 'No matching purchase orders.'
      : 'No purchase orders pending receipt.';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      closeOnEscape={false}
      title="Link purchase order"
      size="lg"
      className="link-po-modal-wrap"
    >
      <div className="link-po-modal">
        {error ? (
          <p className="link-po-modal__err sales-panel-error" role="alert">
            {error}
          </p>
        ) : null}
        <p className="link-po-modal__hint">
          ↑↓ to move · Enter to link · Esc {linkedId ? 'to unlink & clear cart' : 'to close'} · Ctrl+Shift+O
        </p>
        <input
          ref={inputRef}
          type="search"
          className="link-po-modal__input"
          placeholder="Search PO number or supplier"
          aria-label="Search open purchase orders"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={onInputKeyDown}
          autoComplete="off"
        />
        <div ref={listRef} className="link-po-modal__list" role="listbox" aria-label="Open purchase orders">
          {loading ? (
            <div className="link-po-modal__status">
              <Spinner size="sm" />
              <span>Loading…</span>
            </div>
          ) : orders.length === 0 ? (
            <p className="link-po-modal__empty">{emptyMessage}</p>
          ) : (
            orders.map((o, index) => {
              const active = index === activeIndex;
              const linked = o.id === linkedId;
              return (
                <button
                  key={o.id}
                  type="button"
                  role="option"
                  aria-selected={active || linked}
                  data-po-index={index}
                  className={`link-po-modal__row${active ? ' link-po-modal__row--active' : ''}${linked ? ' link-po-modal__row--linked' : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => handleSelect(o)}
                >
                  <div className="po-party-option">
                    <div className="po-party-option__top">
                      <span className="po-party-option__name">
                        {o.poNumber}
                        {linked ? <span className="link-po-modal__linked-tag">Linked</span> : null}
                      </span>
                      <span className="po-party-option__gst">{o.totalPendingQty} pending</span>
                    </div>
                    <div className="po-party-option__meta">{o.supplierName}</div>
                  </div>
                </button>
              );
            })
          )}
          {!loading && orders.length > 0 ? (
            <div ref={sentinelRef} className="link-po-modal__sentinel" aria-hidden>
              {loadingMore ? (
                <div className="link-po-modal__status">
                  <Spinner size="sm" />
                  <span>Loading more…</span>
                </div>
              ) : hasMore ? (
                <span className="link-po-modal__sentinel-hint">Scroll for more</span>
              ) : (
                <span className="link-po-modal__sentinel-hint">End of list</span>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
};
