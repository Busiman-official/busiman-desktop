/**
 * Serial Utilities - Pure functions for serial status computation, filtering, sorting, and search
 * Optimized for performance with memoization-friendly functions
 */

import type { SerialResponse } from '@/services/inventory.service';

export type SerialStatusType = 'AVAILABLE' | 'RESERVED' | 'BLOCKED' | 'DAMAGED' | 'DISPOSED' | 'IN_TRANSIT';

export interface SerialStatusAppearance {
  color: string;
  bgColor: string;
  icon: string;
  label: string;
  badgeClass: string;
}

/**
 * Get user-friendly status label
 */
export function getSerialStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    AVAILABLE: 'Available',
    RESERVED: 'Reserved',
    BLOCKED: 'Blocked',
    DAMAGED: 'Damaged',
    DISPOSED: 'Disposed',
    IN_TRANSIT: 'In Transit',
  };
  return labels[status] || status;
}

/**
 * Get status icon/emoji
 */
export function getSerialStatusIcon(status: string): string {
  const icons: Record<string, string> = {
    AVAILABLE: '✓',
    RESERVED: '🔒',
    BLOCKED: '🚫',
    DAMAGED: '⚠️',
    DISPOSED: '🗑️',
    IN_TRANSIT: '🚚',
  };
  return icons[status] || '•';
}

/**
 * Check if serial is expired
 */
export function isSerialExpired(expiryDate?: string | Date): boolean {
  if (!expiryDate) return false;
  const expiry = typeof expiryDate === 'string' ? new Date(expiryDate) : expiryDate;
  return expiry < new Date();
}

/**
 * Check if serial is near expiry
 */
export function isSerialNearExpiry(expiryDate?: string | Date, daysAhead: number = 30): boolean {
  if (!expiryDate) return false;
  const expiry = typeof expiryDate === 'string' ? new Date(expiryDate) : expiryDate;
  const today = new Date();
  const daysUntil = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return daysUntil >= 0 && daysUntil <= daysAhead;
}

/**
 * Get days until expiry
 */
export function getDaysUntilExpiry(expiryDate?: string | Date): number | null {
  if (!expiryDate) return null;
  const expiry = typeof expiryDate === 'string' ? new Date(expiryDate) : expiryDate;
  const today = new Date();
  const days = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return days;
}

/**
 * Get comprehensive status appearance (color, icon, label, badge class)
 * Considers both status and expiry for visual cues
 */
export function getSerialStatusAppearance(serial: SerialResponse): SerialStatusAppearance {
  const status = serial.currentStatus;
  const expiryDate = serial.expiryDate;
  const isExpired = expiryDate ? isSerialExpired(expiryDate) : false;
  const daysUntil = expiryDate ? getDaysUntilExpiry(expiryDate) : null;

  // Expired takes precedence
  if (isExpired) {
    return {
      color: '#dc2626',
      bgColor: '#fee2e2',
      icon: '⛔',
      label: 'Expired',
      badgeClass: 'status-expired',
    };
  }

  // Near expiry warnings
  if (daysUntil !== null && daysUntil >= 0) {
    if (daysUntil <= 7) {
      return {
        color: '#ea580c',
        bgColor: '#ffedd5',
        icon: '🔴',
        label: `Expires in ${daysUntil} day${daysUntil !== 1 ? 's' : ''}`,
        badgeClass: 'status-critical',
      };
    }
    if (daysUntil <= 30) {
      return {
        color: '#f59e0b',
        bgColor: '#fef3c7',
        icon: '🟠',
        label: `Expires in ${daysUntil} days`,
        badgeClass: 'status-warning',
      };
    }
  }

  // Status-based appearance
  switch (status) {
    case 'BLOCKED':
      return {
        color: '#6b7280',
        bgColor: '#f3f4f6',
        icon: getSerialStatusIcon(status),
        label: getSerialStatusLabel(status),
        badgeClass: 'status-blocked',
      };
    case 'DAMAGED':
      return {
        color: '#dc2626',
        bgColor: '#fee2e2',
        icon: getSerialStatusIcon(status),
        label: getSerialStatusLabel(status),
        badgeClass: 'status-damaged',
      };
    case 'IN_TRANSIT':
      return {
        color: '#2563eb',
        bgColor: '#dbeafe',
        icon: getSerialStatusIcon(status),
        label: getSerialStatusLabel(status),
        badgeClass: 'status-in-transit',
      };
    case 'RESERVED':
      return {
        color: '#7c3aed',
        bgColor: '#ede9fe',
        icon: getSerialStatusIcon(status),
        label: getSerialStatusLabel(status),
        badgeClass: 'status-reserved',
      };
    case 'DISPOSED':
      return {
        color: '#6b7280',
        bgColor: '#f3f4f6',
        icon: getSerialStatusIcon(status),
        label: getSerialStatusLabel(status),
        badgeClass: 'status-disposed',
      };
    case 'AVAILABLE':
    default:
      return {
        color: '#16a34a',
        bgColor: '#dcfce7',
        icon: getSerialStatusIcon(status),
        label: getSerialStatusLabel(status),
        badgeClass: 'status-available',
      };
  }
}

