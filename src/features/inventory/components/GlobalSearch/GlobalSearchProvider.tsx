/**
 * Global Search Provider - Context for managing global search state
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { searchService } from '../../services/search.service';
import { SearchResponse, SearchFilters, PageSearchResult, ItemSearchResult } from '../../types/search.types';
import { filterPagesByQuery } from './inventoryPages';
import { logger } from '@/shared/utils/logger';

type FlatSearchResult =
  | PageSearchResult
  | SearchResponse['serials'][number]
  | SearchResponse['items'][number]
  | SearchResponse['movements'][number]
  | SearchResponse['locations'][number];

interface GlobalSearchContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  query: string;
  setQuery: (query: string) => void;
  results: SearchResponse;
  filteredPages: PageSearchResult[];
  flattenedResults: Array<PageSearchResult | SearchResponse['serials'][number] | SearchResponse['items'][number] | SearchResponse['movements'][number] | SearchResponse['locations'][number]>;
  loading: boolean;
  selectedIndex: number;
  setSelectedIndex: (index: number) => void;
  selectResult: (index: number) => void;
  /** Navigate using the exact result row (avoids index mismatch for duplicate item hits). */
  selectSearchResult: (result: FlatSearchResult) => void;
  filters: SearchFilters;
  setFilters: (filters: SearchFilters) => void;
  recentSearches: string[];
  clearRecentSearches: () => void;
}

const GlobalSearchContext = createContext<GlobalSearchContextValue | undefined>(undefined);

export const useGlobalSearch = (): GlobalSearchContextValue => {
  const context = useContext(GlobalSearchContext);
  if (!context) {
    throw new Error('useGlobalSearch must be used within GlobalSearchProvider');
  }
  return context;
};

interface GlobalSearchProviderProps {
  children: React.ReactNode;
}

