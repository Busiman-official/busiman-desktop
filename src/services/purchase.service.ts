import { api } from './api';
import { extractApiData } from '@/utils/api';

function branchParams(branchId?: string | null): Record<string, string> {
  return branchId ? { branchId } : {};
}

export type PurchaseOrderStatus = 'draft' | 'confirmed' | 'partial' | 'completed' | 'cancelled';

export type PurchaseOrderPriority = 'low' | 'normal' | 'urgent';

export interface PurchaseOrderSupplierContact {
  contactPerson?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  defaultPaymentTerms?: string;
  outstandingDues?: number;
}

export interface PurchaseOrderAttachment {
  fileName: string;
  mimeType?: string;
  size?: number;
}

export interface PurchaseOrderLine {
  id: string;
  variantId: string;
  itemId: string;
  variantCode: string;
  variantName: string;
  itemName: string;
  unitId?: string;
  expectedPrice?: number;
  taxPercent?: number;
  discountPercent?: number;
  quantityOrdered: number;
  quantityReceived: number;
  pendingQty: number;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  supplierContactSnapshot?: PurchaseOrderSupplierContact;
  status: PurchaseOrderStatus;
  orderDate: string;
  expectedDeliveryDate?: string;
  deliveryLocationId?: string;
  paymentTerms?: string;
  priority?: PurchaseOrderPriority;
  shippingFreight?: number;
  submittedToSupplier?: boolean;
  notes?: string;
  internalNotes?: string;
  supplierMessage?: string;
  attachments?: PurchaseOrderAttachment[];
  itemCount: number;
  totalOrderedQty: number;
  totalReceivedQty: number;
  totalPendingQty: number;
  lines: PurchaseOrderLine[];
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrderListResponse {
  rows: PurchaseOrder[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PurchaseOrderLineInput {
  variantId: string;
  quantityOrdered: number;
  unitId?: string;
  expectedPrice?: number;
  taxPercent?: number;
  discountPercent?: number;
}

export interface CreatePurchaseOrderRequest {
  supplierId: string;
  supplierName?: string;
  supplierContactSnapshot?: PurchaseOrderSupplierContact;
  orderDate?: string;
  expectedDeliveryDate?: string;
  deliveryLocationId?: string;
  paymentTerms?: string;
  priority?: PurchaseOrderPriority;
  shippingFreight?: number;
  notes?: string;
  internalNotes?: string;
  supplierMessage?: string;
  attachments?: PurchaseOrderAttachment[];
  lines: PurchaseOrderLineInput[];
  confirm?: boolean;
  submittedToSupplier?: boolean;
}

export interface UpdatePurchaseOrderRequest {
  supplierId?: string;
  supplierName?: string;
  supplierContactSnapshot?: PurchaseOrderSupplierContact;
  orderDate?: string;
  expectedDeliveryDate?: string;
  deliveryLocationId?: string | null;
  paymentTerms?: string;
  priority?: PurchaseOrderPriority;
  shippingFreight?: number;
  notes?: string;
  internalNotes?: string;
  supplierMessage?: string;
  attachments?: PurchaseOrderAttachment[];
  lines?: PurchaseOrderLineInput[];
}

export const purchaseService = {
  async getNextPoNumber(branchId?: string | null): Promise<{ poNumber: string }> {
    const response = await api.get('/purchases/orders/next-number', { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async createOrder(body: CreatePurchaseOrderRequest, branchId?: string | null): Promise<PurchaseOrder> {
    const response = await api.post('/purchases/orders', body, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async listOrders(
    params?: {
      page?: number;
      pageSize?: number;
      status?: PurchaseOrderStatus | '';
      supplierId?: string;
      dateFrom?: string;
      dateTo?: string;
      search?: string;
    },
    branchId?: string | null
  ): Promise<PurchaseOrderListResponse> {
    const response = await api.get('/purchases/orders', {
      params: {
        ...branchParams(branchId),
        ...(params || {}),
      },
    });
    return extractApiData(response);
  },

  async getOrder(orderId: string, branchId?: string | null): Promise<PurchaseOrder> {
    const response = await api.get(`/purchases/orders/${orderId}`, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async getOrderItems(orderId: string, branchId?: string | null): Promise<PurchaseOrderLine[]> {
    const response = await api.get(`/purchases/orders/${orderId}/items`, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async updateOrder(
    orderId: string,
    body: UpdatePurchaseOrderRequest,
    branchId?: string | null
  ): Promise<PurchaseOrder> {
    const response = await api.patch(`/purchases/orders/${orderId}`, body, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async confirmOrder(orderId: string, branchId?: string | null): Promise<PurchaseOrder> {
    const response = await api.post(`/purchases/orders/${orderId}/confirm`, {}, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async cancelOrder(orderId: string, branchId?: string | null): Promise<PurchaseOrder> {
    const response = await api.post(`/purchases/orders/${orderId}/cancel`, {}, { params: branchParams(branchId) });
    return extractApiData(response);
  },
};
