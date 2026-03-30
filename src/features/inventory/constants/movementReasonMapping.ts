/**
 * Movement type to reason code mapping: allowed categories, defaults, and lock rules.
 * Used by CreateMovementView and by entry points that build create-movement URLs.
 */

/** Reason code category (must match server ReasonCodeCategory) */
export type ReasonCategory =
  | 'MOVEMENT'
  | 'DAMAGE'
  | 'WASTE'
  | 'LOSS'
  | 'ADJUSTMENT'
  | 'BLOCK';

/** Movement type (must match MovementType enum) */
export type MovementType =
  | 'RECEIPT'
  | 'ISSUE'
  | 'TRANSFER'
  | 'ADJUSTMENT'
  | 'COUNT_ADJUSTMENT'
  | 'DAMAGE'
  | 'WASTE'
  | 'LOSS'
  | 'BLOCK'
  | 'UNBLOCK'
  | 'REVERSAL'
  | 'STOCK_MIGRATION';

/** Source context for choosing default reason (and lock) */
export type MovementSource =
  | 'item'
  | 'location'
  | 'location_from'
  | 'quick'
  | 'manual'
  | 'count_approve'
  | 'history';

/** Movement type -> allowed reason code categories */
export const MOVEMENT_TYPE_CATEGORIES: Record<MovementType, ReasonCategory[]> = {
  RECEIPT: ['MOVEMENT'],
  ISSUE: ['MOVEMENT'],
  TRANSFER: ['MOVEMENT'],
  ADJUSTMENT: ['ADJUSTMENT'],
  COUNT_ADJUSTMENT: ['ADJUSTMENT'],
  REVERSAL: ['ADJUSTMENT'],
  STOCK_MIGRATION: ['ADJUSTMENT'],
  DAMAGE: ['DAMAGE'],
  WASTE: ['WASTE'],
  LOSS: ['LOSS'],
  BLOCK: ['BLOCK'],
  UNBLOCK: ['BLOCK'],
};

/**
 * Default reason code and lock per (movementType, source).
 * Falls back to (movementType, undefined) then to first listed for that type.
 */
const DEFAULTS: Array<{
  movementType: MovementType;
  source?: MovementSource;
  defaultCode: string;
  reasonLocked: boolean;
}> = [
  { movementType: 'RECEIPT', source: 'item', defaultCode: 'RECEIPT', reasonLocked: false },
  { movementType: 'RECEIPT', source: 'location', defaultCode: 'RECEIPT', reasonLocked: false },
  { movementType: 'RECEIPT', source: 'quick', defaultCode: 'RECEIPT', reasonLocked: false },
  { movementType: 'ISSUE', source: 'item', defaultCode: 'ISSUE', reasonLocked: false },
  { movementType: 'ISSUE', source: 'location', defaultCode: 'ISSUE', reasonLocked: false },
  { movementType: 'TRANSFER', source: 'item', defaultCode: 'TRANSFER', reasonLocked: false },
  { movementType: 'TRANSFER', source: 'location_from', defaultCode: 'TRANSFER', reasonLocked: false },
  { movementType: 'TRANSFER', source: 'quick', defaultCode: 'TRANSFER', reasonLocked: false },
  { movementType: 'ADJUSTMENT', source: 'manual', defaultCode: 'ADJUSTMENT', reasonLocked: false },
  { movementType: 'COUNT_ADJUSTMENT', source: 'count_approve', defaultCode: 'COUNT_VARIANCE', reasonLocked: true },
  { movementType: 'DAMAGE', defaultCode: 'DAMAGE_TRANSPORT', reasonLocked: false },
  { movementType: 'WASTE', defaultCode: 'WASTE_EXPIRED', reasonLocked: false },
  { movementType: 'REVERSAL', source: 'history', defaultCode: 'REVERSAL', reasonLocked: true },
  { movementType: 'BLOCK', defaultCode: 'BLOCK_QUALITY', reasonLocked: false },
  { movementType: 'UNBLOCK', defaultCode: 'BLOCK_QUALITY', reasonLocked: false },
  { movementType: 'LOSS', defaultCode: 'LOSS_MISSING', reasonLocked: false },
  { movementType: 'STOCK_MIGRATION', defaultCode: 'STOCK_MIGRATION', reasonLocked: true },
  // Fallbacks when source not matched
  { movementType: 'RECEIPT', defaultCode: 'RECEIPT', reasonLocked: false },
  { movementType: 'ISSUE', defaultCode: 'ISSUE', reasonLocked: false },
  { movementType: 'TRANSFER', defaultCode: 'TRANSFER', reasonLocked: false },
  { movementType: 'ADJUSTMENT', defaultCode: 'ADJUSTMENT', reasonLocked: false },
  { movementType: 'COUNT_ADJUSTMENT', defaultCode: 'COUNT_VARIANCE', reasonLocked: false },
  { movementType: 'REVERSAL', defaultCode: 'REVERSAL', reasonLocked: false },
  { movementType: 'STOCK_MIGRATION', defaultCode: 'STOCK_MIGRATION', reasonLocked: true },
];

export interface DefaultReasonResult {
  defaultCode: string;
  reasonLocked: boolean;
}

/**
 * Returns the default reason code and whether it is locked for (movementType, source).
 */
export function getDefaultReason(
  movementType: MovementType,
  source?: MovementSource
): DefaultReasonResult {
  const withSource = DEFAULTS.find(
    (d) => d.movementType === movementType && d.source === source
  );
  if (withSource) return { defaultCode: withSource.defaultCode, reasonLocked: withSource.reasonLocked };
  const fallback = DEFAULTS.find(
    (d) => d.movementType === movementType && d.source === undefined
  );
  if (fallback) return { defaultCode: fallback.defaultCode, reasonLocked: fallback.reasonLocked };
  return { defaultCode: 'ADJUSTMENT', reasonLocked: false };
}

/**
 * Returns allowed reason code categories for a movement type.
 */
export function getAllowedCategories(movementType: MovementType): ReasonCategory[] {
  return MOVEMENT_TYPE_CATEGORIES[movementType] ?? ['ADJUSTMENT'];
}

/**
 * Returns true if a reason code is allowed for the movement type.
 * reasonCategory must match the code's category (caller passes codes with category).
 */
export function isReasonAllowedForMovementType(
  movementType: MovementType,
  reasonCategory: string
): boolean {
  const allowed = getAllowedCategories(movementType);
  return allowed.includes(reasonCategory as ReasonCategory);
}

/** Human-readable labels for movement types (history, reports, filters). */
export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  RECEIPT: 'Receipt',
  ISSUE: 'Issue',
  TRANSFER: 'Transfer',
  ADJUSTMENT: 'Adjustment',
  COUNT_ADJUSTMENT: 'Count Adjustment',
  DAMAGE: 'Damage',
  WASTE: 'Waste',
  LOSS: 'Loss',
  BLOCK: 'Block',
  UNBLOCK: 'Unblock',
  REVERSAL: 'Reversal',
  STOCK_MIGRATION: 'Stock Migration',
};

export function getMovementTypeLabel(movementType: string): string {
  return MOVEMENT_TYPE_LABELS[movementType] ?? movementType;
}
