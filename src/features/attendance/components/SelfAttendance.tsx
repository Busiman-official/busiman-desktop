/**
 * Self Attendance Component
 * Shows current user's attendance status and actions
 * Role-aware: Admin cannot mark attendance
 */

import React, { useState, useEffect } from 'react';
import { attendanceService } from '@/services/attendance.service';
import { wifiService } from '@/services/wifi.service';
import { socketService } from '@/services/socket.service';
import { authStore } from '@/store/authStore';
import {
  AttendanceSessionStatus,
  AttendanceSource,
  AttendanceStatusResponse,
  AttendanceRecord,
} from '@/types';
import { NetworkInfo } from '@/types/electron';
import { logger } from '@/shared/utils/logger';
import './SelfAttendance.css';

interface SelfAttendanceProps {
  canMarkAttendance: boolean; // Whether user can check in/out
}

interface NetworkValidationState {
  isValid: boolean | null; // null = checking, true = valid, false = invalid
  networkInfo: NetworkInfo | null;
  reason?: string;
  loading: boolean;
}

export const SelfAttendance: React.FC<SelfAttendanceProps> = ({ canMarkAttendance }) => {
  const user = authStore((state) => state.user);
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

  useEffect(() => {
    loadStatus();
    checkNetworkStatus();
    
    // Connect to Socket.IO
    socketService.connect();

    // Subscribe to real-time updates
    socketService.onAttendanceUpdate((data) => {
      if (data.data.employeeId === user?.id) {
        loadStatus(); // Refresh status
      }
    });

    return () => {
      socketService.offAttendanceUpdate();
    };
  }, [user?.id]);

  // Check network status when window gains focus (user switches back to app)
  useEffect(() => {
    if (!canMarkAttendance || !window.electronAPI) return;

    const handleFocus = () => {
      // Check network when user switches back to the app (may have changed networks)
      checkNetworkStatus();
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [canMarkAttendance]);

  // Check network status periodically (every 20 seconds) if on desktop
  useEffect(() => {
    if (!canMarkAttendance) return;

    const interval = setInterval(() => {
      checkNetworkStatus();
    }, 20000); // Check every 20 seconds

    return () => clearInterval(interval);
  }, [canMarkAttendance]);

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

  const checkNetworkStatus = async () => {
    logger.debug('[SelfAttendance] checkNetworkStatus() called');
    // Only check network if Electron API is available (desktop app)
    if (!window.electronAPI) {
       
      // Not in desktop app - network validation not applicable
      setNetworkValidation({
        isValid: true, // Allow attendance for non-desktop sources
        networkInfo: null,
        loading: false,
      });
      return;
    }

    // Don't start a new check if one is already in progress
    if (isCheckingWifi.current) {
       
      return;
    }

     
    isCheckingWifi.current = true;
    setNetworkValidation(prev => ({ ...prev, loading: true }));

    try {
      // Get current network info from Electron (WiFi or Ethernet)
      logger.debug('[SelfAttendance] Calling window.electronAPI.getCurrentNetwork()');
      const networkInfo: NetworkInfo = await window.electronAPI.getCurrentNetwork();
      logger.debug('[SelfAttendance] getCurrentNetwork() returned', { networkInfo });

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
        logger.error('[SelfAttendance] Invalid network information structure', undefined, { networkInfo });
        setNetworkValidation({
          isValid: false,
          networkInfo: null,
          reason: 'Invalid network information',
          loading: false,
        });
        isCheckingWifi.current = false;
        return;
      }

      logger.debug('[SelfAttendance] Validation result', { validation });
      setNetworkValidation({
        isValid: validation.allowed,
        networkInfo: networkInfo,
        reason: validation.reason,
        loading: false,
      });
       
    } catch (err: any) {
      logger.error('[SelfAttendance] Error checking network status', err, {
        message: err.message,
        response: err.response?.data,
        stack: err.stack,
      });
      setNetworkValidation({
        isValid: false,
        networkInfo: null,
        reason: err.response?.data?.message || 'Failed to verify network connection. Please check your connection and try again.',
        loading: false,
      });
    } finally {
      isCheckingWifi.current = false;
      logger.debug('[SelfAttendance] checkNetworkStatus() completed');
    }
  };

  const handleCheckIn = async () => {
    if (!canMarkAttendance) return;
    
    // Re-validate network before check-in
    await checkNetworkStatus();
    
    // Check if network validation is still loading
    if (networkValidation.loading) {
      setError('Please wait for network validation to complete');
      return;
    }
    
    // Check if network is valid after validation
    if (networkValidation.isValid === false) {
      setError(networkValidation.reason || 'Network connection is not approved for attendance');
      return;
    }

    // For desktop app, ensure we have network info
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

    setLoading(true);
    setError(null);

    try {
      const checkInRequest: any = {
        source: AttendanceSource.DESKTOP,
      };

      // Always include network info for desktop app if available
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
        } else {
          // If network info exists but type is invalid, throw error
          throw new Error('Invalid network information. Please reconnect and try again.');
        }
      }

      // If desktop app but no network info, throw error
      if (window.electronAPI && !checkInRequest.wifi && !checkInRequest.ethernet) {
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
    if (!canMarkAttendance) return;

    const allowCheckoutWithoutWifi = user?.allowCheckoutWithoutWifi === true;

    // Re-validate network before check-out (skip when employee is allowed to checkout without WiFi)
    if (!allowCheckoutWithoutWifi) {
      await checkNetworkStatus();

      // Check if network validation is still loading
      if (networkValidation.loading) {
        setError('Please wait for network validation to complete');
        return;
      }

      // Check if network is valid after validation
      if (networkValidation.isValid === false) {
        setError(networkValidation.reason || 'Network connection is not approved for attendance');
        return;
      }

      // For desktop app, ensure we have network info
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

      // Include network info when available (for audit when bypassing, or required when not bypassing)
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
          // If network info exists but type is invalid, throw error (only when WiFi required)
          throw new Error('Invalid network information. Please reconnect and try again.');
        }
      }

      // Require network info for desktop unless employee is allowed to checkout without WiFi
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
    });
  };

  const formatDuration = (minutes?: number): string => {
    if (!minutes) return '--';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  const getStatusText = (status?: AttendanceSessionStatus): string => {
    switch (status) {
      case AttendanceSessionStatus.CHECKED_IN:
        return 'Checked In';
      case AttendanceSessionStatus.CHECKED_OUT:
        return 'Checked Out';
      default:
        return 'Not Checked In';
    }
  };

  const getStatusClass = (status?: AttendanceSessionStatus): string => {
    switch (status) {
      case AttendanceSessionStatus.CHECKED_IN:
        return 'status-checked-in';
      case AttendanceSessionStatus.CHECKED_OUT:
        return 'status-checked-out';
      default:
        return 'status-not-started';
    }
  };

  if (!status) {
    return (
      <div className="self-attendance">
        <div className="self-attendance-loading">Loading attendance status...</div>
      </div>
    );
  }

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="self-attendance">
      <div className="self-attendance-header">
        <div>
          <h2 className="self-attendance-title">My Attendance</h2>
          <p className="self-attendance-date">{today}</p>
        </div>
        <div className={`self-attendance-status ${getStatusClass(status.status)}`}>
          {getStatusText(status.status)}
        </div>
      </div>

      {error && <div className="self-attendance-error">{error}</div>}
      {successMessage && <div className="self-attendance-success">{successMessage}</div>}

      {/* Network Status Section - Only show in desktop app */}
      {window.electronAPI && canMarkAttendance && (
        <div className="self-attendance-wifi">
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

      <div className="self-attendance-details">
        <table className="self-attendance-table">
          <tbody>
            <tr>
              <td className="detail-label">Check-in Time</td>
              <td className="detail-value">{formatTime(todayRecord?.checkInTime)}</td>
            </tr>
            <tr>
              <td className="detail-label">Check-out Time</td>
              <td className="detail-value">{formatTime(todayRecord?.checkOutTime)}</td>
            </tr>
            {todayRecord?.totalDuration !== undefined && (
              <tr>
                <td className="detail-label">Total Duration</td>
                <td className="detail-value">{formatDuration(todayRecord.totalDuration)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canMarkAttendance && (
        <div className="self-attendance-actions">
          <button
            className="btn-check-in"
            onClick={handleCheckIn}
            disabled={
              loading || 
              !status.canCheckIn || 
              networkValidation.loading ||
              (window.electronAPI && networkValidation.isValid === false)
            }
            title={
              window.electronAPI && networkValidation.isValid === false
                ? networkValidation.reason || 'Network connection not approved'
                : undefined
            }
          >
            {loading ? 'Processing...' : 'Check In'}
          </button>
          <button
            className="btn-check-out"
            onClick={handleCheckOut}
            disabled={loading || !status.canCheckOut}
          >
            {loading ? 'Processing...' : 'Check Out'}
          </button>
        </div>
      )}

      {!canMarkAttendance && (
        <div className="self-attendance-info">
          <p>Attendance marking is not available for your role. You can view attendance records only.</p>
        </div>
      )}
    </div>
  );
};

