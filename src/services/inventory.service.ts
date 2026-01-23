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
}

export enum MovementStatus {
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  COMPLETED = 'COMPLETED',
  REVERSED = 'REVERSED',
}

export interface UnitConversion {
  fromUnit: string;
  toUnit: string;
  conversionFactor: number;
}

export interface IndustryFlags {
  isPerishable: boolean;
  requiresBatchTracking: boolean;
  requiresSerialTracking: boolean;
  hasExpiryDate: boolean;
  isHighValue: boolean;
  industryType: IndustryType;
}

export interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  description?: string;
  category?: string;
  unitOfMeasure: string;
  unitConversions: UnitConversion[];
  industryFlags: IndustryFlags;
  branchId: string;
  hasVariants: boolean; // Flag indicating if item has variants
  isActive: boolean;
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
}

export interface InventoryVariant {
  id: string;
  itemId: string;
  code: string;
  name: string;
  isDefault: boolean;
  barcode?: string;
  unitOfMeasureOverride?: string;
  metadata?: Record<string, any>;
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

export interface CreateVariantRequest {
  itemId: string;
  code: string;
  name: string;
  isDefault?: boolean;
  barcode?: string;
  unitOfMeasureOverride?: string;
  metadata?: Record<string, any>;
  // Image fields
  images?: Array<{
    url: string;
    publicId: string;
    isPrimary: boolean;
  }>;
}

export interface UpdateVariantRequest {
  code?: string;
  name?: string;
  isDefault?: boolean;
  barcode?: string;
  unitOfMeasureOverride?: string;
  metadata?: Record<string, any>;
  isActive?: boolean;
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

export interface CreateInventoryItemRequest {
  sku: string;
  name: string;
  description?: string;
  category?: string;
  barcode?: string;
  unitOfMeasure: string;
  unitConversions?: UnitConversion[];
  industryFlags: IndustryFlags;
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
  barcode?: string;
  unitOfMeasure?: string;
  unitConversions?: UnitConversion[];
  industryFlags?: Partial<IndustryFlags>;
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

class InventoryService {
  // Items
  async getAllItems(filters?: {
    isActive?: boolean;
    category?: string;
    search?: string;
  }): Promise<InventoryItem[]> {
    const params = new URLSearchParams();
    if (filters?.isActive !== undefined) {
      params.append('isActive', filters.isActive.toString());
    }
    if (filters?.category) {
      params.append('category', filters.category);
    }
    if (filters?.search) {
      params.append('search', filters.search);
    }
    const response = await api.get(`/inventory/items?${params.toString()}`);
    return extractApiData<InventoryItem[]>(response);
  }

  async getItemById(id: string): Promise<InventoryItem> {
    const response = await api.get(`/inventory/items/${id}`);
    return extractApiData<InventoryItem>(response);
  }

