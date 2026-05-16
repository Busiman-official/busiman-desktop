/**
 * Attendance Service - API calls for attendance
 */

import { api } from './api';
import {
  AttendanceStatusResponse,
  AttendanceRecord,
  CheckInRequest,
  CheckOutRequest,
  AttendanceDashboardData,
  AttendanceSource,
  PendingApprovalRow,
  AttendanceApprovalLeg,
} from '@/types';
import { NetworkInfo } from '@/types/electron';
import { getSystemFingerprint } from '@/utils/systemFingerprint';
import { extractApiData } from '@/utils/api';
import { logger } from '@/shared/utils/logger';

class AttendanceService {
  /**
   * Check-in
   * For desktop source, automatically includes network information (WiFi or Ethernet) and system fingerprint (REQUIRED)
   * Returns both the attendance record and the validation message
   */
  async checkIn(request: CheckInRequest): Promise<{ record: AttendanceRecord; message: string }> {
    // For desktop source, try to get network info (WiFi or Ethernet) if not provided
    if (request.source === AttendanceSource.DESKTOP && !request.wifi && !request.ethernet && window.electronAPI) {
      try {
        const networkInfo = await window.electronAPI.getCurrentNetwork();
        if (networkInfo.type === 'wifi' && networkInfo.wifi?.ssid) {
          request.wifi = {
            ssid: networkInfo.wifi.ssid,
            bssid: networkInfo.wifi.bssid || undefined,
          };
        } else if (networkInfo.type === 'ethernet' && networkInfo.ethernet?.macAddress) {
          request.ethernet = {
            macAddress: networkInfo.ethernet.macAddress,
          };
        }
      } catch (error) {
        logger.warn('[AttendanceService] Failed to get network info', error);
        // Continue without network info - backend will reject if required
      }
    }

    // Add system fingerprint for device tracking (REQUIRED for desktop)
    if (request.source === AttendanceSource.DESKTOP) {
      try {
        const fingerprint = await getSystemFingerprint();
        if (!fingerprint || fingerprint.trim() === '') {
          throw new Error('Generated fingerprint is empty');
        }
        request.systemFingerprint = fingerprint;
      } catch (error) {
        logger.error('[AttendanceService] Failed to get system fingerprint', error);
        throw new Error('Failed to generate system fingerprint. Cannot mark attendance.');
      }
    } else {
      // For non-desktop, try to get fingerprint but don't fail if it doesn't work
      try {
        const fingerprint = await getSystemFingerprint();
        if (fingerprint && fingerprint.trim() !== '') {
          request.systemFingerprint = fingerprint;
        }
      } catch (error) {
        logger.warn('[AttendanceService] Failed to get system fingerprint for non-desktop', error);
        // Continue without fingerprint for non-desktop
      }
    }

    const response = await api.post('/attendance/check-in', request);
    const record = extractApiData<AttendanceRecord>(response);
    return {
      record,
      message: (response.data as any).message || 'Checked in successfully',
    };
  }

  /**
   * Check-out
   * For desktop source, automatically includes Wi-Fi information and system fingerprint (REQUIRED)
   * Returns both the attendance record and the validation message
   */
  async checkOut(request: CheckOutRequest): Promise<{ record: AttendanceRecord; message: string }> {
    // For desktop source, try to get network info (WiFi or Ethernet) if not provided
    if (request.source === AttendanceSource.DESKTOP && !request.wifi && !request.ethernet && window.electronAPI) {
      try {
        const networkInfo = await window.electronAPI.getCurrentNetwork();
        if (networkInfo.type === 'wifi' && networkInfo.wifi?.ssid) {
          request.wifi = {
            ssid: networkInfo.wifi.ssid,
            bssid: networkInfo.wifi.bssid || undefined,
          };
        } else if (networkInfo.type === 'ethernet' && networkInfo.ethernet?.macAddress) {
          request.ethernet = {
            macAddress: networkInfo.ethernet.macAddress,
          };
        }
      } catch (error) {
        logger.warn('[AttendanceService] Failed to get network info', error);
        // Continue without network info - backend will reject if required
      }
    }

    // Add system fingerprint for device tracking (REQUIRED for desktop)
    if (request.source === AttendanceSource.DESKTOP) {
      try {
        const fingerprint = await getSystemFingerprint();
        if (!fingerprint || fingerprint.trim() === '') {
          throw new Error('Generated fingerprint is empty');
        }
        request.systemFingerprint = fingerprint;
      } catch (error) {
        logger.error('[AttendanceService] Failed to get system fingerprint', error);
        throw new Error('Failed to generate system fingerprint. Cannot mark attendance.');
      }
    } else {
      // For non-desktop, try to get fingerprint but don't fail if it doesn't work
      try {
        const fingerprint = await getSystemFingerprint();
        if (fingerprint && fingerprint.trim() !== '') {
          request.systemFingerprint = fingerprint;
        }
      } catch (error) {
        logger.warn('[AttendanceService] Failed to get system fingerprint for non-desktop', error);
        // Continue without fingerprint for non-desktop
      }
    }

    const response = await api.post('/attendance/check-out', request);
    return {
      record: extractApiData<AttendanceRecord>(response),
      message: (response.data as any).message || 'Checked out successfully',
    };
  }