/**
 * Filter serials by status
 */
export function filterSerialsByStatus(serials: SerialResponse[], status?: string): SerialResponse[] {
  if (!status) return serials;
  return serials.filter((s) => s.currentStatus === status);
}

/**
 * Filter serials by location
 */
export function filterSerialsByLocation(serials: SerialResponse[], locationId?: string): SerialResponse[] {
  if (!locationId) return serials;
  return serials.filter((s) => s.currentLocationId === locationId);
}

/**
 * Filter serials by item
 */
export function filterSerialsByItem(serials: SerialResponse[], itemId?: string): SerialResponse[] {
  if (!itemId) return serials;
  return serials.filter((s) => s.itemId === itemId);
}

/**
 * Search serials (serial number, item name, location, batch)
 */
export function searchSerials(serials: SerialResponse[], query: string): SerialResponse[] {
  if (!query || query.trim().length === 0) return serials;
  
  const searchLower = query.trim().toLowerCase();
  
  return serials.filter((serial) => {
    // Search serial number
    if (serial.serialNumber.toLowerCase().includes(searchLower)) return true;
    
    // Search item name/SKU
    if (serial.item?.name?.toLowerCase().includes(searchLower)) return true;
    if (serial.item?.sku?.toLowerCase().includes(searchLower)) return true;
    
    // Search location
    if (serial.currentLocation?.name?.toLowerCase().includes(searchLower)) return true;
    if (serial.currentLocation?.code?.toLowerCase().includes(searchLower)) return true;
    
    // Search batch
    if (serial.batchNumber?.toLowerCase().includes(searchLower)) return true;
    
    // Search variant
    if (serial.variant?.name?.toLowerCase().includes(searchLower)) return true;
    if (serial.variant?.code?.toLowerCase().includes(searchLower)) return true;
    
    return false;
  });
}

/**
 * Sort serials by column
 */
export function sortSerials(
  serials: SerialResponse[],
  column: string | null,
  direction: 'asc' | 'desc' = 'asc'
): SerialResponse[] {
  if (!column) return serials;
  const sorted = [...serials]; // Create copy to avoid mutation
  
  sorted.sort((a, b) => {
    let aVal: any;
    let bVal: any;
    
    switch (column) {
      case 'serialNumber':
        aVal = a.serialNumber;
        bVal = b.serialNumber;
        break;
      case 'itemName':
        aVal = a.item?.name || '';
        bVal = b.item?.name || '';
        break;
      case 'location':
        aVal = a.currentLocation?.name || '';
        bVal = b.currentLocation?.name || '';
        break;
      case 'status':
        aVal = a.currentStatus;
        bVal = b.currentStatus;
        break;
      case 'batch':
        aVal = a.batchNumber || '';
        bVal = b.batchNumber || '';
        break;
      case 'expiryDate':
        aVal = a.expiryDate ? new Date(a.expiryDate).getTime() : 0;
        bVal = b.expiryDate ? new Date(b.expiryDate).getTime() : 0;
        break;
      case 'lastMovement':
        aVal = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        bVal = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        break;
      default:
        return 0;
    }
    
    // Handle string comparison
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      const comparison = aVal.localeCompare(bVal);
      return direction === 'asc' ? comparison : -comparison;
    }
    
    // Handle number comparison
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return direction === 'asc' ? aVal - bVal : bVal - aVal;
    }
    
    return 0;
  });
  
  return sorted;
}

/**
 * Format date for display
 */
export function formatSerialDate(date?: string | Date): string {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format date with time
 */
export function formatSerialDateTime(date?: string | Date): string {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Apply all filters and sorting to serials
 */
export function applySerialFilters(
  serials: SerialResponse[],
  filters: {
    search?: string;
    status?: string;
    locationId?: string;
    itemId?: string;
  },
  sortColumn?: string | null,
  sortDirection?: 'asc' | 'desc'
): SerialResponse[] {
  let result = [...serials];
  
  // Apply search
  if (filters.search) {
    result = searchSerials(result, filters.search);
  }
  
  // Apply status filter
  if (filters.status) {
    result = filterSerialsByStatus(result, filters.status);
  }
  
  // Apply location filter
  if (filters.locationId) {
    result = filterSerialsByLocation(result, filters.locationId);
  }
  
  // Apply item filter
  if (filters.itemId) {
    result = filterSerialsByItem(result, filters.itemId);
  }
  
  // Apply sorting
  if (sortColumn && sortDirection) {
    result = sortSerials(result, sortColumn, sortDirection);
  }
  
  return result;
}