export const GlobalSearchProvider: React.FC<GlobalSearchProviderProps> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [, setSearchParams] = useSearchParams();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResponse>({
    serials: [],
    items: [],
    movements: [],
    locations: [],
    total: 0,
  });
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [filters, setFilters] = useState<SearchFilters>({});
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load recent searches from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('globalSearchRecent');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setRecentSearches(parsed.slice(0, 10)); // Limit to 10
        }
      }
    } catch (error) {
      logger.warn('Failed to load global search recent searches', { cause: error });
    }
  }, []);

  // Save recent searches to localStorage
  const saveRecentSearch = useCallback((searchQuery: string) => {
    if (!searchQuery || searchQuery.trim().length === 0) return;

    try {
      const updated = [
        searchQuery.trim(),
        ...recentSearches.filter((s) => s.toLowerCase() !== searchQuery.trim().toLowerCase()),
      ].slice(0, 10); // Keep only 10 most recent

      setRecentSearches(updated);
      localStorage.setItem('globalSearchRecent', JSON.stringify(updated));
    } catch (error) {
      logger.warn('Failed to save global search recent search', { cause: error });
    }
  }, [recentSearches]);

  // Clear recent searches
  const clearRecentSearches = useCallback(() => {
    setRecentSearches([]);
    try {
      localStorage.removeItem('globalSearchRecent');
    } catch (error) {
      logger.warn('Failed to clear global search recent searches', { cause: error });
    }
  }, []);

  // Page targets filtered by query (client-side)
  const filteredPages = useMemo(() => filterPagesByQuery(query), [query]);

  // Flatten: pages first, then entity results (so one index drives keyboard + selection)
  const flattenedResults = useMemo(
    () => [
      ...filteredPages,
      ...results.serials,
      ...results.items,
      ...results.movements,
      ...results.locations,
    ],
    [filteredPages, results.serials, results.items, results.movements, results.locations]
  );

  // Search function with debouncing
  const performSearch = useCallback(
    async (searchQuery: string) => {
      if (!searchQuery || searchQuery.trim().length === 0) {
        setResults({
          serials: [],
          items: [],
          movements: [],
          locations: [],
          total: 0,
        });
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const searchResults = await searchService.search(searchQuery, filters, 15);
        setResults(searchResults);
        setSelectedIndex(0);
      } catch (error: unknown) {
        const canceled =
          error instanceof Error &&
          (error.message === 'Search canceled' || error.name === 'CanceledError');
        if (!canceled) {
          logger.error(
            'Global search request failed',
            error instanceof Error ? error : undefined,
          );
        }
        setResults({
          serials: [],
          items: [],
          movements: [],
          locations: [],
          total: 0,
        });
        setSelectedIndex(-1);
      } finally {
        setLoading(false);
      }
    },
    [filters]
  );

  // Debounced search
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (query.trim().length === 0) {
      setResults({
        serials: [],
        items: [],
        movements: [],
        locations: [],
        total: 0,
      });
      setLoading(false);
      return;
    }

    debounceTimerRef.current = setTimeout(() => {
      performSearch(query);
    }, 200);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [query, performSearch]);

  // Open modal
  const open = useCallback(() => {
    // Store current focus
    previousFocusRef.current = document.activeElement as HTMLElement;
    setIsOpen(true);
    setQuery('');
    setSelectedIndex(-1);
  }, []);

  // Close modal
  const close = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setResults({
      serials: [],
      items: [],
      movements: [],
      locations: [],
      total: 0,
    });
    setSelectedIndex(-1);
    searchService.cancel();

    // Restore focus
    if (previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, []);

  // Select result and navigate
  const selectSearchResult = useCallback(
    (result: FlatSearchResult) => {
      if (!result) return;

      if (result.type === 'page') {
        close();
        const route = result.route;
        const [pathname, search] = route.includes('?') ? route.split('?', 2) : [route, ''];
        if (pathname === location.pathname && search) {
          setSearchParams(new URLSearchParams(search), { replace: true });
        } else {
          navigate(search ? { pathname, search: `?${search}` } : pathname);
        }
        return;
      }

      if (!result.route) {
        logger.warn('Global search result missing route', { type: result.type, id: (result as { id?: string }).id });
        return;
      }

      if (query.trim().length > 0) {
        saveRecentSearch(query);
      }

      if (result.type === 'serial') {
        const serialResult = result as SearchResponse['serials'][number];
        close();
        const params = new URLSearchParams();
        params.set('tab', 'items');
        if (serialResult.item?.id) {
          params.set('itemId', serialResult.item.id);
        }
        if (serialResult.variant?.id) {
          params.set('variantId', serialResult.variant.id);
        }
        params.set('serialNumber', serialResult.serialNumber);
        params.set('itemSubTab', 'tracking');
        navigate(`/inventory?${params.toString()}`);
        return;
      }

      if (result.type === 'item') {
        const itemResult = result as ItemSearchResult;
        close();
        const u = new URL(
          itemResult.route || `/inventory?tab=items&itemId=${encodeURIComponent(itemResult.id)}`,
          window.location.origin
        );
        const vid = itemResult.searchMatch?.variant?.id;
        if (vid) {
          u.searchParams.set('variantId', vid);
          u.searchParams.set('itemSubTab', 'stock');
        }
        const pathname = u.pathname;
        const searchStr = u.searchParams.toString();
        if (pathname === location.pathname && searchStr) {
          setSearchParams(new URLSearchParams(searchStr), { replace: true });
        } else {
          navigate(searchStr ? { pathname, search: `?${searchStr}` } : pathname);
        }
        return;
      }

      close();
      navigate(result.route);
    },
    [navigate, close, query, saveRecentSearch, location.pathname, setSearchParams]
  );

  const selectResult = useCallback(
    (index: number) => {
      if (index < 0 || index >= flattenedResults.length) {
        return;
      }
      const result = flattenedResults[index];
      if (!result) return;
      selectSearchResult(result);
    },
    [flattenedResults, selectSearchResult]
  );

  // Global keyboard shortcut (Ctrl+K / Cmd+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+K or Cmd+K
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        if (isOpen) {
          close();
        } else {
          open();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, open, close]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      searchService.cancel();
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Clamp selectedIndex when flattenedResults length changes
  useEffect(() => {
    const total = flattenedResults.length;
    if (total === 0) {
      setSelectedIndex(-1);
    } else if (selectedIndex >= total) {
      setSelectedIndex(total - 1);
    } else if (selectedIndex < 0 && total > 0) {
      setSelectedIndex(0);
    }
  }, [flattenedResults.length]);

  const value: GlobalSearchContextValue = {
    isOpen,
    open,
    close,
    query,
    setQuery,
    results,
    filteredPages,
    flattenedResults,
    loading,
    selectedIndex,
    setSelectedIndex,
    selectResult,
    selectSearchResult,
    filters,
    setFilters,
    recentSearches,
    clearRecentSearches,
  };

  return <GlobalSearchContext.Provider value={value}>{children}</GlobalSearchContext.Provider>;
};