  /**
   * Get current attendance status
   */
  async getStatus(): Promise<AttendanceStatusResponse> {
    const response = await api.get('/attendance/status');
    return extractApiData<AttendanceStatusResponse>(response);
  }

  /**
   * Get attendance history
   */
  async getHistory(params?: {
    employeeId?: string;
    startDate?: string;
    endDate?: string;
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    records: AttendanceRecord[];
    total: number;
    page: number;
    limit: number;
  }> {
    const response = await api.get('/attendance/history', { params });
    return extractApiData<{
      records: AttendanceRecord[];
      total: number;
      page: number;
      limit: number;
    }>(response);
  }

  /**
   * Get dashboard data (HR/Manager/Admin only)
   */
  async getDashboard(params?: {
    date?: string;
    department?: string;
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<AttendanceDashboardData> {
    const response = await api.get('/attendance/dashboard', { params });
    return extractApiData<AttendanceDashboardData>(response);
  }

  /**
   * Mark attendance for another employee (HR/Manager/Admin only)
   */
  async markAttendanceForEmployee(request: {
    employeeId: string;
    action: 'check-in' | 'check-out';
    source?: AttendanceSource;
    location?: {
      latitude?: number;
      longitude?: number;
      address?: string;
    };
    wifi?: {
      ssid: string;
      bssid?: string;
    };
    ethernet?: {
      macAddress: string;
    };
    systemFingerprint?: string;
    checkInTime?: string;
    checkOutTime?: string;
    overrideReason?: string;
  }): Promise<{ record: AttendanceRecord; message: string }> {
    // Ensure employeeId is a string, not an object
    if (typeof request.employeeId !== 'string') {
      if (request.employeeId && typeof request.employeeId === 'object') {
        // Extract ID from object if object was passed
        request.employeeId = (request.employeeId as any).id || (request.employeeId as any)._id || (request.employeeId as any).employeeId;
      }
      if (typeof request.employeeId !== 'string') {
        throw new Error('Employee ID must be a string');
      }
    }
    // Trim whitespace
    request.employeeId = request.employeeId.trim();
    // Auto-fill network info if not provided (for desktop)
    if (!request.wifi && !request.ethernet && window.electronAPI) {
      try {
        const networkInfo = await window.electronAPI.getCurrentNetwork();
        if (networkInfo.type === 'wifi' && networkInfo.wifi?.ssid) {
          request.wifi = {
            ssid: networkInfo.wifi.ssid,
            bssid: networkInfo.wifi.bssid || undefined,
          };
        } else if (networkInfo.type === 'ethernet' && networkInfo.ethernet?.macAddress) {
          request.ethernet = {
            macAddress: networkInfo.ethernet.macAddress,
          };
        }
      } catch (error) {
        logger.warn('[AttendanceService] Failed to get network info', error);
      }
    }

    // Auto-fill system fingerprint if not provided (for desktop)
    if (!request.systemFingerprint) {
      try {
        const fingerprint = await getSystemFingerprint();
        if (fingerprint && fingerprint.trim() !== '') {
          request.systemFingerprint = fingerprint;
        }
      } catch (error) {
        logger.warn('[AttendanceService] Failed to get system fingerprint', error);
      }
    }

    const response = await api.post('/attendance/mark-for-employee', {
      ...request,
      source: request.source || AttendanceSource.DESKTOP,
    });
    return {
      record: extractApiData<AttendanceRecord>(response),
      message: (response.data as any).message || 'Attendance marked successfully',
    };
  }

  async getPendingApprovals(params?: {
    page?: number;
    limit?: number;
    leg?: AttendanceApprovalLeg;
    date?: string;
  }): Promise<{ rows: PendingApprovalRow[]; total: number; page: number; limit: number }> {
    const response = await api.get('/attendance/approvals/pending', { params });
    return extractApiData(response);
  }

  async approveAttendance(attendanceId: string, leg: AttendanceApprovalLeg): Promise<AttendanceRecord> {
    const response = await api.post(`/attendance/approvals/${attendanceId}/approve`, { leg });
    return extractApiData<AttendanceRecord>(response);
  }

  async rejectAttendance(
    attendanceId: string,
    leg: AttendanceApprovalLeg,
    rejectReason: string
  ): Promise<AttendanceRecord> {
    const response = await api.post(`/attendance/approvals/${attendanceId}/reject`, {
      leg,
      rejectReason,
    });
    return extractApiData<AttendanceRecord>(response);
  }

  async cancelAttendanceApproval(
    attendanceId: string,
    leg: AttendanceApprovalLeg
  ): Promise<AttendanceRecord> {
    const response = await api.post(`/attendance/approvals/${attendanceId}/cancel`, { leg });
    return extractApiData<AttendanceRecord>(response);
  }
}

export const attendanceService = new AttendanceService();

