/**
 * Employee Inventory API (desktop)
 */

import { api } from './api';
import { extractApiData } from '@/utils/api';

export interface EmployeeKitHolder {
  userId: string;
  name: string;
  email?: string;
  role?: string;
  hasKit: boolean;
  kitLocationId?: string;
  kitName?: string;
}

export interface EmployeeKitSummary {
  kitLocationId: string;
  code: string;
  name: string;
  branchId: string;
  assignedUserId: string;
  employeeName?: string;
  employeeEmail?: string;
  stock: any[];
  serials: Array<{ serialNumber: string; itemId?: string; status?: string }>;
}

class EmployeeInventoryService {
  async listEmployees(): Promise<EmployeeKitHolder[]> {
    const res = await api.get('/employee-inventory/employees');
    const data = extractApiData<EmployeeKitHolder[]>(res);
    return Array.isArray(data) ? data : [];
  }

  async getKit(userId: string): Promise<EmployeeKitSummary> {
    const res = await api.get(`/employee-inventory/${userId}`);
    return extractApiData<EmployeeKitSummary>(res);
  }

  async transfer(payload: {
    kind: 'REPLENISH' | 'RETURN' | 'HANDOFF';
    warehouseLocationId?: string;
    toUserId?: string;
    fromUserId?: string;
    lines: Array<{ itemId: string; quantity: number; variantId?: string; serialNumbers?: string[] }>;
    notes?: string;
  }) {
    const res = await api.post('/employee-inventory/transfer', payload);
    return extractApiData(res);
  }
}

export const employeeInventoryService = new EmployeeInventoryService();
