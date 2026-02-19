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
export const MAX_SUB_TABS = 6;

/**
 * Maximum number of wizard steps allowed in Add/Edit mode
 * FIXED LIMIT - Cannot be exceeded
 */
export const MAX_WIZARD_STEPS = 6;

/**
 * Maximum number of collapsible sections allowed in Overview tab
 * FIXED LIMIT - Cannot be exceeded
 */
export const MAX_COLLAPSIBLE_SECTIONS = 5;

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
export type ItemSubTab = 'overview' | 'edit' | 'variants' | 'stock' | 'tracking' | 'history';

/**
 * Valid tracking sub-view values
 * DO NOT ADD MORE VALUES - This enforces the maximum limit
 */
export type TrackingSubView = 'batches' | 'serials' | 'expiry';

/**
 * Valid overview collapsible section IDs
 * DO NOT ADD MORE THAN MAX_COLLAPSIBLE_SECTIONS values
 */
export const OVERVIEW_SECTION_IDS = [
  'basic-info',
  'industry-flags',
  'description', // Conditional - only if item has description
] as const;

export type OverviewSectionId = typeof OVERVIEW_SECTION_IDS[number];

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
 * Validates collapsible sections don't exceed maximum
 * @throws Error if limit exceeded
 */
export function validateCollapsibleSections(count: number): void {
  if (count > MAX_COLLAPSIBLE_SECTIONS) {
    throw new Error(
      `UI Governance Violation: Cannot have more than ${MAX_COLLAPSIBLE_SECTIONS} collapsible sections in Overview tab. ` +
      `Current: ${count}. Add to existing sections or use modals instead. ` +
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
