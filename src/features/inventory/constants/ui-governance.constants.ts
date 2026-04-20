/**
 * Item Master UI Governance Constants
 * 
 * These constants enforce maximum limits for Item Master UI elements.
 * DO NOT MODIFY these values without product owner approval.
 * 
 * Reference: ITEM_MASTER_UI_GOVERNANCE.md
 */

/**
 * Maximum number of sub-tabs allowed in Item Master details view
 * FIXED LIMIT - Cannot be exceeded
 */
export const MAX_SUB_TABS = 3;

/**
 * Maximum number of wizard steps allowed in Add/Edit mode
 * FIXED LIMIT - Cannot be exceeded
 */
export const MAX_WIZARD_STEPS = 6;

/**
 * Maximum number of sub-views allowed per tab
 * FIXED LIMIT - Cannot be exceeded
 */
export const MAX_SUB_VIEWS_PER_TAB = 3;

/**
 * Valid sub-tab values for Item Master details view
 * DO NOT ADD MORE VALUES - This enforces the maximum limit
 * Note: 'locations' removed - locations content consolidated into History tab
 */
export type ItemSubTab = 'stock' | 'tracking' | 'history';

/** URL/state values for `itemSubTab` (legacy `overview` / `variants` / `edit` remapped in ItemMaster). */
export const ITEM_MASTER_SUB_TAB_VALUES: ItemSubTab[] = [
  'stock',
  'tracking',
  'history',
];

/**
 * Valid tracking sub-view values
 * DO NOT ADD MORE VALUES - This enforces the maximum limit
 */
export type TrackingSubView = 'batches' | 'serials' | 'expiry';

/**
 * Valid wizard step keys
 * DO NOT ADD MORE THAN MAX_WIZARD_STEPS values
 */
export const WIZARD_STEP_KEYS = [
  'basic',
  'images',
  'dimensions',
  'industry',
  'tags',
  'pricing',
  'unitsDimensions',
  'variants',
] as const;

export type WizardStepKey = typeof WIZARD_STEP_KEYS[number];

/**
 * Validation functions for UI governance
 */

/**
 * Validates wizard steps don't exceed maximum
 * @throws Error if limit exceeded
 */
export function validateWizardSteps(count: number): void {
  if (count > MAX_WIZARD_STEPS) {
    throw new Error(
      `UI Governance Violation: Cannot have more than ${MAX_WIZARD_STEPS} wizard steps. ` +
      `Current: ${count}. Add new fields to existing steps or use modals instead. ` +
      `See ITEM_MASTER_UI_GOVERNANCE.md for alternatives.`
    );
  }
}

/**
 * Validates sub-views don't exceed maximum per tab
 * @throws Error if limit exceeded
 */
export function validateSubViews(count: number, tabName: string): void {
  if (count > MAX_SUB_VIEWS_PER_TAB) {
    throw new Error(
      `UI Governance Violation: Cannot have more than ${MAX_SUB_VIEWS_PER_TAB} sub-views in ${tabName} tab. ` +
      `Current: ${count}. Use collapsible sections or modals instead. ` +
      `See ITEM_MASTER_UI_GOVERNANCE.md for alternatives.`
    );
  }
}

/**
 * Validates sub-tabs don't exceed maximum
 * @throws Error if limit exceeded
 */
export function validateSubTabs(count: number): void {
  if (count > MAX_SUB_TABS) {
    throw new Error(
      `UI Governance Violation: Cannot have more than ${MAX_SUB_TABS} sub-tabs in Item Master details view. ` +
      `Current: ${count}. This is a FIXED LIMIT. Use modals, collapsible sections, or separate modules instead. ` +
      `See ITEM_MASTER_UI_GOVERNANCE.md for alternatives.`
    );
  }
}
