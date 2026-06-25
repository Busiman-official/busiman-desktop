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

export interface PurchaseOrderListStats {
  receivablePoCount: number;
  pendingUnits: number;
  pendingValue: number;
  overduePoCount: number;
  draftCount: number;
}

export interface PostPurchaseReceiptLineInput {
  variantId: string;
  itemId: string;
  quantity: number;
  unitOfMeasure?: string;
  toLocationId?: string;
  unitPrice?: number;
}

export interface PostPurchaseReceiptPaymentInput {
  methodCode: string;
  amount: number;
  details?: {
    cardHolderName?: string;
    last4?: string;
    transactionRef?: string;
    upiId?: string;
    transactionId?: string;
    bankName?: string;
    utr?: string;
    attachment?: { url: string; publicId: string; fileName?: string };
  };
}

export interface PostPurchaseReceiptRequest {
  locationId: string;
  receiptDate?: string;
  purchaseOrderId?: string;
  supplierId?: string;
  supplierName?: string;
  deliveryNoteNumber?: string;
  supplierInvoiceNumber?: string;
  shippingFreight?: number;
  subtotal?: number;
  totalAmount?: number;
  onCreditAmount?: number;
  payments?: PostPurchaseReceiptPaymentInput[];
  notes?: string;
  lines: PostPurchaseReceiptLineInput[];
}

export interface PurchaseBillSummary {
  id: string;
  billNumber: string;
  movementNumber?: string;
  receiptDate?: string;
  purchaseOrderId?: string;
  subtotal: number;
  shippingFreight: number;
  totalAmount: number;
  amountPaid: number;
  onCreditAmount: number;
  status: 'posted' | 'partially_paid' | 'paid';
}

export type PurchaseBillRow = PurchaseBillSummary;

export interface PurchaseBillDetail extends PurchaseBillSummary {
  supplierId: string;
  supplierName: string;
  supplierInvoiceNumber?: string;
  purchaseOrderId?: string;
  payments?: PostPurchaseReceiptPaymentInput[];
}

export type SupplierPayableStatus = 'pending' | 'clear' | 'po_only';

export type SupplierListSort = 'outstanding_desc' | 'name_asc' | 'last_receipt_desc';

export interface PurchaseSupplierSummary {
  supplierId: string;
  supplierName: string;
  outstanding: number;
  openBillCount: number;
  partiallyPaidBillCount: number;
  lastReceiptDate?: string;
  gstin?: string;
  payableStatus: SupplierPayableStatus;
}

export interface PurchaseSupplierListStats {
  totalOutstanding: number;
  suppliersWithPending: number;
  suppliersWithPartial: number;
  partiallyPaidBillCount: number;
}

export interface PurchaseSupplierOrderRow {
  id: string;
  poNumber: string;
  status: PurchaseOrderStatus;
  orderDate: string;
  expectedDeliveryDate?: string;
  totalPendingQty: number;
}

export interface PurchaseSupplierPaymentRow {
  billId: string;
  billNumber: string;
  methodCode: string;
  amount: number;
  paidAt?: string;
}

export interface PurchaseSupplierListResponse {
  rows: PurchaseSupplierSummary[];
  page: number;
  pageSize: number;
  total: number;
}

export type SupplierPaymentTerms =
  | 'due_on_receipt'
  | 'net_7'
  | 'net_15'
  | 'net_30'
  | 'net_45'
  | 'net_60'
  | 'advance';