  async createItem(data: CreateInventoryItemRequest): Promise<InventoryItem> {
    const response = await api.post('/inventory/items', data);
    return extractApiData<InventoryItem>(response);
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
  }): Promise<Location[]> {
    const params = new URLSearchParams();
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

  // Movements
  async createMovement(data: CreateStockMovementRequest): Promise<StockMovementResponse> {
    const response = await api.post('/inventory/movements', data);
    return extractApiData<StockMovementResponse>(response);
  }

  async getAllMovements(filters?: {
    itemId?: string;
    fromLocationId?: string;
    toLocationId?: string;
    locationId?: string; // Matches either fromLocationId or toLocationId
    movementType?: MovementType;
    status?: MovementStatus;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<StockMovementResponse[]> {
    const params = new URLSearchParams();
    if (filters?.itemId) params.append('itemId', filters.itemId);
    if (filters?.fromLocationId) params.append('fromLocationId', filters.fromLocationId);
    if (filters?.toLocationId) params.append('toLocationId', filters.toLocationId);
    if (filters?.locationId) params.append('locationId', filters.locationId);
    if (filters?.movementType) params.append('movementType', filters.movementType);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    const response = await api.get(`/inventory/movements?${params.toString()}`);
    return extractApiData<StockMovementResponse[]>(response);
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
  }): Promise<MovementDocumentResponse[]> {
    const params = new URLSearchParams();
    if (filters?.movementType) params.append('movementType', filters.movementType);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.createdBy) params.append('createdBy', filters.createdBy);
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    if (filters?.myPendingApprovals) params.append('myPendingApprovals', 'true');
    const response = await api.get(`/inventory/movements/documents?${params.toString()}`);
    return extractApiData<MovementDocumentResponse[]>(response);
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

  // Reason Codes
  async getReasonCodes(): Promise<Array<{ code: string; name: string; category: string }>> {
    const response = await api.get('/inventory/reason-codes');
    return extractApiData<Array<{ code: string; name: string; category: string }>>(response);
  }

  async getReasonCodesByCategory(category: string): Promise<Array<{ code: string; name: string; category: string }>> {
    const response = await api.get(`/inventory/reason-codes/category/${category}`);
    return extractApiData<Array<{ code: string; name: string; category: string }>>(response);
  }

  async getReasonCodesForMovementType(movementType: string): Promise<{
    allowed: Array<{ code: string; name: string; category: string }>;
    defaultCode: string;
  }> {
    const response = await api.get(`/inventory/reason-codes/for-movement-type?movementType=${encodeURIComponent(movementType)}`);
    return extractApiData<{ allowed: Array<{ code: string; name: string; category: string }>; defaultCode: string }>(response);
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

  async getStockByLocation(locationId: string): Promise<StockByLocation[]> {
    const response = await api.get(`/inventory/stock/location/${locationId}`);
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

  async getSerialsByItem(itemId: string, locationId?: string, status?: string, variantId?: string): Promise<SerialResponse[]> {
    const params = new URLSearchParams();
    if (locationId) params.append('locationId', locationId);
    if (status) params.append('status', status);
    if (variantId) params.append('variantId', variantId);
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await api.get(`/inventory/serials/item/${itemId}${query}`);
    return extractApiData<SerialResponse[]>(response);
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
  async getExpiryAlerts(daysAhead?: number): Promise<ExpiryAlert[]> {
    const params = daysAhead ? `?daysAhead=${daysAhead}` : '';
    const response = await api.get(`/inventory/expiry/alerts${params}`);
    return extractApiData<ExpiryAlert[]>(response);
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
  }): Promise<CountDocumentSummary[]> {
    const params = new URLSearchParams();
    if (filters?.countType) params.append('countType', filters.countType);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.locationId) params.append('locationId', filters.locationId);
    if (filters?.itemId) params.append('itemId', filters.itemId);
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
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
        manufacturingDate?: string;
        expiryDate?: string;
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

  async createVariant(data: CreateVariantRequest): Promise<InventoryVariant> {
    const response = await api.post('/inventory/variants', data);
    return extractApiData<InventoryVariant>(response);
  }

  async updateVariant(id: string, data: UpdateVariantRequest): Promise<InventoryVariant> {
    const response = await api.put(`/inventory/variants/${id}`, data);
    return extractApiData<InventoryVariant>(response);
  }

  async deleteVariant(id: string): Promise<void> {
    await api.delete(`/inventory/variants/${id}`);
  }

  async getVariantStock(itemId: string): Promise<Array<{
    variantId: string;
    totalOnHand: number;
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
  item?: { id: string; sku: string; name: string; hasVariants?: boolean; requiresBatchTracking?: boolean; requiresSerialTracking?: boolean; isPerishable?: boolean };
  variant?: { id: string; code: string; name: string };
  systemQuantity: number;
  physicalQuantity: number;
  variance: number;
  varianceReason?: string;
  physicalEntered?: boolean;
  batchNumber?: string;
  serialNumbers?: string[];
  manufacturingDate?: string;
  expiryDate?: string;
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
  physicalQuantity: number;
  variance: number;
  createdBy: { id: string; name: string; email: string };
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
  unitOfMeasure: string;
  reasonCode: string;
  reasonDescription?: string;
  referenceNumber?: string;
  requiresApproval?: boolean;
  attachments?: Array<{ url: string; type: string; uploadedAt: string }>;
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
  unitOfMeasure: string;
  batchNumber?: string;
  serialNumbers?: string[];
  manufacturingDate?: string;
  expiryDate?: string;
  lineReasonCode?: string;
  lineStatus: string;
  reversedLineId?: string;
  createdAt: string;
  updatedAt: string;
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
