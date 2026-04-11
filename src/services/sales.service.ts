/**
 * Sales API client
 */

import { api } from './api';
import { extractApiData } from '@/utils/api';

function branchParams(branchId: string | null | undefined): Record<string, string> {
  return branchId ? { branchId } : {};
}

export interface SalesSettingsData {
  taxRatePercent: number;
  taxInclusive: boolean;
  allowNegativePos?: boolean;
  paymentMethods: Array<{ code: string; label: string; enabled: boolean; sortOrder: number }>;
}

export type CustomerSegment = 'regular' | 'vip' | 'corporate' | 'wholesale' | 'government';

export type CustomerPaymentTerms = 'immediate' | 'net15' | 'net30' | 'net45' | 'net60';

export type CustomerPreferredContact = 'whatsapp' | 'phone' | 'email';

export interface SalesCustomerTeamNote {
  _id: string;
  text: string;
  createdBy?: string | { _id?: string; name?: string };
  createdAt: string;
  updatedAt: string;
}

export interface SalesCustomer {
  _id: string;
  customerCode: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  segment: CustomerSegment;
  companyName?: string;
  gstNumber?: string;
  billingAddress?: string;
  shippingAddress?: string;
  stateUt?: string;
  paymentTerms?: CustomerPaymentTerms;
  assignedSalesRepId?: string;
  tags?: string[];
  notes?: string;
  teamNotes?: SalesCustomerTeamNote[];
  preferredContactMethod?: CustomerPreferredContact;
  defaultDiscountPercent?: number;
  creditLimit?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  totalSpent?: number;
  orderCount?: number;
  avgOrderValue?: number;
  lastOrderDate?: string | null;
}

export interface CustomerDetailPayload {
  profile: SalesCustomer;
  summary: {
    lifetimeValue: number;
    orderCount: number;
    outstandingAmount: number;
    overdueAmount: number;
    avgOrderValue: number;
    avgOrdersPerMonth: number;
    lastOrderDate: string | null;
    ltvTopPercentOfCustomers: number;
    aovVsPrevQuarterPct: number | null;
    returnRatePct: number;
    orderConsistencyPct: number;
    paymentReliabilityPct: number;
    totalRefundsIssued: number;
    totalCollected: number;
  };
  orders: Record<string, unknown>[];
  quotations: SalesQuotation[];
  returns: Record<string, unknown>[];
  topProducts: Array<{ variantKey: string; name: string; orderCount: number; revenue: number }>;
  monthlyOrderVolume: Array<{ month: string; label: string; count: number }>;
  paymentLedger: Array<{
    id: string;
    orderId?: string;
    amount: number;
    method: string;
    date: string;
    status: string;
    isRefund?: boolean;
  }>;
  repeatReturnVariantIds: string[];
  activity: Array<{ ts: string; type: string; title: string; actor: string; channel: string }>;
  auditLog: Array<{ ts: string; type: string; title: string; actor: string; channel: string }>;
}

export interface CustomerListResponse {
  rows: SalesCustomer[];
  page: number;
  pageSize: number;
  total: number;
  counts: { all: number; active: number; vip: number; inactive: number };
}

/** Response from POST /sales/pos/checkout */
export type PosCheckoutResult = {
  order: { _id: string; orderNumber: string; total?: number };
};

export type QuotationStatus =
  | 'draft'
  | 'sent'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'converted'
  | 'cancelled';

export interface SalesQuotationLine {
  variantId?: string;
  itemId?: string;
  variantCode: string;
  variantName: string;
  itemName?: string;
  quantity: number;
  unitPrice: number;
  discountAmount?: number;
  lineTotal: number;
  hsn?: string;
  /** Per-line GST % snapshot (quotation PDF / POS). */
  taxRatePercent?: number;
  /** Matches POS: true = tag price includes GST. Omitted on older quotations. */
  priceIncludesGst?: boolean;
  lineNotes?: string;
  unitOfMeasure?: string;
}

