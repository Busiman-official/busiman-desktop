/**
 * Inventory Service - API calls for inventory management
 */

import { api } from './api';
import { extractApiData } from '@/utils/api';

export enum IndustryType {
  DAIRY = 'dairy',
  SWEETS = 'sweets',
  ELECTRONICS = 'electronics',
  FMCG = 'fmcg',
  PHARMA = 'pharma',
  MANUFACTURING = 'manufacturing',
  WAREHOUSE = 'warehouse',
}

export enum LocationType {
  WAREHOUSE = 'WAREHOUSE',
  ZONE = 'ZONE',
  RACK = 'RACK',
  BIN = 'BIN',
}

export enum ItemType {
  STOCK = 'STOCK',
  MISC_INVENTORY = 'MISC_INVENTORY',
  MISC_NON_STOCK = 'MISC_NON_STOCK',
}

export enum ProductType {
  STOCK_ITEM = 'STOCK_ITEM',
  NON_STOCK_ITEM = 'NON_STOCK_ITEM',
  ASSET = 'ASSET',
}

export enum MovementType {
  RECEIPT = 'RECEIPT',
  ISSUE = 'ISSUE',
  TRANSFER = 'TRANSFER',
  ADJUSTMENT = 'ADJUSTMENT',
  DAMAGE = 'DAMAGE',
  WASTE = 'WASTE',
  LOSS = 'LOSS',
  BLOCK = 'BLOCK',
  UNBLOCK = 'UNBLOCK',
  COUNT_ADJUSTMENT = 'COUNT_ADJUSTMENT',
  REVERSAL = 'REVERSAL',
  STOCK_MIGRATION = 'STOCK_MIGRATION',
}

export enum MovementStatus {
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  COMPLETED = 'COMPLETED',
  REVERSED = 'REVERSED',
}

export enum MovementExecutionMode {
  STOCK_LEDGER = 'STOCK_LEDGER',
  AUDIT_ONLY = 'AUDIT_ONLY',
}

export interface UnitConversion {
  fromUnit: string;
  toUnit: string;
  conversionFactor: number;
}

export interface AlternateUnitConfig {
  unitCode: string;
  factorToBase: number;
  isDefaultPurchase?: boolean;
  isDefaultSales?: boolean;
  isActive?: boolean;
}

export interface UnitConfig {
  baseUnit: string;
  alternateUnits: AlternateUnitConfig[];
  allowCustomUnits?: boolean;
}

export interface IndustryFlags {
  isPerishable: boolean;
  requiresBatchTracking: boolean;
  requiresSerialTracking: boolean;
  /** Only meaningful when requiresSerialTracking is true — serial can be attached later (at outbound), not required at receipt. */
  serialOptional: boolean;
  hasExpiryDate: boolean;
  isHighValue: boolean;
  industryType: IndustryType;
}

/** Product-level classification returned by API (master). */
export interface IndustryClassification {
  industryType: IndustryType;
  isHighValue: boolean;
}

export interface InventoryItem {
  id: string;
  /** @deprecated Use variant `sku` / `code`; optional after product/variant split. */
  sku?: string;
  name: string;
  description?: string;
  category?: string;
  productType?: ProductType;
  isMisc?: boolean;
  /** Whether this product can be booked for after-sales service/repair. */
  serviceable?: boolean;
  barcode?: string;
  unitOfMeasure?: string;
  unitConversions?: UnitConversion[];
  unitConfig?: UnitConfig;
  industryClassification?: IndustryClassification;
  /** Legacy full flags; prefer variant overrides for tracking. */
  industryFlags?: IndustryFlags;
  itemType: ItemType;
  branchId: string;
  hasVariants: boolean; // Flag indicating if item has variants
  isActive: boolean;
  costPrice?: number;
  sellingPrice?: number;
  margin?: number;
  // Image fields
  images?: Array<{
    url: string;
    publicId: string;
    isPrimary: boolean;
    uploadedAt: string;
  }>;
  // Dimensions and weight
  dimensions?: {
    length: number;
    width: number;
    height: number;
    unit: string;
  };
  weight?: {
    value: number;
    unit: string;
  };
  // Tags
  tags?: string[];
  createdBy: {
    id: string;
    name: string;
    email: string;
  };
  updatedBy: {
    id: string;
    name: string;
    email: string;
  };
  createdAt: string;
  updatedAt: string;
  /** Default variant SKU for list views (from API). */
  displaySku?: string;
  /** Any variant has batch/serial overrides (from API on list). */
  variantTracking?: { batch: boolean; serial: boolean };
}

export interface InventoryVariant {
  id: string;
  itemId: string;
  /** Canonical SKU (same as `code`). */
  sku: string;
  code: string;
  name: string;
  isDefault: boolean;
  barcode?: string;
  /** GST HSN (India): 4, 6, or 8 digits. */
  hsn?: string;
  unitOfMeasureOverride?: string;
  usesMasterUnitConfig?: boolean;
  unitConfigOverride?: UnitConfig;
  metadata?: Record<string, any>;
  costPriceOverride?: number;
  sellingPriceOverride?: number;
  mrpOverride?: number;
  taxOverride?: number;
  reorderLevel?: number;
  minStock?: number;
  maxStock?: number;
  allowBackorder?: boolean;
  trackSerialOverride?: boolean;
  trackBatchOverride?: boolean;
  serialOptionalOverride?: boolean;
  isDiscontinued?: boolean;
  /** Whether this specific variant can be booked for after-sales service/repair. */
  serviceable?: boolean;
  weightOverride?: number;
  dimensionsOverride?: {
    length?: number;
    width?: number;
    height?: number;
  };
  packSize?: number;
  unitsPerBox?: number;
  shelfLifeDaysOverride?: number;
  // Image fields
  images?: Array<{
    url: string;
    publicId: string;
    isPrimary: boolean;
    uploadedAt: string;
  }>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Create-variant API response; includes optional migration counts when first-variant migration ran. */
export type CreateVariantResponse = InventoryVariant & {
  migration?: { ledgerModified: number; serialModified: number };
};

export interface CreateVariantRequest {
  itemId: string;
  /** Variant SKU (required for new variants). */
  code: string;
  name: string;
  isDefault?: boolean;
  barcode?: string;
  hsn?: string;
  unitOfMeasureOverride?: string;
  usesMasterUnitConfig?: boolean;
  unitConfigOverride?: UnitConfig;
  metadata?: Record<string, any>;
  costPriceOverride?: number;
  sellingPriceOverride?: number;
  mrpOverride?: number;
  taxOverride?: number;
  reorderLevel?: number;
  minStock?: number;
  maxStock?: number;
  allowBackorder?: boolean;
  trackSerialOverride?: boolean;
  trackBatchOverride?: boolean;
  serialOptionalOverride?: boolean;
  isActive?: boolean;
  isDiscontinued?: boolean;
  /** Defaults to the master's `serviceable` value when omitted. */
  serviceable?: boolean;
  weightOverride?: number;
  dimensionsOverride?: {
    length?: number;
    width?: number;
    height?: number;
  };
  packSize?: number;
  unitsPerBox?: number;
  shelfLifeDaysOverride?: number;
  // Image fields
  images?: Array<{
    url: string;
    publicId: string;
    isPrimary: boolean;
  }>;
}

export interface UpdateVariantRequest {
  name?: string;
  isDefault?: boolean;
  barcode?: string;
  hsn?: string;
  unitOfMeasureOverride?: string;
  usesMasterUnitConfig?: boolean;
  unitConfigOverride?: UnitConfig;
  metadata?: Record<string, any>;
  costPriceOverride?: number;
  sellingPriceOverride?: number;
  mrpOverride?: number;
  taxOverride?: number;
  reorderLevel?: number;
  minStock?: number;
  maxStock?: number;
  allowBackorder?: boolean;
  trackSerialOverride?: boolean;
  trackBatchOverride?: boolean;
  serialOptionalOverride?: boolean;
  isActive?: boolean;
  isDiscontinued?: boolean;
  /** Defaults to the master's `serviceable` value when omitted. */
  serviceable?: boolean;
  weightOverride?: number;
  dimensionsOverride?: {
    length?: number;
    width?: number;
    height?: number;
  };
  packSize?: number;
  unitsPerBox?: number;
  shelfLifeDaysOverride?: number;
  // Image fields
  images?: Array<{
    url: string;
    publicId: string;
    isPrimary: boolean;
  }>;
}

export interface AttributeField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'date' | 'select';
  required: boolean;
  options?: string[];
  /** Pre-filled value for the first row of a serial-entry grid (subsequent rows carry-forward from the row above). For type 'select' must be one of `options`. */
  defaultValue?: string;
  /** Type 'date' only: server resolves defaultValue to the current date on every fetch instead of a fixed stored date. */
  defaultToday?: boolean;
}

