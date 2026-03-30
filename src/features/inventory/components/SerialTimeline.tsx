/**
 * Serial Timeline Component - Vertical timeline for movement history
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { formatSerialDateTime } from '../utils/serialUtils';
import './SerialTimeline.css';

export interface SerialHistoryEntry {
  movementId: string;
  movementNumber: string;
  movementType: string;
  date: string;
  fromLocation?: { id: string; code: string; name: string };
  toLocation?: { id: string; code: string; name: string };
  quantity: number;
  status: string;
  user?: { id: string; name: string; email: string };
}

export interface SerialTimelineProps {
  history: SerialHistoryEntry[];
  loading?: boolean;
  onMovementClick?: (movementId: string, movementNumber: string) => void;
}

const getMovementTypeLabel = (type: string): string => {
  const labels: Record<string, string> = {
    RECEIPT: 'Received',
    ISSUE: 'Issued',
    TRANSFER: 'Transferred',
    ADJUSTMENT: 'Adjusted',
    DAMAGE: 'Damaged',
    WASTE: 'Wasted',
    LOSS: 'Lost',
    BLOCK: 'Blocked',
    UNBLOCK: 'Unblocked',
    COUNT_ADJUSTMENT: 'Count Adjusted',
    REVERSAL: 'Reversed',
    STOCK_MIGRATION: 'Stock Migration',
  };
  return labels[type] || type;
};

const getMovementTypeIcon = (type: string): string => {
  const icons: Record<string, string> = {
    RECEIPT: '📥',
    ISSUE: '📤',
    TRANSFER: '↔️',
    ADJUSTMENT: '⚙️',
    DAMAGE: '⚠️',
    WASTE: '🗑️',
    LOSS: '❌',
    BLOCK: '🚫',
    UNBLOCK: '✅',
    COUNT_ADJUSTMENT: '📊',
    REVERSAL: '↩️',
    STOCK_MIGRATION: '📦',
  };
  return icons[type] || '📋';
};

const getMovementTypeColor = (type: string): string => {
  const colors: Record<string, string> = {
    RECEIPT: '#16a34a',
    ISSUE: '#dc2626',
    TRANSFER: '#2563eb',
    ADJUSTMENT: '#f59e0b',
    DAMAGE: '#dc2626',
    WASTE: '#6b7280',
    LOSS: '#6b7280',
    BLOCK: '#6b7280',
    UNBLOCK: '#16a34a',
    COUNT_ADJUSTMENT: '#7c3aed',
    REVERSAL: '#ea580c',
    STOCK_MIGRATION: '#0d9488',
  };
  return colors[type] || '#6b7280';
};

export const SerialTimeline: React.FC<SerialTimelineProps> = ({ history, loading = false, onMovementClick }) => {
  const navigate = useNavigate();

  const handleMovementClickInternal = (movementId: string, movementNumber: string) => {
    if (onMovementClick) {
      onMovementClick(movementId, movementNumber);
    } else {
      navigate(`/inventory?tab=movements&movementId=${movementId}`);
    }
  };

  if (loading) {
    return (
      <div className="serial-timeline-loading">
        <div className="timeline-skeleton" />
        <div className="timeline-skeleton" />
        <div className="timeline-skeleton" />
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="serial-timeline-empty">
        <div className="timeline-empty-icon">📋</div>
        <div className="timeline-empty-text">No movement history</div>
      </div>
    );
  }

  // Sort by date (newest first)
  const sortedHistory = [...history].sort((a, b) => {
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  return (
    <div className="serial-timeline">
      <div className="timeline-header">
        <h3>Movement Timeline</h3>
        <span className="timeline-count">{history.length} movement{history.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="timeline-content">
        {sortedHistory.map((entry, index) => {
          const typeColor = getMovementTypeColor(entry.movementType);
          const typeIcon = getMovementTypeIcon(entry.movementType);
          const typeLabel = getMovementTypeLabel(entry.movementType);

          return (
            <div key={entry.movementId} className="timeline-item">
              <div className="timeline-line" style={{ borderColor: typeColor }} />
              <div className="timeline-dot" style={{ backgroundColor: typeColor }}>
                <span className="timeline-dot-icon">{typeIcon}</span>
              </div>
              <div className="timeline-content-card">
                <div className="timeline-card-header">
                  <div className="timeline-card-type" style={{ color: typeColor }}>
                    {typeLabel}
                  </div>
                  <div className="timeline-card-date">{formatSerialDateTime(entry.date)}</div>
                </div>
                
                <div className="timeline-card-details">
                  {entry.fromLocation && entry.toLocation && (
                    <div className="timeline-card-location">
                      <span className="timeline-location-from">{entry.fromLocation.name}</span>
                      <span className="timeline-location-arrow">→</span>
                      <span className="timeline-location-to">{entry.toLocation.name}</span>
                    </div>
                  )}
                  {entry.fromLocation && !entry.toLocation && (
                    <div className="timeline-card-location">
                      <span className="timeline-location-from">From: {entry.fromLocation.name}</span>
                    </div>
                  )}
                  {entry.toLocation && !entry.fromLocation && (
                    <div className="timeline-card-location">
                      <span className="timeline-location-to">To: {entry.toLocation.name}</span>
                    </div>
                  )}
                  
                  {entry.user && (
                    <div className="timeline-card-user">
                      By: {entry.user.name}
                    </div>
                  )}
                </div>
                
                <div className="timeline-card-footer">
                  <button
                    className="timeline-movement-link"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMovementClickInternal(entry.movementId, entry.movementNumber);
                    }}
                  >
                    {entry.movementNumber}
                  </button>
                  {entry.status && (
                    <span className="timeline-card-status">Status: {entry.status}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