export interface SalesQuotation {
  _id: string;
  quoteNumber: string;
  sourceOrderId: string;
  customerId?: string;
  salesPointId: string;
  priceListId?: string;
  currency: string;
  status: QuotationStatus;
  validUntil?: string;
  lines: SalesQuotationLine[];
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  deliveryAmount?: number;
  total: number;
  notes?: string;
  terms?: string;
  convertedOrderId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface QuotationShareLinkData {
  url: string;
  expiresAt: string;
  provider: 's3' | 'cloudinary';
  note?: string;
}

export type QuotationLineOverride = {
  lineIndex: number;
  quantity?: number;
  unitPrice?: number;
  discountAmount?: number;
};

export type CreateQuotationFromOrderPayload = {
  validUntil?: string;
  deliveryAmount?: number;
  notes?: string;
  terms?: string;
  lineOverrides?: QuotationLineOverride[];
  downloadPdf?: boolean;
};

export const salesService = {
  async getSettings(branchId?: string | null): Promise<SalesSettingsData> {
    const response = await api.get('/sales/settings', { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async updateSettings(
    body: Partial<SalesSettingsData>,
    branchId?: string | null
  ): Promise<SalesSettingsData> {
    const response = await api.patch('/sales/settings', body, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async resolvePrice(
    variantId: string,
    opts?: { customerId?: string; salesPointId?: string; branchId?: string | null }
  ): Promise<{ price: number; currency: string; priceListId: string }> {
    const response = await api.get('/sales/pricing/resolve', {
      params: {
        variantId,
        ...opts?.customerId && { customerId: opts.customerId },
        ...opts?.salesPointId && { salesPointId: opts.salesPointId },
        ...branchParams(opts?.branchId),
      },
    });
    return extractApiData(response);
  },

  async listCustomers(
    branchId?: string | null,
    query?: {
      q?: string;
      status?: 'all' | 'active' | 'inactive';
      segment?: CustomerSegment | '';
      dateFrom?: string;
      dateTo?: string;
      minSpent?: number;
      maxSpent?: number;
      sortBy?: string;
      sortDir?: 'asc' | 'desc';
      page?: number;
      pageSize?: number;
    }
  ): Promise<CustomerListResponse> {
    const response = await api.get('/sales/customers', {
      params: { ...branchParams(branchId), ...(query || {}) },
    });
    return extractApiData(response);
  },

  async listSalesPoints(branchId?: string | null, opts?: { includeInactive?: boolean }) {
    const response = await api.get('/sales/sales-points', {
      params: {
        ...branchParams(branchId),
        ...(opts?.includeInactive ? { includeInactive: 'true' } : {}),
      },
    });
    return extractApiData(response);
  },

  async listPriceLists(branchId?: string | null) {
    const response = await api.get('/sales/price-lists', { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async listOrders(branchId?: string | null, status?: string) {
    const response = await api.get('/sales/orders', {
      params: { ...branchParams(branchId), ...(status ? { status } : {}) },
    });
    return extractApiData(response);
  },

  async listReturns(branchId?: string | null) {
    const response = await api.get('/sales/returns', { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async getReturn(returnId: string, branchId?: string | null) {
    const response = await api.get(`/sales/returns/${returnId}`, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async createSalesPoint(body: Record<string, unknown>, branchId?: string | null) {
    const response = await api.post('/sales/sales-points', body, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async updateSalesPoint(id: string, body: Record<string, unknown>, branchId?: string | null) {
    const response = await api.patch(`/sales/sales-points/${id}`, body, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async openSalesPointSession(id: string, branchId?: string | null) {
    const response = await api.post(
      `/sales/sales-points/${id}/session/open`,
      {},
      { params: branchParams(branchId) }
    );
    return extractApiData(response);
  },

  async closeSalesPointSession(id: string, branchId?: string | null) {
    const response = await api.post(
      `/sales/sales-points/${id}/session/close`,
      {},
      { params: branchParams(branchId) }
    );
    return extractApiData(response);
  },

  async createPriceList(
    body: { name: string; currency?: string; isDefault?: boolean },
    branchId?: string | null
  ) {
    const response = await api.post('/sales/price-lists', body, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async createCustomer(
    body: {
      name: string;
      email?: string;
      phone?: string;
      segment?: CustomerSegment;
      companyName?: string;
      gstNumber?: string;
      billingAddress?: string;
      shippingAddress?: string;
      stateUt?: string;
      paymentTerms?: CustomerPaymentTerms;
      assignedSalesRepId?: string;
      tags?: string[];
      notes?: string;
      isActive?: boolean;
      defaultPriceListId?: string;
    },
    branchId?: string | null
  ) {
    const response = await api.post('/sales/customers', body, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async getCustomer(id: string, branchId?: string | null): Promise<SalesCustomer> {
    const response = await api.get(`/sales/customers/${id}`, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async patchCustomer(
    id: string,
    body: Partial<{
      name: string;
      email?: string;
      phone?: string;
      segment?: CustomerSegment;
      companyName?: string;
      gstNumber?: string;
      billingAddress?: string;
      shippingAddress?: string;
      stateUt?: string;
      paymentTerms?: CustomerPaymentTerms;
      assignedSalesRepId?: string;
      tags?: string[];
      notes?: string;
      preferredContactMethod?: CustomerPreferredContact;
      defaultDiscountPercent?: number;
      creditLimit?: number;
      isActive?: boolean;
      defaultPriceListId?: string;
    }>,
    branchId?: string | null
  ): Promise<SalesCustomer> {
    const response = await api.patch(`/sales/customers/${id}`, body, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async deleteCustomer(id: string, branchId?: string | null): Promise<{ id: string; isActive: boolean }> {
    const response = await api.delete(`/sales/customers/${id}`, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async customerStats(branchId?: string | null): Promise<{
    totalCustomers: number;
    totalCustomersDeltaMonth: number;
    activeCustomers: number;
    activePercent: number;
    vipCustomers: number;
    vipAvgOrderValue: number;
    newCustomersThisMonth: number;
    newCustomersDeltaVsLastMonth: number;
  }> {
    const response = await api.get('/sales/customers/stats', { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async customerDetail(id: string, branchId?: string | null): Promise<CustomerDetailPayload> {
    const response = await api.get(`/sales/customers/${id}/detail`, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async addCustomerNote(customerId: string, text: string, branchId?: string | null): Promise<SalesCustomer> {
    const response = await api.post(`/sales/customers/${customerId}/notes`, { text }, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async updateCustomerNote(
    customerId: string,
    noteId: string,
    text: string,
    branchId?: string | null
  ): Promise<SalesCustomer> {
    const response = await api.patch(
      `/sales/customers/${customerId}/notes/${noteId}`,
      { text },
      { params: branchParams(branchId) }
    );
    return extractApiData(response);
  },

  async deleteCustomerNote(customerId: string, noteId: string, branchId?: string | null): Promise<SalesCustomer> {
    const response = await api.delete(`/sales/customers/${customerId}/notes/${noteId}`, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async exportCustomers(
    branchId?: string | null,
    query?: Record<string, unknown>
  ): Promise<Blob> {
    const response = await api.get('/sales/customers/export', {
      params: { ...branchParams(branchId), ...(query || {}) },
      responseType: 'blob',
    });
    return response.data as Blob;
  },

  async createOrder(
    body: {
      mode: 'pos' | 'b2b';
      salesPointId: string;
      customerId?: string;
      lines: Array<{
        variantId: string;
        quantity: number;
        unitPrice?: number;
        posListUnitPrice?: number;
        posLineDiscountAmount?: number;
        posGstRatePercent?: number;
        posLineNotes?: string;
        posHsn?: string;
        posGstInclusive?: boolean;
      }>;
      paymentMethodCode?: string;
      discountAmount?: number;
    },
    branchId?: string | null
  ) {
    const response = await api.post('/sales/orders', body, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  /** POS checkout: ISSUE stock from sales point location, payment, optional invoice. */
  async posCheckout(
    body: {
      salesPointId: string;
      customerId?: string;
      lines: Array<{
        variantId: string;
        quantity: number;
        unitPrice?: number;
        posListUnitPrice?: number;
        posLineDiscountAmount?: number;
        posGstRatePercent?: number;
        posLineNotes?: string;
        posHsn?: string;
        posGstInclusive?: boolean;
      }>;
      paymentMethodCode?: string;
      createInvoice?: boolean;
      discountAmount?: number;
      /** Defer payment: adds order total to customer outstanding (requires customerId). */
      holdPayment?: boolean;
    },
    branchId?: string | null
  ): Promise<PosCheckoutResult> {
    const response = await api.post('/sales/pos/checkout', body, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async getOrder(orderId: string, branchId?: string | null) {
    const response = await api.get(`/sales/orders/${orderId}`, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async confirmOrder(orderId: string, branchId?: string | null) {
    const response = await api.post(`/sales/orders/${orderId}/confirm`, {}, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async patchOrder(
    orderId: string,
    body: { status?: 'completed' | 'cancelled'; paymentPending?: boolean },
    branchId?: string | null
  ) {
    const response = await api.patch(`/sales/orders/${orderId}`, body, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async deleteDraftOrder(orderId: string, branchId?: string | null) {
    const response = await api.delete(`/sales/orders/${orderId}`, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async createReturn(
    body: {
      originalOrderId: string;
      notes?: string;
      lines: Array<{ orderLineIndex: number; quantity: number; toLocationId: string; reason?: string }>;
    },
    branchId?: string | null
  ) {
    const response = await api.post('/sales/returns', body, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async listHistory(branchId?: string | null, status?: string) {
    const response = await api.get('/sales/history', {
      params: { ...branchParams(branchId), ...(status ? { status } : {}) },
    });
    return extractApiData(response);
  },

  async upsertPriceListItem(
    priceListId: string,
    body: { variantId: string; price: number; minQty?: number },
    branchId?: string | null
  ) {
    const response = await api.put(`/sales/price-lists/${priceListId}/items`, body, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async listOrderQuotations(orderId: string, branchId?: string | null): Promise<SalesQuotation[]> {
    const response = await api.get(`/sales/orders/${orderId}/quotations`, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async createQuotationFromOrder(
    orderId: string,
    body: CreateQuotationFromOrderPayload,
    branchId?: string | null
  ): Promise<{ quotation: SalesQuotation; pdfWarning?: string }> {
    const response = await api.post(`/sales/quotations/from-order/${orderId}`, body, {
      params: branchParams(branchId),
    });
    return extractApiData(response);
  },

  async getQuotation(quotationId: string, branchId?: string | null): Promise<SalesQuotation> {
    const response = await api.get(`/sales/quotations/${quotationId}`, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async patchQuotation(
    quotationId: string,
    body: Partial<CreateQuotationFromOrderPayload>,
    branchId?: string | null
  ): Promise<SalesQuotation> {
    const response = await api.patch(`/sales/quotations/${quotationId}`, body, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async updateQuotationStatus(
    quotationId: string,
    status: 'sent' | 'accepted' | 'rejected' | 'cancelled' | 'draft',
    branchId?: string | null
  ): Promise<SalesQuotation> {
    const response = await api.post(
      `/sales/quotations/${quotationId}/status`,
      { status },
      { params: branchParams(branchId) }
    );
    return extractApiData(response);
  },

  async convertQuotation(
    quotationId: string,
    branchId?: string | null
  ): Promise<{ quotation: SalesQuotation; order: Record<string, unknown> }> {
    const response = await api.post(`/sales/quotations/${quotationId}/convert`, {}, { params: branchParams(branchId) });
    return extractApiData(response);
  },

  async getQuotationShareLink(
    quotationId: string,
    branchId?: string | null
  ): Promise<QuotationShareLinkData> {
    const response = await api.post(
      `/sales/quotations/${quotationId}/share-link`,
      {},
      { params: branchParams(branchId) }
    );
    return extractApiData(response);
  },

  async downloadQuotationPdfBlob(quotationId: string, branchId?: string | null): Promise<Blob> {
    const response = await api.get(`/sales/quotations/${quotationId}/pdf`, {
      params: branchParams(branchId),
      responseType: 'blob',
    });
    return response.data as Blob;
  },

  async previewQuotationPdfBlob(
    body: { orderId: string } & CreateQuotationFromOrderPayload,
    branchId?: string | null
  ): Promise<Blob> {
    const response = await api.post('/sales/quotations/preview-pdf', body, {
      params: branchParams(branchId),
      responseType: 'blob',
    });
    return response.data as Blob;
  },
};