export interface SerialAttributeTemplate {
  id: string;
  branchId?: string;
  itemId?: string;
  variantId?: string;
  fields: AttributeField[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogVariantRow {
  variantId: string;
  sku: string;
  variantName: string;
  productId: string;
  productName: string;
  category?: string;
  industryType?: IndustryType;
  productType?: ProductType;
  isMisc?: boolean;
  itemType?: ItemType;
  isActive: boolean;
  variantIsActive: boolean;
  isDefault: boolean;
  sellingPrice?: number;
  costPrice?: number;
  stockOnHand?: number;
  serviceable?: boolean;
}

export interface PaginatedCatalogResponse {
  rows: CatalogVariantRow[];
  total: number;
  page: number;
  limit: number;
}

export function catalogRows(
  data: CatalogVariantRow[] | PaginatedCatalogResponse
): CatalogVariantRow[] {
  return Array.isArray(data) ? data : data.rows;
}

export interface CreateInventoryVariantLine {
  sku: string;
  name: string;
  isDefault?: boolean;
  barcode?: string;
  hsn?: string;
  unitOfMeasure?: string;
  costPrice?: number;
  sellingPrice?: number;
  mrp?: number;
  tax?: number;
  reorderLevel?: number;
  minStock?: number;
  maxStock?: number;
  allowBackorder?: boolean;
  trackSerialOverride?: boolean;
  trackBatchOverride?: boolean;
  serialOptionalOverride?: boolean;
  /** Defaults to the master's `serviceable` value when omitted. */
  serviceable?: boolean;
  weightOverride?: number;
  dimensionsOverride?: {
    length?: number;
    width?: number;
    height?: number;
  };
  packSize?: number;
  unitsPerBox?: number;
  shelfLifeDaysOverride?: number;
  images?: Array<{
    url: string;
    publicId: string;
    isPrimary: boolean;
  }>;
}

export interface CreateInventoryItemRequest {
  name: string;
  /** At least one variant (branch-unique SKU each). */
  variants: CreateInventoryVariantLine[];
  description?: string;
  category?: string;
  productType?: ProductType;
  isMisc?: boolean;
  serviceable?: boolean;
  unitOfMeasure?: string;
  unitConversions?: UnitConversion[];
  unitConfig?: UnitConfig;
  industryFlags: IndustryFlags;
  itemType?: ItemType;
  // Image fields
  images?: Array<{
    url: string;
    publicId: string;
    isPrimary: boolean;
  }>;
  // Dimensions and weight
  dimensions?: {
    length: number;
    width: number;
    height: number;
    unit: string;
  };
  weight?: {
    value: number;
    unit: string;
  };
  // Tags
  tags?: string[];
}

export interface UpdateInventoryItemRequest {
  name?: string;
  description?: string;
  category?: string;
  productType?: ProductType;
  isMisc?: boolean;
  serviceable?: boolean;
  unitOfMeasure?: string;
  unitConversions?: UnitConversion[];
  unitConfig?: UnitConfig;
  industryFlags?: Partial<IndustryFlags>;
  itemType?: ItemType;
  isActive?: boolean;
  // Image fields
  images?: Array<{
    url: string;
    publicId: string;
    isPrimary: boolean;
  }>;
  // Dimensions and weight
  dimensions?: {
    length: number;
    width: number;
    height: number;
    unit: string;
  };
  weight?: {
    value: number;
    unit: string;
  };
  // Tags
  tags?: string[];
}

export interface Location {
  id: string;
  code: string;
  name: string;
  type: LocationType;
  branchId: string;
  parentLocationId?: string;
  level: number;
  isActive: boolean;
  address?: string;
  capacity?: {
    maxWeight?: number;
    maxVolume?: number;
    maxItems?: number;
  };
  temperatureZone?: string;
  notes?: string;
  allowStock?: boolean;
  allowPicking?: boolean;
  allowReceiving?: boolean;
  minTemp?: number;
  maxTemp?: number;
  parentLocation?: {
    id: string;
    code: string;
    name: string;
    type: LocationType;
  };
  createdBy: {
    id: string;
    name: string;
    email: string;
  };
  updatedBy: {
    id: string;
    name: string;
    email: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CreateLocationRequest {
  code: string;
  name: string;
  type: LocationType;
  parentLocationId?: string;
  address?: string;
  capacity?: {
    maxWeight?: number;
    maxVolume?: number;
    maxItems?: number;
  };
  temperatureZone?: string;
}

export interface UpdateLocationRequest {
  name?: string;
  address?: string;
  capacity?: {
    maxWeight?: number;
    maxVolume?: number;
    maxItems?: number;
  };
  temperatureZone?: string;
  notes?: string;
  allowStock?: boolean;
  allowPicking?: boolean;
  allowReceiving?: boolean;
  minTemp?: number;
  maxTemp?: number;
  isActive?: boolean;
}

export interface LocationHierarchyResponse extends Location {
  children?: LocationHierarchyResponse[];
}

export type ReasonCodeCategory =
  | 'MOVEMENT'
  | 'ADJUSTMENT'
  | 'DAMAGE'
  | 'WASTE'
  | 'LOSS'
  | 'BLOCK'
  | 'SERVICE';

export interface ReasonCodeResponse {
  id: string;
  code: string;
  name: string;
  category: ReasonCodeCategory;
  description?: string;
  requiresApproval: boolean;
  requiresAttachment: boolean;
  isActive: boolean;
  branchId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReasonCodeRequest {
  code: string;
  name: string;
  category: ReasonCodeCategory;
  description?: string;
  requiresApproval?: boolean;
  requiresAttachment?: boolean;
  branchId?: string;
}

export interface UpdateReasonCodeRequest {
  name?: string;
  category?: ReasonCodeCategory;
  description?: string;
  requiresApproval?: boolean;
  requiresAttachment?: boolean;
  isActive?: boolean;
}

class InventoryService {
  // Items
  async getItemsPage(filters: {
    page: number;
    limit: number;
    branchId?: string | null;
    isActive?: boolean;
    category?: string;
    search?: string;
    excludeNonStock?: boolean;
    itemType?: ItemType;
    sortBy?: 'name' | 'category' | 'unit' | 'industry' | 'createdAt';
    sortDir?: 'asc' | 'desc';
  }): Promise<{ items: InventoryItem[]; total: number; page: number; limit: number }> {
    const params = new URLSearchParams();
    params.append('page', String(filters.page));
    params.append('limit', String(filters.limit));
    if (filters.sortBy) params.append('sortBy', filters.sortBy);
    if (filters.sortDir) params.append('sortDir', filters.sortDir);
    if (filters.branchId) params.append('branchId', filters.branchId);
    if (filters.isActive !== undefined) params.append('isActive', filters.isActive.toString());
    if (filters.category) params.append('category', filters.category);
    if (filters.search) params.append('search', filters.search);
    if (filters.excludeNonStock !== undefined) {
      params.append('excludeNonStock', filters.excludeNonStock.toString());
    }
    if (filters.itemType) params.append('itemType', filters.itemType);
    const response = await api.get(`/inventory/items?${params.toString()}`);
    return extractApiData(response);
  }

  async getAllItems(filters?: {
    branchId?: string | null;
    isActive?: boolean;
    category?: string;
    search?: string;
    excludeNonStock?: boolean;
    itemType?: ItemType;
  }): Promise<InventoryItem[]> {
    const params = new URLSearchParams();
    if (filters?.branchId) {
      params.append('branchId', filters.branchId);
    }
    if (filters?.isActive !== undefined) {
      params.append('isActive', filters.isActive.toString());
    }
    if (filters?.category) {
      params.append('category', filters.category);
    }
    if (filters?.search) {
      params.append('search', filters.search);
    }
    if (filters?.excludeNonStock !== undefined) {
      params.append('excludeNonStock', filters.excludeNonStock.toString());
    }
    if (filters?.itemType) {
      params.append('itemType', filters.itemType);
    }
    const response = await api.get(`/inventory/items?${params.toString()}`);
    return extractApiData<InventoryItem[]>(response);
  }

  async getMiscItems(options?: { branchId?: string | null }): Promise<InventoryItem[]> {
    const response = await api.get('/inventory/items/misc', {
      params: options?.branchId ? { branchId: options.branchId } : {},
    });
    return extractApiData<InventoryItem[]>(response);
  }

  async getItemById(id: string): Promise<InventoryItem> {
    const response = await api.get(`/inventory/items/${id}`);
    return extractApiData<InventoryItem>(response);
  }

  /** Item-level or variant-level barcode; includes variantId when scan matched a variant. */
  async getItemByBarcode(barcode: string): Promise<InventoryItem & { variantId?: string }> {
    const response = await api.get('/inventory/items/by-barcode', {
      params: { barcode: barcode.trim() },
    });
    return extractApiData<InventoryItem & { variantId?: string }>(response);
  }

  async checkSkuAvailable(
    sku: string,
    options?: { signal?: AbortSignal }
  ): Promise<{ available: boolean }> {
    const response = await api.get('/inventory/items/check-sku', {
      params: { sku: sku.trim().toUpperCase() },
      signal: options?.signal,
    });
    return extractApiData<{ available: boolean }>(response);
  }

  /** Branch-unique PRD-… candidate; does not create an item. */
  async suggestItemSku(options?: { signal?: AbortSignal }): Promise<{ sku: string }> {
    const response = await api.get('/inventory/items/suggest-sku', {
      signal: options?.signal,
    });
    return extractApiData<{ sku: string }>(response);
  }

  /** Full variant code (e.g. BASE-SUFFIX) availability within branch. */
  async checkVariantCodeAvailable(
    code: string,
    options?: { excludeItemId?: string; signal?: AbortSignal }
  ): Promise<{ available: boolean }> {
    const response = await api.get('/inventory/variants/check-code', {
      params: {
        code: code.trim().toUpperCase(),
        ...(options?.excludeItemId ? { excludeItemId: options.excludeItemId } : {}),
      },
      signal: options?.signal,
    });
    return extractApiData<{ available: boolean }>(response);
  }

  async createItem(data: CreateInventoryItemRequest): Promise<InventoryItem> {
    const response = await api.post('/inventory/items', data);
    return extractApiData<InventoryItem>(response);
  }

  async getCatalog(params?: {
    search?: string;
    category?: string;
    isActive?: boolean;
    branchId?: string;
    excludeNonStock?: boolean;
    itemType?: ItemType;
    isMisc?: boolean;
    serviceable?: boolean;
    includeInactiveVariants?: boolean;
    page?: number;
    limit?: number;
    productLimit?: number;
  }): Promise<CatalogVariantRow[] | PaginatedCatalogResponse> {
    const q = new URLSearchParams();
    if (params?.search) q.append('search', params.search);
    if (params?.category) q.append('category', params.category);
    if (params?.isActive !== undefined) q.append('isActive', String(params.isActive));
    if (params?.branchId) q.append('branchId', params.branchId);
    if (params?.excludeNonStock) q.append('excludeNonStock', 'true');
    if (params?.itemType) q.append('itemType', params.itemType);
    if (params?.isMisc === true) q.append('isMisc', 'true');
    if (params?.isMisc === false) q.append('isMisc', 'false');
    if (params?.serviceable === true) q.append('serviceable', 'true');
    if (params?.serviceable === false) q.append('serviceable', 'false');
    if (params?.includeInactiveVariants) q.append('includeInactiveVariants', 'true');
    if (params?.page !== undefined) q.append('page', String(params.page));
    if (params?.limit !== undefined) q.append('limit', String(params.limit));
    if (params?.productLimit !== undefined) q.append('productLimit', String(params.productLimit));
    const response = await api.get(`/inventory/catalog?${q.toString()}`);
    return extractApiData<CatalogVariantRow[] | PaginatedCatalogResponse>(response);
  }

  async updateItem(id: string, data: UpdateInventoryItemRequest): Promise<InventoryItem> {
    const response = await api.put(`/inventory/items/${id}`, data);
    return extractApiData<InventoryItem>(response);
  }

  async deleteItem(id: string): Promise<void> {
    await api.delete(`/inventory/items/${id}`);
  }

  async getCategories(): Promise<string[]> {
    const response = await api.get('/inventory/categories');
    return extractApiData<string[]>(response);
  }

  // Locations
  async getAllLocations(filters?: {
    type?: LocationType;
    parentLocationId?: string | null;
    isActive?: boolean;
    /** When set (e.g. admin on Sales), limits locations to that branch */
    branchId?: string;
  }): Promise<Location[]> {
    const params = new URLSearchParams();
    if (filters?.branchId) {
      params.append('branchId', filters.branchId);
    }
    if (filters?.type) {
      params.append('type', filters.type);
    }
    if (filters?.parentLocationId !== undefined) {
      if (filters.parentLocationId === null) {
        params.append('parentLocationId', 'null');
      } else {
        params.append('parentLocationId', filters.parentLocationId);
      }
    }
    if (filters?.isActive !== undefined) {
      params.append('isActive', filters.isActive.toString());
    }
    const response = await api.get(`/inventory/locations?${params.toString()}`);
    return extractApiData<Location[]>(response);
  }

  async getLocationById(id: string): Promise<Location> {
    const response = await api.get(`/inventory/locations/${id}`);
    return extractApiData<Location>(response);
  }

  async getLocationHierarchy(warehouseId?: string): Promise<LocationHierarchyResponse[]> {
    const params = warehouseId ? `?warehouseId=${warehouseId}` : '';
    const response = await api.get(`/inventory/locations/hierarchy${params}`);
    return extractApiData<LocationHierarchyResponse[]>(response);
  }

  async getLocationPath(locationId: string): Promise<Location[]> {
    const response = await api.get(`/inventory/locations/${locationId}/path`);
    return extractApiData<Location[]>(response);
  }

  async getLocationChildCount(parentId: string): Promise<{ count: number }> {
    const params = new URLSearchParams();
    params.append('parentId', parentId);
    const response = await api.get(`/inventory/locations/child-count?${params.toString()}`);
    return extractApiData<{ count: number }>(response);
  }

  async getLocationCapacityUsage(locationId: string): Promise<{
    usedWeight: number;
    usedVolume: number;
    usedItems: number;
    maxWeight?: number;
    maxVolume?: number;
    maxItems?: number;
  }> {
    const response = await api.get(`/inventory/locations/${locationId}/capacity-usage`);
    return extractApiData<{
      usedWeight: number;
      usedVolume: number;
      usedItems: number;
      maxWeight?: number;
      maxVolume?: number;
      maxItems?: number;
    }>(response);
  }

  async createLocation(data: CreateLocationRequest): Promise<Location> {
    const response = await api.post('/inventory/locations', data);
    return extractApiData<Location>(response);
  }

  async updateLocation(id: string, data: UpdateLocationRequest): Promise<Location> {
    const response = await api.put(`/inventory/locations/${id}`, data);
    return extractApiData<Location>(response);
  }

  async deleteLocation(id: string): Promise<void> {
    await api.delete(`/inventory/locations/${id}`);
  }

  async deleteLocationPermanent(id: string): Promise<void> {
    await api.delete(`/inventory/locations/${id}/permanent`);
  }

  // Movements
  async createMovement(data: CreateStockMovementRequest): Promise<StockMovementResponse> {
    const response = await api.post('/inventory/movements', data);
    return extractApiData<StockMovementResponse>(response);
  }

  async getAllMovements(
    filters?: {
      itemId?: string;
      fromLocationId?: string;
      toLocationId?: string;
      locationId?: string;
      movementType?: MovementType;
      status?: MovementStatus;
      dateFrom?: string;
      dateTo?: string;
      page?: number;
      limit?: number;
    }
  ): Promise<PaginatedListResult<StockMovementResponse>> {
    const params = new URLSearchParams();
    if (filters?.itemId) params.append('itemId', filters.itemId);
    if (filters?.fromLocationId) params.append('fromLocationId', filters.fromLocationId);
    if (filters?.toLocationId) params.append('toLocationId', filters.toLocationId);
    if (filters?.locationId) params.append('locationId', filters.locationId);
    if (filters?.movementType) params.append('movementType', filters.movementType);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    params.set('page', String(filters?.page ?? 1));
    params.set('limit', String(filters?.limit ?? 50));
    const response = await api.get(`/inventory/movements?${params.toString()}`);
    const data = extractApiData<PaginatedListResult<StockMovementResponse> | StockMovementResponse[]>(response);
    if (Array.isArray(data)) {
      return { items: data, total: data.length, page: 1, limit: data.length };
    }
    return data;
  }

  async getMovementById(id: string): Promise<StockMovementResponse> {
    const response = await api.get(`/inventory/movements/${id}`);
    return extractApiData<StockMovementResponse>(response);
  }

  async approveMovement(id: string, approved: boolean, rejectionReason?: string): Promise<StockMovementResponse | MovementDocumentResponse> {
    const response = await api.post(`/inventory/movements/${id}/approve`, {
      approved,
      rejectionReason,
    });
    return extractApiData<StockMovementResponse | MovementDocumentResponse>(response);
  }

  async reverseMovement(id: string, reversalReason: string): Promise<StockMovementResponse> {
    const response = await api.post(`/inventory/movements/${id}/reverse`, {
      reversalReason,
    });
    return extractApiData<StockMovementResponse>(response);
  }

  // Movement Documents (Batch)
  async createMovementBatch(data: CreateMovementBatchRequest): Promise<MovementDocumentResponse> {
    const response = await api.post('/inventory/movements/batch', data);
    return extractApiData<MovementDocumentResponse>(response);
  }

  async getMovementDocument(id: string): Promise<MovementDocumentResponse> {
    const response = await api.get(`/inventory/movements/documents/${id}`);
    return extractApiData<MovementDocumentResponse>(response);
  }

  async getAllMovementDocuments(filters?: {
    movementType?: MovementType;
    status?: MovementStatus;
    createdBy?: string;
    dateFrom?: string;
    dateTo?: string;
    myPendingApprovals?: boolean;
    page?: number;
    limit?: number;
  }): Promise<PaginatedListResult<MovementDocumentResponse>> {
    const params = new URLSearchParams();
    if (filters?.movementType) params.append('movementType', filters.movementType);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.createdBy) params.append('createdBy', filters.createdBy);
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    if (filters?.myPendingApprovals) params.append('myPendingApprovals', 'true');
    params.set('page', String(filters?.page ?? 1));
    params.set('limit', String(filters?.limit ?? 50));
    const response = await api.get(`/inventory/movements/documents?${params.toString()}`);
    const data = extractApiData<PaginatedListResult<MovementDocumentResponse> | MovementDocumentResponse[]>(
      response
    );
    if (Array.isArray(data)) {
      return { items: data, total: data.length, page: 1, limit: data.length };
    }
    return data;
  }

  // Drafts
  async saveDraft(data: CreateMovementBatchRequest): Promise<MovementDocumentResponse> {
    const response = await api.post('/inventory/movements/draft', data);
    return extractApiData<MovementDocumentResponse>(response);
  }

  async updateDraft(id: string, data: Partial<CreateMovementBatchRequest>): Promise<MovementDocumentResponse> {
    const response = await api.put(`/inventory/movements/draft/${id}`, data);
    return extractApiData<MovementDocumentResponse>(response);
  }

  async submitDraft(id: string): Promise<MovementDocumentResponse> {
    const response = await api.post(`/inventory/movements/draft/${id}/submit`, {});
    return extractApiData<MovementDocumentResponse>(response);
  }

  async getDrafts(): Promise<MovementDocumentResponse[]> {
    const response = await api.get('/inventory/movements/drafts');
    return extractApiData<MovementDocumentResponse[]>(response);
  }

  /** Permanently delete a server-side movement draft (DRAFT only, own drafts). */
  async deleteMovementDraft(id: string): Promise<void> {
    await api.delete(`/inventory/movements/draft/${id}`);
  }

  // Reason Codes
  async getReasonCodes(): Promise<ReasonCodeResponse[]> {
    const response = await api.get('/inventory/reason-codes');
    return extractApiData<ReasonCodeResponse[]>(response);
  }

  async getReasonCodesByCategory(category: string): Promise<ReasonCodeResponse[]> {
    const response = await api.get(`/inventory/reason-codes/category/${category}`);
    return extractApiData<ReasonCodeResponse[]>(response);
  }

  async getReasonCodesForMovementType(movementType: string): Promise<{
    allowed: ReasonCodeResponse[];
    defaultCode: string;
  }> {
    const response = await api.get(`/inventory/reason-codes/for-movement-type?movementType=${encodeURIComponent(movementType)}`);
    return extractApiData<{ allowed: ReasonCodeResponse[]; defaultCode: string }>(response);
  }

  async getAllReasonCodesIncludingInactive(): Promise<ReasonCodeResponse[]> {
    const response = await api.get('/inventory/reason-codes/all');
    return extractApiData<ReasonCodeResponse[]>(response);
  }

  async getReasonCodeById(id: string): Promise<ReasonCodeResponse> {
    const response = await api.get(`/inventory/reason-codes/${id}`);
    return extractApiData<ReasonCodeResponse>(response);
  }

  async createReasonCode(body: CreateReasonCodeRequest): Promise<ReasonCodeResponse> {
    const response = await api.post('/inventory/reason-codes', body);
    return extractApiData<ReasonCodeResponse>(response);
  }

  async updateReasonCode(id: string, body: UpdateReasonCodeRequest): Promise<ReasonCodeResponse> {
    const response = await api.put(`/inventory/reason-codes/${id}`, body);
    return extractApiData<ReasonCodeResponse>(response);
  }

  async deactivateReasonCode(id: string): Promise<ReasonCodeResponse> {
    const response = await api.patch(`/inventory/reason-codes/${id}/deactivate`);
    return extractApiData<ReasonCodeResponse>(response);
  }

  async initializeReasonCodes(): Promise<void> {
    const response = await api.post('/inventory/reason-codes/initialize');
    extractApiData<unknown>(response);
  }

  // Stock
  async getStockBalance(itemId: string, locationId: string, batchNumber?: string, variantId?: string): Promise<StockBalance> {
    const params = new URLSearchParams();
    params.append('itemId', itemId);
    params.append('locationId', locationId);
    if (batchNumber) params.append('batchNumber', batchNumber);
    if (variantId) params.append('variantId', variantId);
    const response = await api.get(`/inventory/stock/balance?${params.toString()}`);
    return extractApiData<StockBalance>(response);
  }

  async getStockByLocation(
    locationId: string,
    options?: { includeDescendants?: boolean }
  ): Promise<StockByLocation[]> {
    const params = new URLSearchParams();
    if (options?.includeDescendants === true) {
      params.append('includeDescendants', 'true');
    }
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await api.get(`/inventory/stock/location/${locationId}${query}`);
    return extractApiData<StockByLocation[]>(response);
  }

  async getStockByItem(itemId: string): Promise<StockByItem[]> {
    const response = await api.get(`/inventory/stock/item/${itemId}`);
    return extractApiData<StockByItem[]>(response);
  }

  async getExpiringStock(daysAhead?: number): Promise<ExpiringStock[]> {
    const params = daysAhead ? `?daysAhead=${daysAhead}` : '';
    const response = await api.get(`/inventory/stock/expiring${params}`);
    return extractApiData<ExpiringStock[]>(response);
  }

  async getExpiredStock(): Promise<ExpiredStock[]> {
    const response = await api.get('/inventory/stock/expired');
    return extractApiData<ExpiredStock[]>(response);
  }

  // Batches
  async createBatch(data: CreateBatchRequest): Promise<BatchResponse> {
    const response = await api.post('/inventory/batches', data);
    return extractApiData<BatchResponse>(response);
  }

  async getBatchesByItem(itemId: string, locationId?: string): Promise<BatchResponse[]> {
    const params = locationId ? `?locationId=${locationId}` : '';
    const response = await api.get(`/inventory/batches/item/${itemId}${params}`);
    return extractApiData<BatchResponse[]>(response);
  }

  async getFEFOStock(itemId: string, locationId: string, quantity: number): Promise<FEFOAllocation[]> {
    const params = new URLSearchParams();
    params.append('itemId', itemId);
    params.append('locationId', locationId);
    params.append('quantity', quantity.toString());
    const response = await api.get(`/inventory/batches/fefo?${params.toString()}`);
    return extractApiData<FEFOAllocation[]>(response);
  }

  async getNearExpiryBatches(daysAhead?: number): Promise<BatchResponse[]> {
    const params = daysAhead ? `?daysAhead=${daysAhead}` : '';
    const response = await api.get(`/inventory/batches/near-expiry${params}`);
    return extractApiData<BatchResponse[]>(response);
  }

  async disposeBatch(batchNumber: string, itemId: string, reason: string): Promise<BatchResponse> {
    const response = await api.post(`/inventory/batches/${batchNumber}/dispose`, {
      itemId,
      reason,
    });
    return extractApiData<BatchResponse>(response);
  }

  // Serials
  async registerSerial(data: CreateSerialRequest): Promise<SerialResponse> {
    const response = await api.post('/inventory/serials', data);
    return extractApiData<SerialResponse>(response);
  }

  async getSerialByNumber(serialNumber: string): Promise<SerialResponse> {
    const response = await api.get(`/inventory/serials/${serialNumber}`);
    return extractApiData<SerialResponse>(response);
  }

  async getSerialsByItem(
    itemId: string,
    locationId?: string,
    status?: string,
    variantId?: string,
    page = 1,
    limit = 100
  ): Promise<SerialResponse[]> {
    const params = new URLSearchParams();
    if (locationId) params.append('locationId', locationId);
    if (status) params.append('status', status);
    if (variantId) params.append('variantId', variantId);
    params.set('page', String(page));
    params.set('limit', String(limit));
    const response = await api.get(`/inventory/serials/item/${itemId}?${params.toString()}`);
    const data = extractApiData<SerialResponse[] | PaginatedListResult<SerialResponse>>(response);
    if (Array.isArray(data)) return data;
    return data.items;
  }

  async updateSerialStatus(serialNumber: string, status: string): Promise<SerialResponse> {
    const response = await api.put(`/inventory/serials/${serialNumber}/status`, { status });
    return extractApiData<SerialResponse>(response);
  }

  async getSerialHistory(serialNumber: string): Promise<Array<{
    movementId: string;
    movementNumber: string;
    movementType: string;
    date: string;
    fromLocation?: { id: string; code: string; name: string };
    toLocation?: { id: string; code: string; name: string };
    quantity: number;
    status: string;
    user?: { id: string; name: string; email: string };
  }>> {
    const response = await api.get(`/inventory/serials/${serialNumber}/history`);
    return extractApiData(response);
  }

  async validateSerialsForMovement(params: {
    itemId: string;
    movementType: string;
    serialNumbers: string[];
    fromLocationId?: string;
    toLocationId?: string;
    variantId?: string;
  }): Promise<Array<{ serialNumber: string; status: string; message?: string; allowForMovementType: boolean }>> {
    const response = await api.post('/inventory/serials/validate-batch', params);
    return extractApiData(response);
  }

  // Expiry
  async getExpiryAlerts(daysAhead?: number, itemId?: string): Promise<ExpiryAlert[]> {
    const params = new URLSearchParams();
    if (daysAhead != null) params.set('daysAhead', String(daysAhead));
    if (itemId) params.set('itemId', itemId);
    params.set('limit', '200');
    const response = await api.get(`/inventory/expiry/alerts?${params.toString()}`);
    const data = extractApiData<ExpiryAlert[] | PaginatedListResult<ExpiryAlert>>(response);
    if (Array.isArray(data)) return data;
    return data.items;
  }

  async checkExpiryStatus(batchNumber: string, itemId: string): Promise<{ status: string }> {
    const response = await api.get(`/inventory/expiry/check/${batchNumber}?itemId=${itemId}`);
    return extractApiData<{ status: string }>(response);
  }

  async disposeExpiredStock(data: {
    itemId: string;
    locationId: string;
    batchNumber: string;
    reason: string;
  }): Promise<void> {
    await api.post('/inventory/expiry/dispose', data);
  }

  // Stock Counts (CountDocument + CountLine)
  async listCounts(filters?: {
    countType?: CountType | string;
    status?: CountStatus | string;
    locationId?: string;
    itemId?: string;
    dateFrom?: string;
    dateTo?: string;
    submittedByMe?: boolean;
    limit?: number;
  }): Promise<CountDocumentSummary[]> {
    const params = new URLSearchParams();
    if (filters?.countType) params.append('countType', filters.countType);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.locationId) params.append('locationId', filters.locationId);
    if (filters?.itemId) params.append('itemId', filters.itemId);
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    if (filters?.submittedByMe === true) params.append('submittedByMe', 'true');
    if (filters?.limit != null) params.append('limit', String(filters.limit));
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await api.get(`/inventory/counts${query}`);
    return extractApiData<CountDocumentSummary[]>(response);
  }

  async getCountDocument(id: string): Promise<CountDocumentResponse> {
    const response = await api.get(`/inventory/counts/${id}`);
    return extractApiData<CountDocumentResponse>(response);
  }

  async createCount(data: CreateCountRequest): Promise<CountDocumentResponse> {
    const response = await api.post('/inventory/counts', data);
    return extractApiData<CountDocumentResponse>(response);
  }

  async updateCountLines(
    id: string,
    body: {
      lines: Array<{
        lineNo: number;
        physicalQuantity?: number;
        varianceReason?: string;
        batchNumber?: string;
        serialNumbers?: string[];
        serialAttributes?: Record<string, Record<string, any>>;
        manufacturingDate?: string;
        expiryDate?: string;
        expectedVersion?: number;
      }>;
    }
  ): Promise<CountDocumentResponse> {
    const response = await api.put(`/inventory/counts/${id}/lines`, body);
    return extractApiData<CountDocumentResponse>(response);
  }

  async setCountRules(
    id: string,
    body: { freezeMovements?: boolean; blindCount?: boolean }
  ): Promise<CountDocumentResponse> {
    const response = await api.put(`/inventory/counts/${id}/rules`, body);
    return extractApiData<CountDocumentResponse>(response);
  }

  async submitCount(countId: string): Promise<CountDocumentResponse> {
    const response = await api.post(`/inventory/counts/${countId}/submit`, {});
    return extractApiData<CountDocumentResponse>(response);
  }

  async approveCount(countId: string): Promise<CountDocumentResponse> {
    const response = await api.post(`/inventory/counts/${countId}/approve`);
    return extractApiData<CountDocumentResponse>(response);
  }

  async rejectCount(countId: string, rejectionReason?: string): Promise<CountDocumentResponse> {
    const response = await api.post(`/inventory/counts/${countId}/reject`, {
      rejectionReason: rejectionReason ?? 'Rejected',
    });
    return extractApiData<CountDocumentResponse>(response);
  }

  async deleteCount(countId: string): Promise<void> {
    await api.delete(`/inventory/counts/${countId}`);
  }

  /** Legacy: backend returns 501. Prefer rejectCount then re-enter and submit. */
  async requestRecount(countId: string, reason: string): Promise<CountDocumentResponse> {
    const response = await api.post(`/inventory/counts/${countId}/recount`, { reason });
    return extractApiData<CountDocumentResponse>(response);
  }

  /** @deprecated Use listCounts with dateFrom/dateTo, locationId, itemId. */
  async getCountHistory(filters?: {
    locationId?: string;
    itemId?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<CountDocumentSummary[]> {
    const params = new URLSearchParams();
    if (filters?.locationId) params.append('locationId', filters.locationId);
    if (filters?.itemId) params.append('itemId', filters.itemId);
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await api.get(`/inventory/counts/history${query}`);
    return extractApiData<CountDocumentSummary[]>(response);
  }

  // Reports
  async getStockSummaryReport(): Promise<StockSummaryReport[]> {
    const response = await api.get('/inventory/reports/stock-summary');
    return extractApiData<StockSummaryReport[]>(response);
  }

  async getVariantStockReport(): Promise<VariantStockReport[]> {
    const response = await api.get('/inventory/reports/variant-stock');
    return extractApiData<VariantStockReport[]>(response);
  }

  async getLocationWiseStockReport(): Promise<LocationWiseStockReport[]> {
    const response = await api.get('/inventory/reports/location-wise');
    return extractApiData<LocationWiseStockReport[]>(response);
  }

  async getBatchExpiryRiskReport(daysAhead?: number): Promise<BatchExpiryRiskReport[]> {
    const params = daysAhead ? `?daysAhead=${daysAhead}` : '';
    const response = await api.get(`/inventory/reports/batch-expiry-risk${params}`);
    return extractApiData<BatchExpiryRiskReport[]>(response);
  }

  async getMovementAuditReport(dateFrom?: string, dateTo?: string): Promise<MovementAuditReport[]> {
    const params = new URLSearchParams();
    if (dateFrom) params.append('dateFrom', dateFrom);
    if (dateTo) params.append('dateTo', dateTo);
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await api.get(`/inventory/reports/movement-audit${query}`);
    return extractApiData<MovementAuditReport[]>(response);
  }

  async getDamageWasteAnalysisReport(dateFrom?: string, dateTo?: string): Promise<DamageWasteAnalysisReport[]> {
    const params = new URLSearchParams();
    if (dateFrom) params.append('dateFrom', dateFrom);
    if (dateTo) params.append('dateTo', dateTo);
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await api.get(`/inventory/reports/damage-waste${query}`);
    return extractApiData<DamageWasteAnalysisReport[]>(response);
  }

  async getStockReconciliationReport(): Promise<StockReconciliationReport[]> {
    const response = await api.get('/inventory/reports/reconciliation');
    return extractApiData<StockReconciliationReport[]>(response);
  }

  // Variants
  async getVariantsByItem(itemId: string, includeInactive = false): Promise<InventoryVariant[]> {
    const params = new URLSearchParams();
    if (includeInactive) {
      params.append('includeInactive', 'true');
    }
    const response = await api.get(`/inventory/items/${itemId}/variants?${params.toString()}`);
    return extractApiData<InventoryVariant[]>(response);
  }

  async getVariantById(id: string): Promise<InventoryVariant> {
    const response = await api.get(`/inventory/variants/${id}`);
    return extractApiData<InventoryVariant>(response);
  }

  async createVariant(data: CreateVariantRequest): Promise<CreateVariantResponse> {
    const response = await api.post('/inventory/variants', data);
    return extractApiData<CreateVariantResponse>(response);
  }

  async updateVariant(id: string, data: UpdateVariantRequest): Promise<InventoryVariant> {
    const response = await api.put(`/inventory/variants/${id}`, data);
    return extractApiData<InventoryVariant>(response);
  }

  async deleteVariant(id: string): Promise<void> {
    await api.delete(`/inventory/variants/${id}`);
  }

  async migrateProductLevelStockToDefaultVariant(itemId: string): Promise<{
    itemId: string;
    defaultVariantId: string;
    ledgerModified: number;
    serialModified: number;
  }> {
    const response = await api.post(
      `/inventory/items/${itemId}/migrate-product-level-stock-to-default-variant`,
    );
    return extractApiData(response);
  }

  async getItemsWithProductLevelRows(): Promise<Array<{ itemId: string }>> {
    const response = await api.get(
      "/inventory/admin/items-with-product-level-rows",
    );
    const data = extractApiData<{ items: Array<{ itemId: string }> }>(response);
    return data.items ?? [];
  }

  async getVariantStock(itemId: string): Promise<Array<{
    variantId: string;
    totalOnHand: number;
    isUnassigned?: boolean;
    locations: Array<{
      locationId: string;
      locationCode: string;
      locationName: string;
      quantity: number;
    }>;
  }>> {
    const response = await api.get(`/inventory/items/${itemId}/variant-stock`);
    return extractApiData(response);
  }

  // Serial Attributes
  async getSerialAttributeTemplate(itemId: string, variantId?: string): Promise<SerialAttributeTemplate | null> {
    const params = new URLSearchParams();
    params.append('itemId', itemId);
    if (variantId) {
      params.append('variantId', variantId);
    }
    const response = await api.get(`/inventory/serial-attributes/template?${params.toString()}`);
    return extractApiData<SerialAttributeTemplate | null>(response);
  }

  async saveSerialAttributeTemplate(data: {
    itemId?: string;
    variantId?: string;
    fields: AttributeField[];
  }): Promise<SerialAttributeTemplate> {
    const response = await api.post('/inventory/serial-attributes/template', data);
    return extractApiData<SerialAttributeTemplate>(response);
  }

  async updateSerialAttributes(serialNumber: string, attributes: Record<string, any>): Promise<any> {
    const response = await api.put(`/inventory/serials/${serialNumber}/attributes`, { attributes });
    return extractApiData(response);
  }

  async getAllSerialAttributeTemplates(): Promise<SerialAttributeTemplate[]> {
    const response = await api.get('/inventory/serial-attributes/templates');
    return extractApiData<SerialAttributeTemplate[]>(response);
  }

  async deleteSerialAttributeTemplate(id: string): Promise<void> {
    await api.delete(`/inventory/serial-attributes/templates/${id}`);
  }

  async bulkCreateVariants(variants: CreateVariantRequest[]): Promise<Array<{ success: boolean; data?: InventoryVariant; error?: string }>> {
    const response = await api.post('/inventory/bulk/variants', { variants });
    return extractApiData(response);
  }

  async bulkUpdateSerialAttributes(updates: Array<{ serialNumber: string; attributes: Record<string, any> }>): Promise<Array<{ success: boolean; data?: any; error?: string }>> {
    const response = await api.post('/inventory/bulk/serial-attributes', { updates });
    return extractApiData(response);
  }

  /**
   * Upload image to Cloudinary
   * @param file - File to upload
   * @param folder - Folder path in Cloudinary (default: 'inventory')
   * @returns Upload result with URL and public ID
   */
  async uploadImage(file: File, folder: string = 'inventory'): Promise<{ url: string; publicId: string; secureUrl: string }> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await api.post(`/inventory/upload-image?folder=${folder}`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    return extractApiData(response);
  }
}

export interface CreateBatchRequest {
  batchNumber: string;
  itemId: string;
  manufacturingDate: string;
  expiryDate?: string;
  manufacturingLocation?: string;
  supplierBatchNumber?: string;
  certificateOfAnalysis?: string;
}

export interface BatchResponse {
  id: string;
  batchNumber: string;
  itemId: string;
  item?: {
    id: string;
    sku: string;
    name: string;
  };
  manufacturingDate: string;
  expiryDate?: string;
  manufacturingLocation?: string;
  supplierBatchNumber?: string;
  certificateOfAnalysis?: string;
  totalQuantity: number;
  isExpired: boolean;
  expiryStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface FEFOAllocation {
  batchNumber: string;
  quantity: number;
  expiryDate?: string;
}

export interface CreateSerialRequest {
  serialNumber: string;
  itemId: string;
  batchNumber?: string;
  currentLocationId: string;
  manufacturingDate?: string;
  expiryDate?: string;
  warrantyExpiryDate?: string;
}

export interface SerialResponse {
  id: string;
  serialNumber: string;
  itemId: string;
  variantId?: string;
  variant?: {
    id: string;
    code: string;
    name: string;
  };
  item?: {
    id: string;
    sku: string;
    name: string;
  };
  batchNumber?: string;
  currentLocationId: string;
  currentLocation?: {
    id: string;
    code: string;
    name: string;
  };
  currentStatus: string;
  attributes?: Record<string, any>;
  manufacturingDate?: string;
  expiryDate?: string;
  warrantyExpiryDate?: string;
  firstReceivedDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExpiryAlert {
  itemId: string;
  item: {
    id: string;
    sku: string;
    name: string;
  };
  locationId: string;
  location: {
    id: string;
    code: string;
    name: string;
  };
  batchNumber?: string;
  quantity: number;
  expiryDate: string;
  daysUntilExpiry: number;
  expiryStatus: string;
}

// Count document (multi-line) types – CountDocument + CountLine
export enum CountType {
  CYCLE_COUNT = 'CYCLE_COUNT',
  FULL_COUNT = 'FULL_COUNT',
  SPOT_CHECK = 'SPOT_CHECK',
}

export enum CountStatus {
  DRAFT = 'DRAFT',
  IN_PROGRESS = 'IN_PROGRESS',
  SUBMITTED = 'SUBMITTED',
  COMPLETED = 'COMPLETED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export interface CreateCountRequest {
  countType: CountType | 'CYCLE_COUNT' | 'FULL_COUNT' | 'SPOT_CHECK';
  locationId: string;
  itemIds?: string[];
  freezeMovements?: boolean;
  blindCount?: boolean;
}

export interface CountLineDto {
  id: string;
  lineNo: number;
  itemId: string;
  variantId?: string;
  item?: { id: string; sku: string; name: string; hasVariants?: boolean; requiresBatchTracking?: boolean; requiresSerialTracking?: boolean; serialOptional?: boolean; isPerishable?: boolean };
  variant?: { id: string; code: string; name: string };
  systemQuantity: number;
  /** Current on-hand at count location (for display: current − system) */
  currentStock?: number;
  physicalQuantity: number;
  variance: number;
  varianceReason?: string;
  physicalEntered?: boolean;
  batchNumber?: string;
  serialNumbers?: string[];
  serialAttributes?: Record<string, Record<string, any>>;
  manufacturingDate?: string;
  expiryDate?: string;
  lineVersion?: number;
}

export interface CountDocumentResponse {
  id: string;
  countNumber: string;
  countType: CountType | string;
  locationId: string;
  location?: { id: string; code: string; name: string };
  status: CountStatus | string;
  freezeMovements: boolean;
  blindCount: boolean;
  createdBy: { id: string; name: string; email: string };
  submittedAt?: string;
  submittedBy?: { id: string; name: string; email: string };
  approvedBy?: { id: string; name: string; email: string };
  approvedAt?: string;
  rejectedBy?: { id: string; name: string; email: string };
  rejectedAt?: string;
  rejectionReason?: string;
  adjustmentMovementDocumentId?: string;
  lines: CountLineDto[];
  createdAt: string;
  updatedAt: string;
}

export interface CountDocumentSummary {
  id: string;
  countNumber: string;
  countType: CountType | string;
  locationId: string;
  location?: { id: string; code: string; name: string };
  status: CountStatus | string;
  itemSummary: string;
  systemQuantity: number;
  /** Current on-hand total for all lines (for display: current − system) */
  currentStockTotal?: number;
  physicalQuantity: number;
  variance: number;
  createdBy: { id: string; name: string; email: string };
  submittedBy?: { id: string; name: string; email: string };
  submittedAt?: string;
  createdAt: string;
  approvedBy?: { id: string; name: string; email: string };
  approvedAt?: string;
  rejectedBy?: { id: string; name: string; email: string };
  rejectedAt?: string;
}

export interface CreateStockCountRequest {
  countType: 'CYCLE_COUNT' | 'FULL_COUNT' | 'SPOT_CHECK';
  locationId?: string;
  itemId?: string;
}

export interface StockCountResponse {
  id: string;
  countNumber: string;
  countType: string;
  locationId?: string;
  location?: {
    id: string;
    code: string;
    name: string;
  };
  itemId?: string;
  item?: {
    id: string;
    sku: string;
    name: string;
  };
  countedBy: {
    id: string;
    name: string;
    email: string;
  };
  countedAt: string;
  systemQuantity: number;
  physicalQuantity: number;
  variance: number;
  varianceReason?: string;
  status: string;
  approvedBy?: {
    id: string;
    name: string;
    email: string;
  };
  approvedAt?: string;
  adjustmentMovementId?: string;
  recountRequested: boolean;
  attachments: Array<{ url: string; type: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface StockSummaryReport {
  itemId: string;
  item: {
    id: string;
    sku: string;
    name: string;
  };
  totalOnHand: number;
  totalReserved: number;
  totalBlocked: number;
  totalDamaged: number;
  totalAvailable: number;
  locations: Array<{
    locationId: string;
    location: {
      id: string;
      code: string;
      name: string;
    };
    quantity: number;
  }>;
}

export interface LocationWiseStockReport {
  locationId: string;
  location: {
    id: string;
    code: string;
    name: string;
    type: string;
  };
  totalItems: number;
  totalQuantity: number;
  totalValue?: number;
  items: Array<{
    itemId: string;
    item: {
      id: string;
      sku: string;
      name: string;
    };
    quantity: number;
    batchNumber?: string;
  }>;
}

export interface VariantStockReport {
  itemId: string;
  item: {
    id: string;
    sku: string;
    name: string;
  };
  variantId: string;
  variant: {
    id: string;
    code: string;
    name: string;
  };
  totalOnHand: number;
  totalReserved: number;
  totalBlocked: number;
  totalDamaged: number;
  totalAvailable: number;
  locations: Array<{
    locationId: string;
    location: {
      id: string;
      code: string;
      name: string;
    };
    quantity: number;
  }>;
}

export interface BatchExpiryRiskReport {
  batchNumber: string;
  itemId: string;
  item: {
    id: string;
    sku: string;
    name: string;
  };
  expiryDate: string;
  daysUntilExpiry: number;
  totalQuantity: number;
  locations: Array<{
    locationId: string;
    location: {
      id: string;
      code: string;
      name: string;
    };
    quantity: number;
  }>;
}

export interface MovementAuditReport {
  movementId: string;
  movementNumber: string;
  movementType: MovementType;
  itemId: string;
  item: {
    id: string;
    sku: string;
    name: string;
  };
  fromLocation?: string;
  toLocation?: string;
  quantity: number;
  reasonCode: string;
  createdBy: string;
  createdAt: string;
  postingDate?: string;
}

export interface DamageWasteAnalysisReport {
  itemId: string;
  item: {
    id: string;
    sku: string;
    name: string;
  };
  totalDamage: number;
  totalWaste: number;
  totalLoss: number;
  movements: Array<{
    movementNumber: string;
    movementType: MovementType;
    quantity: number;
    reasonCode: string;
    createdAt: string;
  }>;
}

export interface StockReconciliationReport {
  locationId: string;
  location: {
    id: string;
    code: string;
    name: string;
  };
  itemId: string;
  item: {
    id: string;
    sku: string;
    name: string;
  };
  systemQuantity: number;
  physicalQuantity: number;
  variance: number;
  lastCountDate?: string;
  countNumber?: string;
}

export interface CreateStockMovementRequest {
  movementType: MovementType;
  itemId: string;
  variantId?: string; // Variant ID for variant-based items
  fromLocationId?: string;
  toLocationId?: string;
  batchNumber?: string;
  serialNumber?: string; // Deprecated: kept for backward compatibility
  serialNumbers?: string[]; // Array of serial numbers (one per unit)
  serialAttributes?: Record<string, Record<string, any>>; // Map of serialNumber -> attributes object
  manufacturingDate?: string;
  expiryDate?: string;
  quantity: number;
  enteredQuantity?: number;
  enteredUnitOfMeasure?: string;
  baseQuantity?: number;
  baseUnitOfMeasure?: string;
  unitOfMeasure: string;
  reasonCode: string;
  reasonDescription?: string;
  referenceNumber?: string;
  requiresApproval?: boolean;
  attachments?: Array<{ url: string; type: string; uploadedAt: string }>;
  /** Business posting date (optional; POS sets from invoice date). */
  postingDate?: string;
}

export interface MovementLineRequest {
  itemId: string;
  variantId?: string;
  fromLocationId?: string;
  toLocationId?: string;
  quantity: number;
  unitOfMeasure?: string;
  batchNumber?: string;
  serialNumbers?: string[];
  manufacturingDate?: string;
  expiryDate?: string;
  lineReasonCode?: string;
  serialAttributes?: Record<string, Record<string, any>>;
}

export interface CreateMovementBatchRequest {
  movementType: MovementType;
  defaultFromLocationId?: string;
  defaultToLocationId?: string;
  reasonCode: string;
  reasonDescription?: string;
  documentNotes?: string;
  requiresApproval?: boolean;
  /** When true, allows transfer from an inactive location (e.g. shift stock before permanent delete). */
  allowInactiveFromLocation?: boolean;
  lines: MovementLineRequest[];
}

export interface MovementLineResponse {
  id: string;
  documentId: string;
  lineNo: number;
  itemId: string;
  variantId?: string;
  variant?: { id: string; code: string; name: string };
  item?: { id: string; sku: string; name: string };
  fromLocationId?: string;
  fromLocation?: { id: string; code: string; name: string };
  toLocationId?: string;
  toLocation?: { id: string; code: string; name: string };
  quantity: number;
  enteredQuantity?: number;
  enteredUnitOfMeasure?: string;
  baseQuantity?: number;
  baseUnitOfMeasure?: string;
  unitOfMeasure: string;
  batchNumber?: string;
  serialNumbers?: string[];
  manufacturingDate?: string;
  expiryDate?: string;
  lineReasonCode?: string;
  lineStatus: string;
  reversedLineId?: string;
  executionMode?: MovementExecutionMode;
  nonStockReason?: 'ITEM_NOT_STOCK_MANAGED';
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedListResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface MovementDocumentResponse {
  id: string;
  movementNumber: string;
  movementType: MovementType;
  status: MovementStatus;
  defaultFromLocationId?: string;
  defaultFromLocation?: { id: string; code: string; name: string };
  defaultToLocationId?: string;
  defaultToLocation?: { id: string; code: string; name: string };
  reasonCode: string;
  reasonDescription?: string;
  documentNotes?: string;
  requiresApproval: boolean;
  approvedBy?: string;
  approvedAt?: string;
  createdBy: { id: string; name: string; email: string };
  lines: MovementLineResponse[];
  totalLines: number;
  totalQuantity: number;
  previewVariant?: { id: string; code: string; name: string };
  multipleVariants?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StockMovementResponse {
  id: string;
  movementNumber: string;
  movementType: MovementType;
  itemId: string;
  item?: {
    id: string;
    sku: string;
    name: string;
  };
  fromLocationId?: string;
  fromLocation?: {
    id: string;
    code: string;
    name: string;
  };
  toLocationId?: string;
  toLocation?: {
    id: string;
    code: string;
    name: string;
  };
  variantId?: string; // Variant ID for variant-based items
  variant?: {
    id: string;
    code: string;
    name: string;
  };
  batchNumber?: string;
  serialNumber?: string; // Deprecated: kept for backward compatibility
  serialNumbers?: string[]; // Array of serial numbers
  serialAttributes?: Record<string, Record<string, any>>; // Map of serialNumber -> attributes object
  manufacturingDate?: string;
  expiryDate?: string;
  quantity: number;
  unitOfMeasure: string;
  reasonCode: string;
  reasonDescription?: string;
  referenceNumber?: string;
  approvedBy?: string;
  approvedAt?: string;
  requiresApproval: boolean;
  status: MovementStatus;
  reversedMovementId?: string;
  reversalReason?: string;
  attachments: Array<{ url: string; type: string; uploadedAt: string }>;
  executionMode: MovementExecutionMode;
  nonStockReason?: 'ITEM_NOT_STOCK_MANAGED';
  /** Business transaction date when set (else use createdAt for display). */
  postingDate?: string;
  createdBy: {
    id: string;
    name: string;
    email: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface StockBalance {
  onHand: number;
  reserved: number;
  blocked: number;
  damaged: number;
  available: number;
}

export interface StockByLocation {
  itemId: string;
  item: {
    id: string;
    sku: string;
    name: string;
  };
  variantId?: string;
  variant?: {
    id: string;
    code: string;
    name: string;
  };
  batchNumber?: string;
  serialNumber?: string;
  onHandQuantity: number;
  reservedQuantity: number;
  blockedQuantity: number;
  damagedQuantity: number;
  availableQuantity: number;
  expiryDate?: string;
  /** Present when requested with includeDescendants */
  locationId?: string;
  location?: {
    id: string;
    code: string;
    name: string;
    type?: string;
  };
}

export interface StockByItem {
  locationId: string;
  location: {
    id: string;
    code: string;
    name: string;
    type: string;
  };
  variantId?: string;
  batchNumber?: string;
  serialNumber?: string;
  onHandQuantity: number;
  reservedQuantity: number;
  blockedQuantity: number;
  damagedQuantity: number;
  availableQuantity: number;
  expiryDate?: string;
}

export interface ExpiringStock {
  itemId: string;
  item: {
    id: string;
    sku: string;
    name: string;
  };
  locationId: string;
  location: {
    id: string;
    code: string;
    name: string;
  };
  batchNumber?: string;
  quantity: number;
  expiryDate: string;
  daysUntilExpiry: number;
  expiryStatus: string;
}

export interface ExpiredStock {
  itemId: string;
  item: {
    id: string;
    sku: string;
    name: string;
  };
  locationId: string;
  location: {
    id: string;
    code: string;
    name: string;
  };
  batchNumber?: string;
  quantity: number;
  expiryDate: string;
}

export const inventoryService = new InventoryService();
