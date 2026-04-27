/**
 * Employee Service - API calls for employee management (HR/Admin only)
 */

import { api } from './api';
import { User, UserRole, EmployeeDetails, UpdateEmployeeDetailsRequest } from '@/types';
import { extractApiData } from '@/utils/api';

export interface ActiveSessionInfo {
  userId: string;
  email: string;
  name: string;
  sessionId: string;
  deviceFingerprint?: string;
  ipAddress?: string;
  userAgent?: string;
  lastActivityAt: string;
  expiresAt: string;
}

export interface CreateEmployeeRequest {
  email: string;
  name: string;
  password: string;
  role: UserRole;
  department?: string;
  visibleDepartments?: string[];
  branchId?: string;
  phoneNumber?: string;
  address?: string;
  employeeId?: string;
  designation?: string;
  dateOfJoining?: string;
  dateOfBirth?: string;
  emergencyContact?: {
    name?: string;
    phone?: string;
    relationship?: string;
  };
  bio?: string;
}

export interface UpdateEmployeeRequest {
  name?: string;
  email?: string;
  role?: UserRole;
  department?: string;
  branchId?: string;
  phoneNumber?: string;
  address?: string;
  employeeId?: string;
  designation?: string;
  dateOfJoining?: string;
  dateOfBirth?: string;
  emergencyContact?: {
    name?: string;
    phone?: string;
    relationship?: string;
  };
  bio?: string;
  isActive?: boolean;
}

class EmployeeService {
  /**
   * Get all employees
   */
  async getAllEmployees(): Promise<User[]> {
    const response = await api.get('/employees');
    return extractApiData<User[]>(response);
  }

  /**
   * Get employee by ID
   */
  async getEmployeeById(id: string): Promise<User> {
    const response = await api.get(`/employees/${id}`);
    return extractApiData<User>(response);
  }

  /**
   * Create new employee
   */
  async createEmployee(request: CreateEmployeeRequest): Promise<User> {
    const response = await api.post('/employees', request);
    return extractApiData<User>(response);
  }

  /**
   * Update employee
   */
  async updateEmployee(id: string, request: UpdateEmployeeRequest): Promise<User> {
    const response = await api.put(`/employees/${id}`, request);
    return extractApiData<User>(response);
  }

  /**
   * Delete employee (deactivate)
   */
  async deleteEmployee(id: string): Promise<void> {
    await api.delete(`/employees/${id}`);
  }

  /**
   * Reset employee password
   */
  async resetPassword(id: string, newPassword: string): Promise<void> {
    await api.post(`/employees/${id}/reset-password`, { password: newPassword });
  }

  /**
   * Get proxy permission for a user
   */
  async getProxyPermission(userId: string): Promise<{ canActAsProxy: boolean }> {
    const response = await api.get(`/employees/${userId}/proxy-permission`);
    return extractApiData<{ canActAsProxy: boolean }>(response);
  }

  /**
   * Update proxy permission for a user (admin only)
   */
  async updateProxyPermission(userId: string, canActAsProxy: boolean): Promise<{ canActAsProxy: boolean }> {
    const response = await api.put(`/employees/${userId}/proxy-permission`, { canActAsProxy });
    return extractApiData<{ canActAsProxy: boolean }>(response);
  }

  /**
   * Get all users with proxy permission (admin only)
   */
  async getAllProxyEnabledUsers(): Promise<User[]> {
    const response = await api.get('/employees/proxy-enabled');
    return extractApiData<User[]>(response);
  }

  /**
   * Force logout a specific user (admin only)
   */
  async logoutEmployee(userId: string): Promise<void> {
    await api.post(`/auth/logout/${userId}`);
  }

  /**
   * Get all active sessions (admin/HR only)
   */
  async getActiveSessions(): Promise<ActiveSessionInfo[]> {
    const response = await api.get('/auth/sessions');
    return extractApiData<ActiveSessionInfo[]>(response);
  }
}

export const employeeService = new EmployeeService();

/**
 * Employee Details Service - API calls for comprehensive employee profile management
 */
class EmployeeDetailsService {
  /**
   * Get comprehensive employee details
   */
  async getEmployeeDetails(employeeId: string): Promise<EmployeeDetails> {
    const response = await api.get(`/employees/${employeeId}/details`);
    return extractApiData<EmployeeDetails>(response);
  }

  /**
   * Update employee details (partial update)
   */
  async updateEmployeeDetails(
    employeeId: string,
    request: UpdateEmployeeDetailsRequest
  ): Promise<EmployeeDetails> {
    const response = await api.patch(`/employees/${employeeId}/details`, request);
    return extractApiData<EmployeeDetails>(response);
  }
}

export const employeeDetailsService = new EmployeeDetailsService();

