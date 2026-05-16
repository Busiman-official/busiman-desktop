/**
 * Mark Attendance Dialog Component
 * Dialog for Admin to mark attendance for employees with time selection
 */

import React, { useState, useEffect } from 'react';
import { attendanceService } from '@/services/attendance.service';
import { wifiService } from '@/services/wifi.service';
import { shiftService } from '@/services/shift.service';
import { authStore } from '@/store/authStore';
import { AttendanceSessionStatus, AttendanceSource, UserRole } from '@/types';
import { NetworkInfo } from '@/types/electron';
import { extractErrorMessage } from '@/utils/error';
import { logger } from '@/shared/utils/logger';
import './MarkAttendanceDialog.css';

export interface MarkAttendanceDialogDefaults {
  /** YYYY-MM-DD */
  date: string;
  checkInTime?: string;
  checkOutTime?: string;
}

interface MarkAttendanceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  employeeId: string;
  employeeName: string;
  currentStatus: AttendanceSessionStatus;
  defaults?: MarkAttendanceDialogDefaults | null;
  onSuccess: () => void;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

// Helper function to format current date/time for datetime-local input
const getCurrentDateTimeLocal = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}T${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
};

const dateWithCurrentClock = (dateYmd: string): string => {
  const now = new Date();
  return `${dateYmd}T${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
};

/** Use row calendar date + clock from ISO — avoids UTC shifting the day in datetime-local. */
const isoTimeOnDate = (iso: string, dateYmd: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return dateWithCurrentClock(dateYmd);
  return `${dateYmd}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

const resolveDialogTimes = (defaults?: MarkAttendanceDialogDefaults | null) => {
  const now = getCurrentDateTimeLocal();
  if (!defaults?.date) {
    return { checkIn: now, checkOut: now };
  }
  const dateOnly = dateWithCurrentClock(defaults.date);
  const checkIn = defaults.checkInTime
    ? isoTimeOnDate(defaults.checkInTime, defaults.date)
    : dateOnly;
  const checkOut = defaults.checkOutTime
    ? isoTimeOnDate(defaults.checkOutTime, defaults.date)
    : dateOnly;
  return { checkIn, checkOut };
};

export const MarkAttendanceDialog: React.FC<MarkAttendanceDialogProps> = ({
  isOpen,
  onClose,
  employeeId,
  employeeName,
  currentStatus,
  defaults = null,
  onSuccess,
}) => {
  const [action, setAction] = useState<'check-in' | 'check-out'>(
    currentStatus === AttendanceSessionStatus.CHECKED_IN ? 'check-out' : 'check-in'
  );
  const [location, setLocation] = useState<{ latitude?: number; longitude?: number; address?: string } | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [checkInTime, setCheckInTime] = useState<string>('');
  const [checkOutTime, setCheckOutTime] = useState<string>('');
  const [networkValidation, setNetworkValidation] = useState<{
    isValid: boolean;
    networkInfo: NetworkInfo | null;
    reason: string | null;
    loading: boolean;
  }>({
    isValid: false,
    networkInfo: null,
    reason: null,
    loading: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = authStore();
  const isAdmin = user?.role === UserRole.ADMIN;

  useEffect(() => {
    if (isOpen) {
      setAction(
        currentStatus === AttendanceSessionStatus.CHECKED_IN ? 'check-out' : 'check-in'
      );
      const { checkIn, checkOut } = resolveDialogTimes(defaults);
      setCheckInTime(checkIn);
      setCheckOutTime(checkOut);
      
      if (!isAdmin) {
        checkNetworkStatus();
      }
      // Try to get location if available
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            setLocation({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            });
          },
          () => {
            // Location not available, that's okay
          }
        );
      }
    } else {
      // Reset state when dialog closes
      setAction(currentStatus === AttendanceSessionStatus.CHECKED_IN ? 'check-out' : 'check-in');
      setLocation(null);
      setOverrideReason('');
      setCheckInTime('');
      setCheckOutTime('');
      setError(null);
    }
  }, [isOpen, currentStatus, defaults]);

  const checkNetworkStatus = async () => {
    if (!window.electronAPI) {
      setNetworkValidation({
        isValid: false,
        networkInfo: null,
        reason: 'Electron API not available',
        loading: false,
      });
      return;
    }

    setNetworkValidation((prev) => ({ ...prev, loading: true }));

    try {
      const networkInfo: NetworkInfo = await window.electronAPI.getCurrentNetwork();

      if (networkInfo.type === 'none') {
        setNetworkValidation({
          isValid: false,
          networkInfo: networkInfo, // Preserve network info to show "none" status
          reason: 'No network connection detected. Please connect to WiFi or Ethernet.',
          loading: false,
        });
        return;
      }

      // Validate network
      let validation;
      if (networkInfo.type === 'wifi' && networkInfo.wifi) {
        const validationRequest = {
          ssid: networkInfo.wifi.ssid,
          bssid: networkInfo.wifi.bssid || undefined,
        };
        logger.debug('[MarkAttendanceDialog] Validating WiFi', { validationRequest });
        validation = await wifiService.validateNetwork(validationRequest);
      } else if (networkInfo.type === 'ethernet' && networkInfo.ethernet) {
        const validationRequest = {
          macAddress: networkInfo.ethernet.macAddress,
        };
        logger.debug('[MarkAttendanceDialog] Validating Ethernet', { validationRequest });
        validation = await wifiService.validateNetwork(validationRequest);
      } else {
        setNetworkValidation({
          isValid: false,
          networkInfo: networkInfo, // Preserve network info even if invalid
          reason: 'Invalid network information',
          loading: false,
        });
        return;
      }

      logger.debug('[MarkAttendanceDialog] Validation result', { validation });
      
      // Use validation.allowed (not isValid) - matches API response structure
      // The API returns { allowed: boolean, reason?: string }
      setNetworkValidation({
        isValid: validation.allowed,
        networkInfo: networkInfo, // Always preserve network info to show connection details
        reason: validation.allowed ? null : validation.reason || 'Network validation failed',
        loading: false,
      });
    } catch (err: any) {
      // Try to preserve network info if we got it before the error
      const networkInfo = await window.electronAPI?.getCurrentNetwork().catch(() => null);
      setNetworkValidation({
        isValid: false,
        networkInfo: networkInfo || null,
        reason: err.message || 'Failed to validate network',
        loading: false,
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Non-admin users must pass network validation (or provide override reason handled by backend)
      if (!isAdmin && !networkValidation.isValid && !overrideReason.trim()) {
        setError('Network validation must pass or provide an override reason.');
        setLoading(false);
        return;
      }

      // Ensure employeeId is a string, not an object
      const employeeIdString = typeof employeeId === 'string' 
        ? employeeId.trim() 
        : (employeeId as any)?.id || (employeeId as any)?._id || (employeeId as any)?.employeeId || String(employeeId);
      
      if (!employeeIdString || typeof employeeIdString !== 'string') {
        setError('Invalid employee ID');
        setLoading(false);
        return;
      }

      // Validate manual check-in rule if action is check-in and user is not Admin
      if (action === 'check-in' && user?.role !== UserRole.ADMIN) {
        try {
          const shiftAssignment = await shiftService.getEmployeeShift(employeeIdString);
          if (shiftAssignment?.shiftId) {
            const shift = await shiftService.getShift(shiftAssignment.shiftId);
            if (shift && shift.checkInRules && !shift.checkInRules.allowManualCheckIn) {
              setError('Manual check-in is not allowed for this employee\'s shift. Please contact the administrator to enable manual check-ins for this shift.');
              setLoading(false);
              return;
            }
          }
        } catch (shiftError: any) {
          // If shift lookup fails, log but don't block (backend will validate anyway)
          logger.warn('[MarkAttendanceDialog] Failed to validate shift rule', shiftError, {
            employeeId: employeeIdString,
          });
          // Continue - backend will validate and return appropriate error
        }
      }

      // Convert datetime-local values to ISO strings if provided
      const checkInTimeISO = checkInTime ? new Date(checkInTime).toISOString() : undefined;
      const checkOutTimeISO = checkOutTime ? new Date(checkOutTime).toISOString() : undefined;

      await attendanceService.markAttendanceForEmployee({
        employeeId: employeeIdString,
        action,
        source: AttendanceSource.DESKTOP,
        location: location || undefined,
        overrideReason: overrideReason.trim() || undefined,
        checkInTime: checkInTimeISO,
        checkOutTime: checkOutTimeISO,
      });

      onSuccess();
      onClose();
    } catch (err: any) {
      // Use centralized error extraction utility
      let errorMessage = extractErrorMessage(err, 'Unable to mark attendance. Please try again.');
      
      // Map common error scenarios to user-friendly messages
      const statusCode = err.response?.status;
      
      // Check for specific error codes from backend
      if (err.response?.data?.errorCode === 'MANUAL_CHECKIN_NOT_ALLOWED' || 
          err.response?.data?.message?.includes('Manual check-in is not allowed')) {
        errorMessage = 'Manual check-in is not allowed for this employee\'s shift. Please contact the administrator to enable manual check-ins for this shift.';
      } else if (statusCode === 400) {
        // Bad request - validation errors are already user-friendly from backend
        // Keep the message as is, but check for manual check-in error
        if (err.response?.data?.message?.includes('Manual check-in is not allowed')) {
          errorMessage = err.response.data.message;
        }
      } else if (statusCode === 401) {
        errorMessage = 'Your session has expired. Please log in again.';
      } else if (statusCode === 403) {
        errorMessage = 'You do not have permission to perform this action.';
      } else if (statusCode === 404) {
        errorMessage = 'Employee not found. Please refresh the page and try again.';
      } else if (statusCode === 409) {
        errorMessage = 'This device has already been used by another employee today.';
      } else if (statusCode === 500) {
        errorMessage = 'A server error occurred. Please try again later or contact support.';
      } else if (statusCode >= 500) {
        errorMessage = 'Server error. Please try again later.';
      } else if (!err.response) {
        // Network error
        errorMessage = 'Unable to connect to the server. Please check your internet connection and try again.';
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="mark-attendance-dialog-overlay" onClick={onClose}>
      <div className="mark-attendance-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="mark-attendance-dialog-header">
          <h2>Mark Attendance for {employeeName}</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="mark-attendance-dialog-form">
          <div className="form-group">
            <label>Action</label>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value as 'check-in' | 'check-out')}
              disabled={loading}
            >
              <option value="check-in">Check In</option>
              <option value="check-out">Check Out</option>
            </select>
          </div>

          {action === 'check-in' && (
            <div className="form-group">
              <label>Check-in Time</label>
              <input
                type="datetime-local"
                value={checkInTime}
                onChange={(e) => setCheckInTime(e.target.value)}
                disabled={loading}
              />
              <small>Select the date and time to register for check-in. Leave empty to use current time.</small>
            </div>
          )}

          {action === 'check-out' && (
            <div className="form-group">
              <label>Check-out Time</label>
              <input
                type="datetime-local"
                value={checkOutTime}
                onChange={(e) => setCheckOutTime(e.target.value)}
                disabled={loading}
              />
              <small>Select the date and time to register for check-out. Leave empty to use current time.</small>
            </div>
          )}

          {!isAdmin && (
          <div className="form-group">
            <label>Network Status</label>
            {networkValidation.loading ? (
              <div className="network-status loading">Validating network...</div>
            ) : networkValidation.isValid ? (
              <div className="network-status valid">
                ✓ {networkValidation.networkInfo?.type === 'wifi' ? 'WiFi' : 'Ethernet'} Connected
                {networkValidation.networkInfo?.wifi && (
                  <span> ({networkValidation.networkInfo.wifi.ssid})</span>
                )}
                {networkValidation.networkInfo?.ethernet && (
                  <span> ({networkValidation.networkInfo.ethernet.macAddress})</span>
                )}
              </div>
            ) : (
              <div className="network-status invalid">
                <div>⚠ {networkValidation.reason || 'Network validation failed'}</div>
                {networkValidation.networkInfo && (
                  <div className="network-details">
                    {networkValidation.networkInfo.type === 'wifi' && networkValidation.networkInfo.wifi && (
                      <div className="network-detail-item">
                        <strong>Connected WiFi:</strong> {networkValidation.networkInfo.wifi.ssid}
                        {networkValidation.networkInfo.wifi.bssid && (
                          <span className="network-detail-sub"> (BSSID: {networkValidation.networkInfo.wifi.bssid})</span>
                        )}
                      </div>
                    )}
                    {networkValidation.networkInfo.type === 'ethernet' && networkValidation.networkInfo.ethernet && (
                      <div className="network-detail-item">
                        <strong>Connected Ethernet:</strong> {networkValidation.networkInfo.ethernet.macAddress}
                        {networkValidation.networkInfo.ethernet.adapterName && (
                          <span className="network-detail-sub"> ({networkValidation.networkInfo.ethernet.adapterName})</span>
                        )}
                      </div>
                    )}
                    {networkValidation.networkInfo.type === 'none' && (
                      <div className="network-detail-item">
                        <strong>No network connection detected</strong>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={checkNetworkStatus}
              disabled={networkValidation.loading}
              className="refresh-network-button"
            >
              Refresh
            </button>
          </div>
          )}

          {location && (
            <div className="form-group">
              <label>Location</label>
              <div className="location-info">
                {location.latitude && location.longitude && (
                  <div>
                    Coordinates: {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
                  </div>
                )}
                {location.address && <div>Address: {location.address}</div>}
              </div>
            </div>
          )}

          {!isAdmin && !networkValidation.isValid && (
            <div className="form-group">
              <label>
                Override Reason <span className="required">*</span>
              </label>
              <textarea
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Please provide a reason for overriding network validation..."
                required={!networkValidation.isValid}
                rows={3}
                disabled={loading}
              />
              <small>Required when network validation fails</small>
            </div>
          )}

          {error && <div className="error-message">{error}</div>}

          <div className="form-actions">
            <button type="button" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button 
              type="submit" 
              disabled={
                loading || 
                (!isAdmin && networkValidation.loading) ||
                (!isAdmin && !networkValidation.isValid && !overrideReason.trim())
              }
            >
              {loading ? 'Marking...' : `Mark ${action === 'check-in' ? 'Check In' : 'Check Out'}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

