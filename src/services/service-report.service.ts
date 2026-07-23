/**
 * Service Reports API Client (desktop)
 */

import { api } from './api';
import { extractApiData } from '@/utils/api';

export type ServiceReportSource = 'RECEPTION_CALL' | 'TECHNICIAN_DIRECT' | 'WALK_IN';
export type ServiceReportType = 'ON_SITE' | 'IN_OFFICE';
export type ServiceReportStatus =
  | 'CREATED'
  | 'ASSIGNED'
  | 'SCHEDULED'
  | 'MATERIAL_ISSUED'
  | 'IN_PROGRESS'
  | 'PENDING'
  | 'COMPLETED'
  | 'CLOSED'
  | 'CANCELLED';

export interface ServiceReportMaterialLine {
  itemId?: string;
  itemName: string;
  quantity: number;
  movementDocumentId?: string;
  fromLocationId?: string;
  custodianUserId?: string;
  kitLocationId?: string;
  consumedAt?: string;
  serialNumbers?: string[];
  variantId?: string;
}

export interface ServiceReport {
  id: string;
  reportNumber: string;
  source: ServiceReportSource;
  type: ServiceReportType;
  status: ServiceReportStatus;
  branchId: string;
  branchName?: string;
  customer: { name: string; phone?: string; address?: string };
  device?: { serialNumber?: string; description?: string };
  issueDescription: string;
  assignedTechnicianId?: string;
  assignedTechnicianName?: string;
  scheduledVisitDate?: string;
  rescheduleCount: number;
  materialsIssued: ServiceReportMaterialLine[];
  materialsUsed: ServiceReportMaterialLine[];
  materialsReturned: ServiceReportMaterialLine[];
  lastOutcome?: 'APPROVE' | 'PENDING' | 'CANCEL';
  consecutivePendingCount: number;
  reasonNote?: string;
  completionNotes?: string;
  selfReported: boolean;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceReportListResponse {
  reports: ServiceReport[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ServiceReportStatusHistoryEntry {
  id: string;
  fromStatus?: ServiceReportStatus;
  toStatus: ServiceReportStatus;
  changedByName?: string;
  note?: string;
  createdAt: string;
}

export interface ServiceReportListQuery {
  branchId?: string;
  status?: ServiceReportStatus;
  type?: ServiceReportType;
  technicianId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface ReasonCode {
  id: string;
  code: string;
  name: string;
}

class ServiceReportService {
  async list(query?: ServiceReportListQuery): Promise<ServiceReportListResponse> {
    return api.get('/service-reports', { params: query }).then(extractApiData<ServiceReportListResponse>);
  }

  async getById(id: string): Promise<ServiceReport> {
    return api.get(`/service-reports/${id}`).then(extractApiData<ServiceReport>);
  }

  async getHistory(id: string): Promise<ServiceReportStatusHistoryEntry[]> {
    return api.get(`/service-reports/${id}/history`).then(extractApiData<ServiceReportStatusHistoryEntry[]>);
  }

  async assign(id: string, technicianId: string, reason?: string): Promise<ServiceReport> {
    return api.post(`/service-reports/${id}/assign`, { technicianId, reason }).then(extractApiData<ServiceReport>);
  }

  async cancel(id: string, reasonCodeId: string, note?: string): Promise<ServiceReport> {
    return api.post(`/service-reports/${id}/cancel`, { reasonCodeId, note }).then(extractApiData<ServiceReport>);
  }

  async close(id: string, note?: string): Promise<ServiceReport> {
    return api.post(`/service-reports/${id}/close`, { note }).then(extractApiData<ServiceReport>);
  }

  async getServiceReasonCodes(): Promise<ReasonCode[]> {
    return api.get('/service-reports/reason-codes').then(extractApiData<ReasonCode[]>);
  }
}

export const serviceReportService = new ServiceReportService();
