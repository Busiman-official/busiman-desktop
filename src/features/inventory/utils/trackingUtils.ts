/**
 * Tracking Utilities - Helper functions for item tracking type determination
 */

import type { IndustryFlags } from '@/services/inventory.service';

export type TrackingType = 'NONE' | 'BATCH' | 'SERIAL' | 'SERIAL_OPTIONAL';

/**
 * Determines the single tracking type for an item based on industry flags.
 * Enforces mutual exclusivity: items can only have ONE tracking type.
 *
 * Priority: SERIAL(-family) > BATCH > NONE
 * If both flags are somehow true, SERIAL takes precedence (but this should be prevented by validation).
 *
 * @param industryFlags - The industry flags from an inventory item
 * @returns The tracking type: 'NONE', 'BATCH', 'SERIAL', or 'SERIAL_OPTIONAL'
 */
export function getTrackingType(industryFlags?: IndustryFlags | null): TrackingType {
  if (!industryFlags) return 'NONE';

  // SERIAL(-family) takes precedence if both are enabled (shouldn't happen, but handle gracefully)
  if (industryFlags.requiresSerialTracking) {
    return industryFlags.serialOptional ? 'SERIAL_OPTIONAL' : 'SERIAL';
  }

  if (industryFlags.requiresBatchTracking) {
    return 'BATCH';
  }

  return 'NONE';
}

/** True for SERIAL or SERIAL_OPTIONAL — "this is fundamentally a serial item," regardless of strictness. */
export function isSerialFamily(trackingType: TrackingType): boolean {
  return trackingType === 'SERIAL' || trackingType === 'SERIAL_OPTIONAL';
}

/**
 * Checks if an item requires batch tracking
 */
export function requiresBatchTracking(industryFlags?: IndustryFlags | null): boolean {
  return getTrackingType(industryFlags) === 'BATCH';
}

/**
 * Checks if an item requires serial tracking (strict — mandatory SERIAL only).
 * Use `isSerialFamily(getTrackingType(...))` where "is this a serial-ish item at all"
 * (not "is a serial mandatory") is what's actually needed.
 */
export function requiresSerialTracking(industryFlags?: IndustryFlags | null): boolean {
  return getTrackingType(industryFlags) === 'SERIAL';
}

/**
 * Checks if an item has no tracking requirements
 */
export function hasNoTracking(industryFlags?: IndustryFlags | null): boolean {
  return getTrackingType(industryFlags) === 'NONE';
}

/**
 * Validates that tracking flags are mutually exclusive.
 * Returns an error message if both batch and serial tracking are enabled.
 */
export function validateTrackingFlags(industryFlags?: IndustryFlags | null): string | null {
  if (!industryFlags) return null;

  if (industryFlags.requiresBatchTracking && industryFlags.requiresSerialTracking) {
    return 'Items cannot have both batch tracking and serial tracking enabled. They are mutually exclusive.';
  }

  if (industryFlags.serialOptional && !industryFlags.requiresSerialTracking) {
    return 'serialOptional can only be set when serial tracking is enabled.';
  }

  return null;
}
