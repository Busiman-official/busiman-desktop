/**
 * Inventory page targets for global search - single source of truth
 */

import type { PageSearchResult } from '../../types/search.types';

export interface InventoryPageTarget {
  id: string;
  title: string;
  subtitle?: string;
  route: string;
  keywords: string[];
}

const BASE = '/inventory';

export const INVENTORY_PAGE_TARGETS: InventoryPageTarget[] = [
  // Main tabs
  { id: 'items', title: 'Master', subtitle: 'Items and products', route: `${BASE}?tab=items`, keywords: ['item', 'product', 'sku', 'master', 'catalog'] },
  { id: 'locations', title: 'Location Management', subtitle: 'Warehouses and locations', route: `${BASE}?tab=locations`, keywords: ['location', 'warehouse', 'bin', 'zone', 'rack'] },
  { id: 'movements', title: 'Stock Movements', subtitle: 'Movements dashboard', route: `${BASE}?tab=movements`, keywords: ['movement', 'stock'] },
  { id: 'reports', title: 'Reports', subtitle: 'Inventory reports', route: `${BASE}?tab=reports`, keywords: ['report', 'analytics'] },
  { id: 'settings', title: 'Settings', subtitle: 'Inventory settings', route: `${BASE}?tab=settings`, keywords: ['setting', 'config', 'admin'] },
  // Movements sub
  { id: 'transactions', title: 'Transactions', subtitle: 'Receive, transfer, damage', route: `${BASE}?tab=movements`, keywords: ['transaction', 'receive', 'transfer', 'damage', 'waste', 'ledger'] },
  { id: 'counting', title: 'Stock Counting', subtitle: 'Cycle count and counts', route: `${BASE}?tab=movements&subTab=counting`, keywords: ['count', 'counting', 'cycle', 'physical', 'inventory count'] },
  { id: 'create-movement', title: 'Create Movement', subtitle: 'New receipt or transfer', route: `${BASE}?tab=movements&create=1`, keywords: ['create', 'new', 'receipt', 'transfer'] },
  // Reports sub
  { id: 'report-summary', title: 'Stock Summary', subtitle: 'Report', route: `${BASE}?tab=reports&report=summary`, keywords: ['summary', 'stock', 'overview'] },
  { id: 'report-location', title: 'Location-wise Stock', subtitle: 'Report', route: `${BASE}?tab=reports&report=location`, keywords: ['location', 'wise', 'by location'] },
  { id: 'report-expiry', title: 'Batch Expiry Risk', subtitle: 'Report', route: `${BASE}?tab=reports&report=expiry`, keywords: ['expiry', 'batch', 'fefo', 'expiring'] },
  { id: 'report-audit', title: 'Movement Audit', subtitle: 'Report', route: `${BASE}?tab=reports&report=audit`, keywords: ['audit', 'movement', 'history'] },
  { id: 'report-damage', title: 'Damage & Waste', subtitle: 'Report', route: `${BASE}?tab=reports&report=damage`, keywords: ['damage', 'waste', 'loss'] },
  { id: 'report-reconciliation', title: 'Reconciliation', subtitle: 'Report', route: `${BASE}?tab=reports&report=reconciliation`, keywords: ['reconciliation', 'variance'] },
  { id: 'report-variant', title: 'Variant Stock', subtitle: 'Report', route: `${BASE}?tab=reports&report=variant`, keywords: ['variant', 'sku'] },
  // Settings sub
  { id: 'settings-templates', title: 'Serial Templates', subtitle: 'Settings', route: `${BASE}?tab=settings&subTab=templates`, keywords: ['serial', 'template', 'attribute'] },
  { id: 'settings-bulk', title: 'Bulk Operations', subtitle: 'Settings', route: `${BASE}?tab=settings&subTab=bulk`, keywords: ['bulk', 'import'] },
  { id: 'settings-reason-codes', title: 'Reason Codes', subtitle: 'Settings', route: `${BASE}?tab=settings&subTab=reason-codes`, keywords: ['reason', 'code', 'reason code'] },
  { id: 'settings-preferences', title: 'Preferences', subtitle: 'Settings', route: `${BASE}?tab=settings&subTab=preferences`, keywords: ['preference', 'preferences'] },
  // Item Master sub (landing without itemId)
  { id: 'items-variants', title: 'Item Variants', subtitle: 'Item Master', route: `${BASE}?tab=items&itemSubTab=variants`, keywords: ['variant', 'item variant'] },
  { id: 'items-tracking', title: 'Serial Tracking', subtitle: 'Item Master', route: `${BASE}?tab=items&itemSubTab=tracking`, keywords: ['serial', 'tracking', 'traceability'] },
];

const MAX_PAGES_EMPTY_QUERY = 14;

export function filterPagesByQuery(query: string): PageSearchResult[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) {
    return INVENTORY_PAGE_TARGETS.slice(0, MAX_PAGES_EMPTY_QUERY).map((p, i) => ({
      type: 'page' as const,
      id: p.id,
      title: p.title,
      subtitle: p.subtitle,
      route: p.route,
      rank: i,
    }));
  }
  const filtered = INVENTORY_PAGE_TARGETS.filter((p) => {
    if (p.title.toLowerCase().includes(q)) return true;
    if (p.subtitle?.toLowerCase().includes(q)) return true;
    return p.keywords.some((k) => k.toLowerCase().includes(q) || q.includes(k.toLowerCase()));
  });
  return filtered.map((p, i) => ({
    type: 'page' as const,
    id: p.id,
    title: p.title,
    subtitle: p.subtitle,
    route: p.route,
    rank: i,
  }));
}
