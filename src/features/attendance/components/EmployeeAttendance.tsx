/**
 * Employee Attendance Component
 * Allows employees to check in and check out
 */

import React, { useState, useEffect, useMemo } from 'react';
import { authStore } from '@/store/authStore';
import { attendanceService } from '@/services/attendance.service';
import { wifiService } from '@/services/wifi.service';
import { socketService } from '@/services/socket.service';
import {
  AttendanceSessionStatus,
  AttendanceSource,
  AttendanceStatusResponse,
  AttendanceRecord,
} from '@/types';
import { NetworkInfo } from '@/types/electron';
import { logger } from '@/shared/utils/logger';
import './EmployeeAttendance.css';

interface NetworkValidationState {
  isValid: boolean | null; // null = checking, true = valid, false = invalid
  networkInfo: NetworkInfo | null;
  reason?: string;
  loading: boolean;
}

export const EmployeeAttendance: React.FC = () => {
  const user = authStore((s) => s.user);
  const allowCheckinWithoutWifi = user?.allowCheckinWithoutWifi === true;
  const allowCheckoutWithoutWifi = user?.allowCheckoutWithoutWifi === true;

  const [status, setStatus] = useState<AttendanceStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null);
  const [networkValidation, setNetworkValidation] = useState<NetworkValidationState>({
    isValid: null,
    networkInfo: null,
    loading: false,
  });
  const isCheckingWifi = React.useRef(false);

  const desktopNetworkBlocksCheckIn = useMemo(() => {
    if (!window.electronAPI) return false;
    if (allowCheckinWithoutWifi) return false;
    return networkValidation.isValid === false;
  }, [allowCheckinWithoutWifi, networkValidation.isValid]);

  const desktopNetworkBlocksCheckOut = useMemo(() => {
    if (!window.electronAPI) return false;
    if (allowCheckoutWithoutWifi) return false;
    return networkValidation.isValid === false;
  }, [allowCheckoutWithoutWifi, networkValidation.isValid]);

  // Load initial status
  useEffect(() => {
    loadStatus();
    checkNetworkStatus();
    
    // Connect to Socket.IO
    socketService.connect();

    // Subscribe to real-time updates
    socketService.onAttendanceUpdate(() => {
      loadStatus(); // Refresh status
    });

    return () => {
      socketService.offAttendanceUpdate();
    };
  }, []);

  // Check network status when window gains focus (user switches back to app)
  useEffect(() => {
    if (!window.electronAPI) return;

    const handleFocus = () => {
      // Check network when user switches back to the app (may have changed networks)
      checkNetworkStatus();
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  // Check network status periodically (every 20 seconds) if on desktop
  useEffect(() => {
    if (!window.electronAPI) return;

    const interval = setInterval(() => {
      checkNetworkStatus();
    }, 20000); // Check every 20 seconds

    return () => clearInterval(interval);
  }, []);

  const checkNetworkStatus = async () => {
    logger.debug('[EmployeeAttendance] checkNetworkStatus() called');
    // Prevent duplicate simultaneous checks
    if (isCheckingWifi.current || !window.electronAPI) {
      if (!window.electronAPI) {
         
      } else {
         
      }
      return;
    }

     
    isCheckingWifi.current = true;
    setNetworkValidation((prev) => ({ ...prev, loading: true }));

    try {
      // Get current network info from Electron (WiFi or Ethernet)
      logger.debug('[EmployeeAttendance] Calling window.electronAPI.getCurrentNetwork()');
      const networkInfo: NetworkInfo = await window.electronAPI.getCurrentNetwork();
      logger.debug('[EmployeeAttendance] getCurrentNetwork() returned', { networkInfo });

      if (networkInfo.type === 'none') {
         
        setNetworkValidation({
          isValid: false,
          networkInfo: null,
          reason: 'No network connection detected. Please connect to a WiFi or Ethernet network.',
          loading: false,
        });
        isCheckingWifi.current = false;
        return;
      }

       
      if (networkInfo.type === 'wifi') {
         
      } else if (networkInfo.type === 'ethernet') {
         
      }

      // Validate network with backend (WiFi or Ethernet)
       
      let validation;
      if (networkInfo.type === 'wifi' && networkInfo.wifi) {
        const validationRequest = {
          ssid: networkInfo.wifi.ssid,
          bssid: networkInfo.wifi.bssid || undefined,
        };
         
        validation = await wifiService.validateNetwork(validationRequest);
      } else if (networkInfo.type === 'ethernet' && networkInfo.ethernet) {
        const validationRequest = {
          macAddress: networkInfo.ethernet.macAddress,
        };
         
        validation = await wifiService.validateNetwork(validationRequest);
      } else {
        logger.error('[EmployeeAttendance] Invalid network information structure', undefined, { networkInfo });
        setNetworkValidation({
          isValid: false,
          networkInfo: null,
          reason: 'Invalid network information',
          loading: false,
        });
        isCheckingWifi.current = false;
        return;
      }

      logger.debug('[EmployeeAttendance] Validation result', { validation });
      setNetworkValidation({
        isValid: validation.allowed,
        networkInfo: networkInfo,
        reason: validation.reason,
        loading: false,
      });
       
    } catch (err: any) {
      logger.error('[EmployeeAttendance] Error checking network status', err, {
        message: err.message,
        response: err.response?.data,
        stack: err.stack,
      });
      setNetworkValidation({
        isValid: false,
        networkInfo: null,
        reason: err.response?.data?.message || 'Failed to validate network connection',
        loading: false,
      });
    } finally {
      isCheckingWifi.current = false;
      logger.debug('[EmployeeAttendance] checkNetworkStatus() completed');
    }
  };

  const loadStatus = async () => {
    try {
      const statusData = await attendanceService.getStatus();
      setStatus(statusData);
      setTodayRecord(statusData.today || null);
      setError(null);
    } catch (err: any) {
      // Extract user-friendly error message from API response
      const errorMessage = err.response?.data?.error || err.response?.data?.message || err.message || 'Failed to load attendance status. Please refresh the page.';
      setError(errorMessage);
    }
  };

  const handleCheckIn = async () => {
    if (!allowCheckinWithoutWifi) {
      await checkNetworkStatus();

      if (networkValidation.loading) {
        setError('Please wait for network validation to complete');
        return;
      }

      if (networkValidation.isValid === false) {
        setError(networkValidation.reason || 'Network connection is not approved for attendance');
        return;
      }

      if (window.electronAPI) {
        if (!networkValidation.networkInfo || networkValidation.networkInfo.type === 'none') {
          setError('No network connection detected. Please connect to a WiFi or Ethernet network.');
          return;
        }
        if (networkValidation.isValid !== true) {
          setError('Network connection validation failed. Please check your connection.');
          return;
        }
      }
    }

    setLoading(true);
    setError(null);

    try {
      const checkInRequest: any = {
        source: AttendanceSource.DESKTOP,
      };

      if (window.electronAPI && networkValidation.networkInfo) {
        if (networkValidation.networkInfo.type === 'wifi' && networkValidation.networkInfo.wifi) {
          checkInRequest.wifi = {
            ssid: networkValidation.networkInfo.wifi.ssid,
            bssid: networkValidation.networkInfo.wifi.bssid || undefined,
          };
        } else if (networkValidation.networkInfo.type === 'ethernet' && networkValidation.networkInfo.ethernet) {
          checkInRequest.ethernet = {
            macAddress: networkValidation.networkInfo.ethernet.macAddress,
          };
        } else if (!allowCheckinWithoutWifi) {
          throw new Error('Invalid network information. Please reconnect and try again.');
        }
      }

      if (!allowCheckinWithoutWifi && window.electronAPI && !checkInRequest.wifi && !checkInRequest.ethernet) {
        throw new Error('Network connection information is required for desktop attendance');
      }

      const result = await attendanceService.checkIn(checkInRequest);
      setTodayRecord(result.record);
      setSuccessMessage(result.message);
      setError(null); // Clear any previous errors
      await loadStatus();
      
      // Clear success message after 5 seconds
      setTimeout(() => {
        setSuccessMessage(null);
      }, 5000);
    } catch (err: any) {
      // Extract user-friendly error message from API response
      const errorMessage = err.response?.data?.error || err.response?.data?.message || err.message || 'Failed to check in. Please try again.';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleCheckOut = async () => {
    if (!allowCheckoutWithoutWifi) {
      await checkNetworkStatus();

      if (networkValidation.loading) {
        setError('Please wait for network validation to complete');
        return;
      }

      if (networkValidation.isValid === false) {
        setError(networkValidation.reason || 'Network connection is not approved for attendance');
        return;
      }

      if (window.electronAPI) {
        if (!networkValidation.networkInfo || networkValidation.networkInfo.type === 'none') {
          setError('No network connection detected. Please connect to a WiFi or Ethernet network.');
          return;
        }
        if (networkValidation.isValid !== true) {
          setError('Network connection validation failed. Please check your connection.');
          return;
        }
      }
    }

    setLoading(true);
    setError(null);

    try {
      const checkOutRequest: any = {
        source: AttendanceSource.DESKTOP,
      };

      if (window.electronAPI && networkValidation.networkInfo) {
        if (networkValidation.networkInfo.type === 'wifi' && networkValidation.networkInfo.wifi) {
          checkOutRequest.wifi = {
            ssid: networkValidation.networkInfo.wifi.ssid,
            bssid: networkValidation.networkInfo.wifi.bssid || undefined,
          };
        } else if (networkValidation.networkInfo.type === 'ethernet' && networkValidation.networkInfo.ethernet) {
          checkOutRequest.ethernet = {
            macAddress: networkValidation.networkInfo.ethernet.macAddress,
          };
        } else if (!allowCheckoutWithoutWifi) {
          throw new Error('Invalid network information. Please reconnect and try again.');
        }
      }

      if (!allowCheckoutWithoutWifi && window.electronAPI && !checkOutRequest.wifi && !checkOutRequest.ethernet) {
        throw new Error('Network connection information is required for desktop attendance');
      }

      const result = await attendanceService.checkOut(checkOutRequest);
      setTodayRecord(result.record);
      setSuccessMessage(result.message);
      setError(null); // Clear any previous errors
      await loadStatus();
      
      // Clear success message after 5 seconds
      setTimeout(() => {
        setSuccessMessage(null);
      }, 5000);
    } catch (err: any) {
      // Extract user-friendly error message from API response
      const errorMessage = err.response?.data?.error || err.response?.data?.message || err.message || 'Failed to check out. Please try again.';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (isoString?: string): string => {
    if (!isoString) return '--';
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatDuration = (minutes?: number): string => {
    if (!minutes) return '--';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  const getStatusBadgeClass = (status?: AttendanceSessionStatus): string => {
    switch (status) {
      case AttendanceSessionStatus.CHECKED_IN:
        return 'status-badge checked-in';
      case AttendanceSessionStatus.CHECKED_OUT:
        return 'status-badge checked-out';
      default:
        return 'status-badge not-started';
    }
  };

  const getStatusText = (status?: AttendanceSessionStatus): string => {
    switch (status) {
      case AttendanceSessionStatus.CHECKED_IN:
        return 'Checked In';
      case AttendanceSessionStatus.CHECKED_OUT:
        return 'Checked Out';
      default:
        return 'Not Started';
    }
  };

  if (!status) {
    return (
      <div className="employee-attendance">
        <div className="attendance-loading">Loading attendance status...</div>
      </div>
    );
  }

  return (
    <div className="employee-attendance">
      <div className="attendance-header">
        <h2>My Attendance</h2>
        <div className={`status-indicator ${getStatusBadgeClass(status.status)}`}>
          {getStatusText(status.status)}
        </div>
      </div>

      {error && <div className="attendance-error">{error}</div>}
      {successMessage && <div className="attendance-success">{successMessage}</div>}

      {/* Network Status Section - Only show in desktop app */}
      {window.electronAPI && (
        <div className="attendance-wifi">
          <div className="wifi-info-header">
            <div className="wifi-info">
              <span className="wifi-label">Current Connection:</span>
              <span className="wifi-name">
                {networkValidation.loading
                  ? 'Checking...'
                  : networkValidation.networkInfo?.type === 'wifi' && networkValidation.networkInfo.wifi
                  ? `WiFi: ${networkValidation.networkInfo.wifi.ssid}`
                  : networkValidation.networkInfo?.type === 'ethernet' && networkValidation.networkInfo.ethernet
                  ? `Ethernet: ${networkValidation.networkInfo.ethernet.macAddress}${networkValidation.networkInfo.ethernet.adapterName ? ` (${networkValidation.networkInfo.ethernet.adapterName})` : ''}`
                  : 'Not connected'}
              </span>
            </div>
            <button
              className="wifi-refresh-btn"
              onClick={checkNetworkStatus}
              disabled={networkValidation.loading}
              title="Refresh network status"
            >
              ↻
            </button>
          </div>
          {networkValidation.isValid === false && (
            <div className="wifi-error">
              {networkValidation.reason || 'Network connection is not approved for attendance'}
            </div>
          )}
          {networkValidation.isValid === true && networkValidation.networkInfo && (
            <div className="wifi-success">
              ✓ Connected to approved {networkValidation.networkInfo.type === 'wifi' ? 'WiFi' : 'Ethernet'} network
            </div>
          )}
        </div>
      )}

      <div className="attendance-card">
        <div className="attendance-date">
          <h3>Today</h3>
          <p>{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>

        <div className="attendance-details">
          <div className="detail-row">
            <span className="detail-label">Check-In Time:</span>
            <span className="detail-value">{formatTime(todayRecord?.checkInTime)}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Check-Out Time:</span>
            <span className="detail-value">{formatTime(todayRecord?.checkOutTime)}</span>
          </div>
          {todayRecord?.totalDuration !== undefined && (
            <div className="detail-row">
              <span className="detail-label">Total Duration:</span>
              <span className="detail-value">{formatDuration(todayRecord.totalDuration)}</span>
            </div>
          )}
        </div>

        <div className="attendance-actions">
          <button
            className="btn-check-in"
            onClick={handleCheckIn}
            disabled={
              loading ||
              !status.canCheckIn ||
              (!allowCheckinWithoutWifi && window.electronAPI && networkValidation.loading) ||
              desktopNetworkBlocksCheckIn
            }
          >
            {loading ? 'Processing...' : 'Check In'}
          </button>
          <button
            className="btn-check-out"
            onClick={handleCheckOut}
            disabled={
              loading ||
              !status.canCheckOut ||
              (!allowCheckoutWithoutWifi && window.electronAPI && networkValidation.loading) ||
              desktopNetworkBlocksCheckOut
            }
          >
            {loading ? 'Processing...' : 'Check Out'}
          </button>
        </div>
      </div>

      {status.status === AttendanceSessionStatus.CHECKED_IN && (
        <div className="attendance-info">
          <p>✓ You are currently checked in. Don't forget to check out at the end of your shift.</p>
        </div>
      )}
    </div>
  );
};

