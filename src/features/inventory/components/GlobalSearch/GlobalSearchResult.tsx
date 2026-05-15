/**
 * Global Search Result Item Component
 */

import React from 'react';
import {
  SerialSearchResult,
  ItemSearchResult,
  MovementSearchResult,
  LocationSearchResult,
  PageSearchResult,
} from '../../types/search.types';
import './GlobalSearchResult.css';

type SearchResult = SerialSearchResult | ItemSearchResult | MovementSearchResult | LocationSearchResult | PageSearchResult;

interface GlobalSearchResultProps {
  result: SearchResult;
  isSelected: boolean;
  query: string;
  onClick: () => void;
}

const getTypeIcon = (type: string): string => {
  switch (type) {
    case 'serial':
      return '🔢';
    case 'item':
      return '📦';
    case 'movement':
      return '📋';
    case 'location':
      return '📍';
    case 'page':
      return '📄';
    default:
      return '🔍';
  }
};

const getTypeLabel = (type: string): string => {
  switch (type) {
    case 'serial':
      return 'Serial';
    case 'item':
      return 'Item';
    case 'movement':
      return 'Movement';
    case 'location':
      return 'Location';
    case 'page':
      return 'Page';
    default:
      return 'Result';
  }
};

const highlightMatch = (text: string, query: string): React.ReactNode => {
  if (!query || query.trim().length === 0) return text;

  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="global-search-highlight">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
};

export const GlobalSearchResult: React.FC<GlobalSearchResultProps> = ({
  result,
  isSelected,
  query,
  onClick,
}) => {
  const renderContent = () => {
    switch (result.type) {
      case 'serial': {
        const serialResult = result as SerialSearchResult;
        return (
          <>
            <div className="global-search-result-header">
              <span className="global-search-result-icon">{getTypeIcon('serial')}</span>
              <div className="global-search-result-title">
                {highlightMatch(serialResult.serialNumber, query)}
              </div>
              <span className="global-search-result-type">{getTypeLabel('serial')}</span>
            </div>
            <div className="global-search-result-subtitle">
              {serialResult.item?.name || 'Unknown Item'}
              {serialResult.variant && ` • ${serialResult.variant.name}`}
              {serialResult.location && ` → ${serialResult.location.name}`}
            </div>
            {serialResult.status && (
              <div className="global-search-result-meta">
                Status: {serialResult.status}
              </div>
            )}
          </>
        );
      }

      case 'item': {
        const itemResult = result as ItemSearchResult;
        return (
          <>
            <div className="global-search-result-header">
              <span className="global-search-result-icon">{getTypeIcon('item')}</span>
              <div className="global-search-result-title">
                {highlightMatch(itemResult.sku, query)}
              </div>
              <span className="global-search-result-type">{getTypeLabel('item')}</span>
            </div>
            <div className="global-search-result-subtitle">{itemResult.name}</div>
            {itemResult.searchMatch?.variant ? (
              <div className="global-search-result-meta">
                Variant: {itemResult.searchMatch.variant.name}
                {itemResult.searchMatch.variant.code ? ` · ${itemResult.searchMatch.variant.code}` : ''}
              </div>
            ) : null}
            {itemResult.category && (
              <div className="global-search-result-meta">Category: {itemResult.category}</div>
            )}
            {itemResult.hasVariants && !itemResult.searchMatch?.variant && (
              <div className="global-search-result-meta">Has Variants</div>
            )}
          </>
        );
      }

      case 'movement': {
        const movementResult = result as MovementSearchResult;
        return (
          <>
            <div className="global-search-result-header">
              <span className="global-search-result-icon">{getTypeIcon('movement')}</span>
              <div className="global-search-result-title">
                {highlightMatch(movementResult.movementNumber, query)}
              </div>
              <span className="global-search-result-type">{getTypeLabel('movement')}</span>
            </div>
            <div className="global-search-result-subtitle">
              {movementResult.movementType} • {movementResult.status}
            </div>
            <div className="global-search-result-meta">
              {new Date(movementResult.date).toLocaleDateString()}
              {movementResult.itemCount && ` • ${movementResult.itemCount} items`}
            </div>
          </>
        );
      }

      case 'location': {
        const locationResult = result as LocationSearchResult;
        return (
          <>
            <div className="global-search-result-header">
              <span className="global-search-result-icon">{getTypeIcon('location')}</span>
              <div className="global-search-result-title">
                {highlightMatch(locationResult.code, query)}
              </div>
              <span className="global-search-result-type">{getTypeLabel('location')}</span>
            </div>
            <div className="global-search-result-subtitle">{locationResult.name}</div>
            {locationResult.path && (
              <div className="global-search-result-meta">{locationResult.path}</div>
            )}
            <div className="global-search-result-meta">Type: {locationResult.locationType}</div>
          </>
        );
      }

      case 'page': {
        const pageResult = result as PageSearchResult;
        return (
          <>
            <div className="global-search-result-header">
              <span className="global-search-result-icon">{getTypeIcon('page')}</span>
              <div className="global-search-result-title">
                {highlightMatch(pageResult.title, query)}
              </div>
              <span className="global-search-result-type">{getTypeLabel('page')}</span>
            </div>
            {pageResult.subtitle && (
              <div className="global-search-result-subtitle">{pageResult.subtitle}</div>
            )}
          </>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div
      className={`global-search-result ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {renderContent()}
    </div>
  );
};
