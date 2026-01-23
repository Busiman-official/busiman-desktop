/**
 * Global Search Provider - Context for managing global search state
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchService } from '../../services/search.service';
import { SearchResponse, SearchFilters } from '../../types/search.types';

interface GlobalSearchContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  query: string;
  setQuery: (query: string) => void;
  results: SearchResponse;
  loading: boolean;
  selectedIndex: number;
  setSelectedIndex: (index: number) => void;
  selectResult: (index: number) => void;
  filters: SearchFilters;
  setFilters: (filters: SearchFilters) => void;
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
      console.error('Failed to load recent searches:', error);
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
      console.error('Failed to save recent search:', error);
    }
  }, [recentSearches]);

  // Clear recent searches
  const clearRecentSearches = useCallback(() => {
    setRecentSearches([]);
    try {
      localStorage.removeItem('globalSearchRecent');
    } catch (error) {
      console.error('Failed to clear recent searches:', error);
    }
  }, []);

  // Flatten results for navigation
  const flattenedResults = [
    ...results.serials,
    ...results.items,
    ...results.movements,
    ...results.locations,
  ];

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
        // Auto-select first result when results load
        const totalResults = searchResults.serials.length + 
                            searchResults.items.length + 
                            searchResults.movements.length + 
                            searchResults.locations.length;
        setSelectedIndex(totalResults > 0 ? 0 : -1);
      } catch (error: any) {
        if (error.message !== 'Search canceled') {
          console.error('Search error:', error);
        }
        setResults({
          serials: [],
          items: [],
          movements: [],
          locations: [],
          total: 0,
        });
        setSelectedIndex(-1); // Clear selection on error
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
      setSelectedIndex(-1); // Clear selection when query is empty
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
  const selectResult = useCallback(
    (index: number) => {
      // Recalculate flattened results to ensure we have latest data
      const currentFlattened = [
        ...results.serials,
        ...results.items,
        ...results.movements,
        ...results.locations,
      ];
      
      if (index < 0 || index >= currentFlattened.length) {
        console.warn(`Invalid result index: ${index} (total: ${currentFlattened.length})`);
        return;
      }

      const result = currentFlattened[index];
      if (!result || !result.route) {
        console.warn('Result missing route:', result);
        return;
      }
      
      // Save to recent searches
      if (query.trim().length > 0) {
        saveRecentSearch(query);
      }
      
      // Special handling for serial results: open detail panel via URL param
      if (result.type === 'serial') {
        const serialResult = result as any;
        close();
        // Navigate to inventory with serialNumber param to trigger detail panel
        const params = new URLSearchParams();
        params.set('tab', 'items');
        if (serialResult.item?.id) {
          params.set('itemId', serialResult.item.id);
        }
        params.set('serialNumber', serialResult.serialNumber);
        params.set('itemSubTab', 'tracking');
        navigate(`/inventory?${params.toString()}`);
        return;
      }
      
      close();
      navigate(result.route);
    },
    [results, navigate, close, query, saveRecentSearch]
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

  const value: GlobalSearchContextValue = {
    isOpen,
    open,
    close,
    query,
    setQuery,
    results,
    loading,
    selectedIndex,
    setSelectedIndex,
    selectResult,
    filters,
    setFilters,
    recentSearches,
    clearRecentSearches,
  };

  return <GlobalSearchContext.Provider value={value}>{children}</GlobalSearchContext.Provider>;
};
