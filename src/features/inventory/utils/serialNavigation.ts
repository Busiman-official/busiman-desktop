/**
 * Serial Navigation Utilities - Helpers for navigating to serials
 */

/**
 * Generate breadcrumb path for serial
 */
export function getSerialBreadcrumb(
  itemId?: string,
  itemName?: string,
  variantId?: string,
  variantName?: string,
  serialNumber?: string
): Array<{ label: string; path?: string }> {
  const breadcrumbs: Array<{ label: string; path?: string }> = [
    { label: 'Inventory', path: '/inventory' },
  ];
  
  if (itemId) {
    breadcrumbs.push({
      label: itemName || 'Item',
      path: `/inventory?tab=items&itemId=${itemId}`,
    });
  }
  
  if (itemId) {
    breadcrumbs.push({
      label: 'Serial Tracking',
      path: `/inventory?tab=items&itemId=${itemId}&itemSubTab=tracking`,
    });
  }
  
  if (serialNumber) {
    breadcrumbs.push({
      label: serialNumber,
    });
  }
  
  return breadcrumbs;
}

/**
 * Generate URL params for opening serial detail
 */
export function getSerialDetailUrl(
  serialNumber: string,
  itemId?: string,
  variantId?: string
): string {
  const params = new URLSearchParams();
  params.set('tab', 'items');
  if (itemId) params.set('itemId', itemId);
  if (variantId) params.set('variantId', variantId);
  params.set('serialNumber', serialNumber);
  params.set('itemSubTab', 'tracking');
  return `/inventory?${params.toString()}`;
}