export interface PurchaseSupplierMaster {
  id: string;
  supplierCode: string;
  name: string;
  contactPerson?: string;
  gstin?: string;
  phone?: string;
  email?: string;
  paymentTerms?: SupplierPaymentTerms;
  notes?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePurchaseSupplierMasterRequest {
  name: string;
  supplierCode?: string;
  contactPerson?: string;
  gstin?: string;
  phone?: string;
  email?: string;
  paymentTerms?: SupplierPaymentTerms;
  notes?: string;
}

export interface UpdatePurchaseSupplierMasterRequest {
  name?: string;
  contactPerson?: string;
  gstin?: string;
  phone?: string;
  email?: string;
  paymentTerms?: SupplierPaymentTerms;
  notes?: string;
  isActive?: boolean;
}

export interface SupplierMasterImportInput {
  id: string;
  name: string;
  gstin?: string;
  email?: string;
  phone?: string;
  contactPerson?: string;
  paymentTermsLabel?: string;
}

export interface SyncPurchaseSupplierMasterResponse {
  created: number;
  updated: number;
  total: number;
}

export interface PurchaseSupplierDetail extends PurchaseSupplierSummary {
  totalBilled: number;
  totalPoCount: number;
  openPoCount: number;
  bills: PurchaseBillRow[];
  master?: PurchaseSupplierMaster;
  purchaseOrders: PurchaseSupplierOrderRow[];
  payments: PurchaseSupplierPaymentRow[];
}

export interface RecordBillPaymentRequest {
  payments: PostPurchaseReceiptPaymentInput[];
  paymentDate?: string;
}

export interface PurchaseReceiptResult {
  movementDocumentId: string;
  movementNumber: string;
  purchaseOrder?: PurchaseOrder;
  bill?: PurchaseBillSummary;
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

// ---------------- Purchase returns (RTV) ----------------

export type PurchaseReturnStatus = 'draft' | 'completed' | 'cancelled';

export type PurchaseReturnSettlementType = 'credit' | 'refund' | 'replacement' | 'write_off';

export type PurchaseReturnLineReason =
  | 'damaged'
  | 'wrong_item'
  | 'quality_issue'
  | 'expired'
  | 'excess'
  | 'other';

export interface PurchaseReturnLine {
  variantId: string;
  itemId: string;
  variantName: string;
  itemName: string;
  quantity: number;
  unitOfMeasure?: string;
  unitPrice: number;
  lineTotal: number;
  fromLocationId: string;
  fromLocationName?: string;
  reason: PurchaseReturnLineReason;
  reasonNote?: string;
}

export interface PurchaseReturn {
  id: string;
  returnNumber: string;
  supplierId: string;
  supplierName: string;
  originalBillId: string;
  billNumber: string;
  purchaseOrderId?: string;
  status: PurchaseReturnStatus;
  settlementType: PurchaseReturnSettlementType;
  returnDate?: string;
  movementDocumentId?: string;
  movementNumber?: string;
  lines: PurchaseReturnLine[];
  totalQuantity: number;
  totalAmount: number;
  creditApplied: number;
  refundDue: number;
  refundReceived: number;
  supplierDebitNoteNumber?: string;
  replacementReceived?: boolean;
  rmaNumber?: string;
  notes?: string;
  cancelReason?: string;
  postedAt?: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseReturnListResponse {
  rows: PurchaseReturn[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PurchaseReturnStats {
  monthCount: number;
  monthValue: number;
  draftCount: number;
  creditPendingCount: number;
  creditPendingValue: number;
  refundDueValue: number;
  replacementPendingCount: number;
}

export interface PurchaseReturnLineInput {
  variantId: string;
  quantity: number;
  fromLocationId: string;
  reason: PurchaseReturnLineReason;
  reasonNote?: string;
}

export interface CreatePurchaseReturnRequest {
  billId: string;
  settlementType: PurchaseReturnSettlementType;
  returnDate?: string;
  rmaNumber?: string;
  notes?: string;
  lines: PurchaseReturnLineInput[];
  post?: boolean;
}

export interface UpdatePurchaseReturnSettlementRequest {
  supplierDebitNoteNumber?: string;
  refundReceivedAmount?: number;
  replacementReceived?: boolean;
}

export interface ReturnableStockByLocation {
  locationId: string;
  locationName: string;
  onHand: number;
}

export interface ReturnableBillLine {
  variantId: string;
  itemId: string;
  variantName: string;
  itemName: string;
  unitOfMeasure?: string;
  billedQty: number;
  alreadyReturnedQty: number;
  returnableQty: number;
  unitPrice: number;
  stockByLocation?: ReturnableStockByLocation[];
}

export interface ReturnableBill {
  billId: string;
  billNumber: string;
  supplierId: string;
  supplierName: string;
  receiptDate?: string;
  purchaseOrderId?: string;
  totalAmount: number;
  onCreditAmount: number;
  totalReturnableQty: number;
  lines: ReturnableBillLine[];
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
      statuses?: PurchaseOrderStatus[];
      overdueOnly?: boolean;
      supplierId?: string;
      dateFrom?: string;
      dateTo?: string;
      search?: string;
    },
    branchId?: string | null
  ): Promise<PurchaseOrderListResponse> {
    const { statuses, status, overdueOnly, ...rest } = params || {};
    const response = await api.get('/purchases/orders', {
      params: {
        ...branchParams(branchId),
        ...rest,
        ...(statuses?.length ? { statuses: statuses.join(',') } : {}),
        ...(status ? { status } : {}),
        ...(overdueOnly ? { overdueOnly: 'true' } : {}),
      },
    });
    return extractApiData(response);
  },

  async getOrderListStats(
    params?: {
      supplierId?: string;
      dateFrom?: string;
      dateTo?: string;
      search?: string;
    },
    branchId?: string | null
  ): Promise<PurchaseOrderListStats> {
    const response = await api.get('/purchases/orders/stats', {
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

  async postReceipt(body: PostPurchaseReceiptRequest, branchId?: string | null): Promise<PurchaseReceiptResult> {
    const response = await api.post('/purchases/receipts', body, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async saveReceiptDraft(body: PostPurchaseReceiptRequest, branchId?: string | null): Promise<PurchaseReceiptResult> {
    const response = await api.post('/purchases/receipts/draft', body, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async listSuppliers(
    params?: {
      page?: number;
      pageSize?: number;
      search?: string;
      pendingOnly?: boolean;
      partialOnly?: boolean;
      sort?: SupplierListSort;
    },
    branchId?: string | null
  ): Promise<PurchaseSupplierListResponse> {
    const { pendingOnly, partialOnly, sort, ...rest } = params || {};
    const response = await api.get('/purchases/suppliers', {
      params: {
        ...branchParams(branchId),
        ...rest,
        pendingOnly: pendingOnly ? 'true' : 'false',
        partialOnly: partialOnly ? 'true' : 'false',
        sort: sort || 'outstanding_desc',
      },
    });
    return extractApiData(response);
  },

  async getSupplierListStats(
    params?: { search?: string },
    branchId?: string | null
  ): Promise<PurchaseSupplierListStats> {
    const response = await api.get('/purchases/suppliers/stats', {
      params: { ...branchParams(branchId), ...(params || {}) },
    });
    return extractApiData(response);
  },

  async getSupplierDetail(supplierId: string, branchId?: string | null): Promise<PurchaseSupplierDetail> {
    const response = await api.get(`/purchases/suppliers/${encodeURIComponent(supplierId)}`, {
      params: branchParams(branchId),
    });
    return extractApiData(response);
  },

  async recordBillPayment(
    billId: string,
    body: RecordBillPaymentRequest,
    branchId?: string | null
  ): Promise<PurchaseBillDetail> {
    const response = await api.post(`/purchases/bills/${billId}/payments`, body, {
      params: branchParams(branchId),
    });
    return extractApiData(response);
  },

  async listSupplierMasterCatalog(
    params?: { search?: string },
    branchId?: string | null
  ): Promise<PurchaseSupplierMaster[]> {
    const response = await api.get('/purchases/suppliers/master/catalog', {
      params: { ...branchParams(branchId), ...(params || {}) },
    });
    return extractApiData(response);
  },

  async syncSupplierMaster(
    body: { imports?: SupplierMasterImportInput[] },
    branchId?: string | null
  ): Promise<SyncPurchaseSupplierMasterResponse> {
    const response = await api.post('/purchases/suppliers/master/sync', body, {
      params: branchParams(branchId),
    });
    return extractApiData(response);
  },

  async createSupplierMaster(
    body: CreatePurchaseSupplierMasterRequest,
    branchId?: string | null
  ): Promise<PurchaseSupplierMaster> {
    const response = await api.post('/purchases/suppliers/master', body, {
      params: branchParams(branchId),
    });
    return extractApiData(response);
  },

  async upsertSupplierMaster(
    body: CreatePurchaseSupplierMasterRequest,
    branchId?: string | null
  ): Promise<PurchaseSupplierMaster> {
    const response = await api.put('/purchases/suppliers/master', body, {
      params: branchParams(branchId),
    });
    return extractApiData(response);
  },

  async patchSupplierMaster(
    id: string,
    body: UpdatePurchaseSupplierMasterRequest,
    branchId?: string | null
  ): Promise<PurchaseSupplierMaster> {
    const response = await api.patch(`/purchases/suppliers/master/${id}`, body, {
      params: branchParams(branchId),
    });
    return extractApiData(response);
  },

  async listReturns(
    params?: {
      page?: number;
      pageSize?: number;
      supplierId?: string;
      status?: PurchaseReturnStatus | '';
      settlementType?: PurchaseReturnSettlementType | '';
      pendingSettlementOnly?: boolean;
      search?: string;
    },
    branchId?: string | null
  ): Promise<PurchaseReturnListResponse> {
    const { status, settlementType, pendingSettlementOnly, ...rest } = params || {};
    const response = await api.get('/purchases/returns', {
      params: {
        ...branchParams(branchId),
        ...rest,
        ...(status ? { status } : {}),
        ...(settlementType ? { settlementType } : {}),
        ...(pendingSettlementOnly ? { pendingSettlementOnly: 'true' } : {}),
      },
    });
    return extractApiData(response);
  },

  async getReturnStats(
    params?: { supplierId?: string },
    branchId?: string | null
  ): Promise<PurchaseReturnStats> {
    const response = await api.get('/purchases/returns/stats', {
      params: { ...branchParams(branchId), ...(params || {}) },
    });
    return extractApiData(response);
  },

  async getReturnSourceBills(
    params?: { supplierId?: string; search?: string; billId?: string },
    branchId?: string | null
  ): Promise<ReturnableBill[]> {
    const response = await api.get('/purchases/returns/source-bills', {
      params: { ...branchParams(branchId), ...(params || {}) },
    });
    return extractApiData(response);
  },

  async getReturn(returnId: string, branchId?: string | null): Promise<PurchaseReturn> {
    const response = await api.get(`/purchases/returns/${returnId}`, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async createReturn(body: CreatePurchaseReturnRequest, branchId?: string | null): Promise<PurchaseReturn> {
    const response = await api.post('/purchases/returns', body, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async postReturn(returnId: string, branchId?: string | null): Promise<PurchaseReturn> {
    const response = await api.post(`/purchases/returns/${returnId}/post`, {}, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async cancelReturn(returnId: string, reason?: string, branchId?: string | null): Promise<PurchaseReturn> {
    const response = await api.post(`/purchases/returns/${returnId}/cancel`, { reason }, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async updateReturnSettlement(
    returnId: string,
    body: UpdatePurchaseReturnSettlementRequest,
    branchId?: string | null
  ): Promise<PurchaseReturn> {
    const response = await api.patch(`/purchases/returns/${returnId}/settlement`, body, {
      params: branchParams(branchId),
    });
    return extractApiData(response);
  },
};
