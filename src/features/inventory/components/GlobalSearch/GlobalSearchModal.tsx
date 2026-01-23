/**
 * Global Search Modal - Command palette style search interface
 */

import React, { useEffect, useRef, useCallback, useMemo } from 'react';
import { useGlobalSearch } from './GlobalSearchProvider';
import { GlobalSearchResult } from './GlobalSearchResult';
import './GlobalSearchModal.css';

export const GlobalSearchModal: React.FC = () => {
  const {
    isOpen,
    close,
    query,
    setQuery,
    results,
    loading,
    selectedIndex,
    setSelectedIndex,
    selectResult,
    recentSearches,
  } = useGlobalSearch();

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Memoize flattened results to prevent recalculation on every render
  // This ensures stable indices for navigation
  const flattenedResults = useMemo(() => {
    return [
      ...results.serials,
      ...results.items,
      ...results.movements,
      ...results.locations,
    ];
  }, [results.serials, results.items, results.movements, results.locations]);
  
  // Store result count in ref to avoid closure issues
  const resultCountRef = useRef(flattenedResults.length);
  useEffect(() => {
    resultCountRef.current = flattenedResults.length;
  }, [flattenedResults.length]);

  // Auto-focus input on open
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isOpen]);

  // Track previous results length to detect when results actually change
  const prevResultsLengthRef = useRef(flattenedResults.length);
  
  // Auto-select first result when NEW results are loaded (and not loading)
  // Only run when results actually change, not on every selectedIndex change
  useEffect(() => {
    if (loading) return; // Don't interfere during loading
    
    const resultCount = flattenedResults.length;
    const prevCount = prevResultsLengthRef.current;
    
    // Update ref for next comparison
    prevResultsLengthRef.current = resultCount;
    
    // Only auto-select if results just changed (new search completed)
    const resultsJustChanged = resultCount !== prevCount;
    
    if (resultCount > 0) {
      // If results just changed, always select first result
      // Or if current selection is invalid, fix it
      if (resultsJustChanged || selectedIndex < 0 || selectedIndex >= resultCount) {
        setSelectedIndex(0);
      }
    } else {
      // No results: clear selection
      if (selectedIndex >= 0) {
        setSelectedIndex(-1);
      }
    }
    // Only depend on results changing, not selectedIndex (to avoid interference with keyboard nav)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, flattenedResults.length]);

  // Scroll selected result into view
  useEffect(() => {
    if (selectedIndex >= 0 && resultsRef.current) {
      const selectedElement = resultsRef.current.querySelector(
        `[data-result-index="${selectedIndex}"]`
      );
      if (selectedElement) {
        selectedElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  // Keyboard navigation
  // Use ref for resultCount to avoid stale closures
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Use ref to get current count, avoiding stale closure issues
      const resultCount = resultCountRef.current;
      
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          e.stopPropagation();
          if (resultCount === 0) break;
          
          setSelectedIndex((prev) => {
            // Get current count again inside the updater to ensure it's fresh
            const currentCount = resultCountRef.current;
            if (currentCount === 0) return -1;
            
            // If no selection, start at first item (index 0)
            if (prev < 0) return 0;
            // Move to next item, but don't exceed last index
            const next = prev + 1;
            return next < currentCount ? next : prev;
          });
          break;

        case 'ArrowUp':
          e.preventDefault();
          e.stopPropagation();
          if (resultCount === 0) break;
          
          setSelectedIndex((prev) => {
            // Get current count again inside the updater to ensure it's fresh
            const currentCount = resultCountRef.current;
            if (currentCount === 0) return -1;
            
            // If no selection, go to last item
            if (prev < 0) return currentCount - 1;
            // Move to previous item, but don't go below 0
            const next = prev - 1;
            return next >= 0 ? next : 0;
          });
          break;

        case 'Enter':
          e.preventDefault();
          e.stopPropagation();
          
          // If Ctrl+Enter or Cmd+Enter, always go to full search page
          if (e.ctrlKey || e.metaKey) {
            if (query.trim().length > 0) {
              close();
              window.location.href = `/inventory/search?q=${encodeURIComponent(query)}`;
            }
            break;
          }
          
          // Normal Enter key handling
          const currentCount = resultCountRef.current;
          if (currentCount === 0) {
            // No results: do nothing (Enter disabled)
            break;
          }
          
          // Use current selectedIndex, but validate it's in bounds
          // If invalid, default to first result
          const effectiveIndex = (selectedIndex >= 0 && selectedIndex < currentCount) 
            ? selectedIndex 
            : 0;
          
          // Only proceed if we have a valid selection
          if (effectiveIndex >= 0 && effectiveIndex < currentCount) {
            selectResult(effectiveIndex);
          }
          break;

        case 'Escape':
          e.preventDefault();
          close();
          break;

        case 'Home':
          e.preventDefault();
          e.stopPropagation();
          const homeCount = resultCountRef.current;
          if (homeCount > 0) {
            setSelectedIndex(0);
          }
          break;

        case 'End':
          e.preventDefault();
          e.stopPropagation();
          const endCount = resultCountRef.current;
          if (endCount > 0) {
            setSelectedIndex(endCount - 1);
          }
          break;

        default:
          break;
      }
    },
    [selectResult, close, query, setSelectedIndex]
  );

  if (!isOpen) return null;

  const hasResults = flattenedResults.length > 0;
  const hasQuery = query.trim().length > 0;

  return (
    <div className="global-search-overlay" onClick={close}>
      <div
        className="global-search-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="global-search-header">
          <div className="global-search-input-wrapper">
            <span className="global-search-icon">🔍</span>
            <input
              ref={inputRef}
              type="text"
              className="global-search-input"
              placeholder="Search serials, items, movements, locations..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete="off"
              spellCheck="false"
            />
            {query && (
              <button
                className="global-search-clear"
                onClick={() => setQuery('')}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>
        </div>

        <div className="global-search-content" ref={resultsRef}>
          {loading && (
            <div className="global-search-loading">
              <div className="global-search-skeleton">
                <div className="skeleton-line" style={{ width: '60%' }} />
                <div className="skeleton-line" style={{ width: '40%' }} />
              </div>
              <div className="global-search-skeleton">
                <div className="skeleton-line" style={{ width: '70%' }} />
                <div className="skeleton-line" style={{ width: '50%' }} />
              </div>
              <div className="global-search-skeleton">
                <div className="skeleton-line" style={{ width: '55%' }} />
                <div className="skeleton-line" style={{ width: '45%' }} />
              </div>
            </div>
          )}

          {!loading && hasQuery && !hasResults && (
            <div className="global-search-empty">
              <div className="global-search-empty-icon">🔍</div>
              <div className="global-search-empty-title">No results found</div>
              <div className="global-search-empty-text">
                Try a different search term or check your spelling
              </div>
            </div>
          )}

          {!loading && !hasQuery && (
            <div className="global-search-results">
              {recentSearches.length > 0 && (
                <div className="global-search-group">
                  <div className="global-search-group-header">Recent Searches</div>
                  {recentSearches.map((recentQuery, index) => (
                    <div
                      key={index}
                      className="global-search-recent-item"
                      onClick={() => setQuery(recentQuery)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setQuery(recentQuery);
                        }
                      }}
                    >
                      <span className="global-search-recent-icon">🕒</span>
                      <span className="global-search-recent-text">{recentQuery}</span>
                    </div>
                  ))}
                </div>
              )}
              {recentSearches.length === 0 && (
                <div className="global-search-empty">
                  <div className="global-search-empty-icon">⌨️</div>
                  <div className="global-search-empty-title">Start typing to search</div>
                  <div className="global-search-empty-text">
                    Search for serials, items, movements, or locations
                  </div>
                </div>
              )}
            </div>
          )}

          {!loading && hasResults && (
            <div className="global-search-results">
              {results.serials.length > 0 && (
                <div className="global-search-group">
                  <div className="global-search-group-header">Serials</div>
                  {results.serials.map((result, index) => {
                    const flatIndex = index;
                    return (
                      <div
                        key={result.id}
                        data-result-index={flatIndex}
                      >
                        <GlobalSearchResult
                          result={result}
                          isSelected={selectedIndex === flatIndex}
                          query={query}
                          onClick={() => selectResult(flatIndex)}
                        />
                      </div>
                    );
                  })}
                </div>
              )}

              {results.items.length > 0 && (
                <div className="global-search-group">
                  <div className="global-search-group-header">Items</div>
                  {results.items.map((result, index) => {
                    const flatIndex = results.serials.length + index;
                    return (
                      <div
                        key={result.id}
                        data-result-index={flatIndex}
                      >
                        <GlobalSearchResult
                          result={result}
                          isSelected={selectedIndex === flatIndex}
                          query={query}
                          onClick={() => selectResult(flatIndex)}
                        />
                      </div>
                    );
                  })}
                </div>
              )}

              {results.movements.length > 0 && (
                <div className="global-search-group">
                  <div className="global-search-group-header">Movements</div>
                  {results.movements.map((result, index) => {
                    const flatIndex = results.serials.length + results.items.length + index;
                    return (
                      <div
                        key={result.id}
                        data-result-index={flatIndex}
                      >
                        <GlobalSearchResult
                          result={result}
                          isSelected={selectedIndex === flatIndex}
                          query={query}
                          onClick={() => selectResult(flatIndex)}
                        />
                      </div>
                    );
                  })}
                </div>
              )}

              {results.locations.length > 0 && (
                <div className="global-search-group">
                  <div className="global-search-group-header">Locations</div>
                  {results.locations.map((result, index) => {
                    const flatIndex =
                      results.serials.length +
                      results.items.length +
                      results.movements.length +
                      index;
                    return (
                      <div
                        key={result.id}
                        data-result-index={flatIndex}
                      >
                        <GlobalSearchResult
                          result={result}
                          isSelected={selectedIndex === flatIndex}
                          query={query}
                          onClick={() => selectResult(flatIndex)}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="global-search-footer">
          <div className="global-search-hints">
            <span className="global-search-hint">
              <kbd>↑</kbd>
              <kbd>↓</kbd> Navigate
            </span>
            <span className="global-search-hint">
              <kbd>Enter</kbd> Select
            </span>
            <span className="global-search-hint">
              <kbd>Esc</kbd> Close
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
