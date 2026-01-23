/**
 * Search Navigation Helpers - Utility functions for navigating to search results
 */

import { SearchResult } from '../types/search.types';

/**
 * Get navigation route for a search result
 */
export function getResultRoute(result: SearchResult): string {
  return result.route;
}

/**
 * Format result for display
 */
export function formatResultTitle(result: SearchResult, query: string): string {
  return highlightMatch(result.title, query);
}

/**
 * Highlight matched text in a string
 */
export function highlightMatch(text: string, query: string): string {
  if (!query || !text) return text;

  const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
  return text.replace(regex, '<mark>$1</mark>');
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Get icon for result type
 */
export function getResultIcon(type: SearchResult['type']): string {
  switch (type) {
    case 'serial':
      return '🔢';
    case 'item':
      return '📦';
    case 'movement':
      return '📋';
    case 'location':
      return '📍';
    default:
      return '🔍';
  }
}

/**
 * Get color for result type
 */
export function getResultColor(type: SearchResult['type']): string {
  switch (type) {
    case 'serial':
      return '#3b82f6'; // blue
    case 'item':
      return '#10b981'; // green
    case 'movement':
      return '#f59e0b'; // amber
    case 'location':
      return '#8b5cf6'; // purple
    default:
      return '#6b7280'; // gray
  }
}
