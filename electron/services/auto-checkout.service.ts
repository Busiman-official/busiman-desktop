/**
 * Auto Check-out Service - Core logic for auto check-out on shutdown/logout
 */

import { Notification } from 'electron';
import { sessionService } from './session.service';
import { apiService } from './api.service';
import { storageService } from './storage.service';
import { configService } from './config.service';
import { loggerService } from './logger.service';
import { getCurrentNetwork, NetworkInfo } from '../utils/network.util';
import { getSystemFingerprint } from '../utils/systemFingerprint.util';

// Local type definitions
type AutoCheckOutTrigger = 'shutdown' | 'logout' | 'recovery' | 'background';

interface AutoCheckOutResult {
  success: boolean;
  trigger: AutoCheckOutTrigger;
  reason?: string;
  attendanceId?: string;
  timestamp: Date;
  errorCode?: string;
  errorType?: 'validation' | 'network' | 'authentication' | 'system';
}

interface EligibilityResult {
  eligible: boolean;
  reason?: string;
  alreadyCheckedOut?: boolean;
  notCheckedIn?: boolean;
  networkValid?: boolean;
}

interface CheckOutRequest {
  source: string;
  wifi?: {
    ssid: string;
    bssid?: string;
  };
  ethernet?: {
    macAddress: string;
  };
  systemFingerprint?: string;
  checkOutTime?: string; // ISO string - optional, for recovery check-outs at specific time
}

interface AttendanceRecord {
  id: string;
  employeeId: string;
  date: string;
  checkInTime: string;
  checkOutTime?: string;
  status: string;
  source: string;
  totalDuration?: number;
  createdAt: string;
  updatedAt: string;
}

class AutoCheckOutService {
  /**
   * Check eligibility for check-out
   */
  async checkEligibilityForCheckout(networkInfo?: NetworkInfo): Promise<EligibilityResult> {
    // 1. Check if auto check-out is enabled
    if (!configService.isAutoCheckoutOnShutdownEnabled()) {
      return {
        eligible: false,
        reason: 'Auto check-out is disabled',
      };
    }

    // 2. Verify user is authenticated
    const isAuthenticated = await sessionService.isAuthenticated();
    if (!isAuthenticated) {
      return {
        eligible: false,
        reason: 'User not authenticated',
      };
    }

    // 3. Check attendance status
    try {
      const status = await apiService.getAttendanceStatus();
      
      if (status.status === 'NOT_STARTED') {
        return {
          eligible: false,
          reason: 'Not checked in today',
          notCheckedIn: true,
        };
      }

      if (status.status === 'CHECKED_OUT') {
        return {
          eligible: false,
          reason: 'Already checked out today',
          alreadyCheckedOut: true,
        };
      }

      // User is checked in, eligible for check-out
      // Network validation is optional for check-out (backend may allow it)
      if (networkInfo && networkInfo.type === 'none') {
        // Still allow check-out attempt - backend may allow offline check-out
        return {
          eligible: true,
          networkValid: false,
        };
      }

      return {
        eligible: true,
        networkValid: networkInfo ? networkInfo.type !== 'none' : true,
      };
    } catch (error: any) {
      return {
        eligible: false,
        reason: `Failed to check attendance status: ${error.message || 'Unknown error'}`,
      };
    }
  }

  /**
   * Perform check-out with network info and system fingerprint
   */
  async performCheckout(
    trigger: AutoCheckOutTrigger,
    networkInfo?: NetworkInfo,
    useFastMode: boolean = false,
    checkOutTime?: Date // Optional - for recovery check-outs at specific time
  ): Promise<AttendanceRecord> {
    console.log(`[AutoCheckOutService] Executing check-out for trigger: ${trigger}, fastMode: ${useFastMode}, checkOutTime: ${checkOutTime?.toISOString() || 'current'}`);
    
    const checkOutRequest: CheckOutRequest = {
      source: 'desktop',
      // If checkOutTime is provided (for recovery), use it; otherwise backend will use current time
      ...(checkOutTime && { checkOutTime: checkOutTime.toISOString() }),
    };

    // Get network info if not provided
    if (!networkInfo) {
      try {
        networkInfo = await getCurrentNetwork();
      } catch (error) {
        console.error('[AutoCheckOutService] Failed to get network info:', error);
        // Use cached network info as fallback
        const storage = storageService.getStorage();
        if (storage.lastNetworkUsed) {
          // Reconstruct network info from cached data
          if (storage.lastNetworkUsed.type === 'wifi') {
            networkInfo = {
              type: 'wifi',
              wifi: {
                ssid: storage.lastNetworkUsed.ssid || '',
                bssid: storage.lastNetworkUsed.bssid || null,
              },
            };
          } else if (storage.lastNetworkUsed.type === 'ethernet') {
            networkInfo = {
              type: 'ethernet',
              ethernet: {
                macAddress: storage.lastNetworkUsed.macAddress || '',
              },
            };
          }
        }
      }
    }

    let omitNetworkPayload = false;
    try {
      const session = await sessionService.getSessionFromRenderer();
      const u = session?.user as { allowCheckoutWithoutWifi?: boolean } | undefined;
      if (u?.allowCheckoutWithoutWifi === true) {
        omitNetworkPayload = true;
        console.log('[AutoCheckOutService] allowCheckoutWithoutWifi — omitting WiFi/Ethernet from auto check-out');
      }
    } catch {
      // fall through — attach network when available
    }

    // Add network information (backend skips validation when allowCheckoutWithoutWifi)
    if (!omitNetworkPayload && networkInfo) {
      if (networkInfo.type === 'wifi' && networkInfo.wifi) {
        checkOutRequest.wifi = {
          ssid: networkInfo.wifi.ssid,
          bssid: networkInfo.wifi.bssid || undefined,
        };
        console.log(`[AutoCheckOutService] Adding WiFi info - SSID: ${networkInfo.wifi.ssid}`);
      } else if (networkInfo.type === 'ethernet' && networkInfo.ethernet) {
        checkOutRequest.ethernet = {
          macAddress: networkInfo.ethernet.macAddress,
        };
        console.log(`[AutoCheckOutService] Adding Ethernet info - MAC: ${networkInfo.ethernet.macAddress}`);
      }
    }

    // Add system fingerprint (required for desktop)
    try {
      const fingerprint = await getSystemFingerprint();
      if (fingerprint && fingerprint.trim() !== '') {
        checkOutRequest.systemFingerprint = fingerprint;
        console.log('[AutoCheckOutService] System fingerprint generated successfully');
      } else {
        console.warn('[AutoCheckOutService] Generated fingerprint is empty');
        if (!useFastMode) {
          throw new Error('Failed to generate system fingerprint. Cannot mark attendance.');
        }
      }
    } catch (error) {
      console.error('[AutoCheckOutService] Failed to get system fingerprint:', error);
      if (!useFastMode) {
        throw new Error('Failed to generate system fingerprint. Cannot mark attendance.');
      }
    }

    try {
      console.log('[AutoCheckOutService] Calling check-out API...');
      const attendance = await apiService.checkOut(checkOutRequest);
      console.log(`[AutoCheckOutService] Check-out successful! Attendance ID: ${attendance.id}`);
      return attendance;
    } catch (error: any) {
      const errorMessage = error.message || error.response?.data?.error || 'Unknown error';
      const statusCode = error.statusCode || error.response?.status || 500;
      
      console.error(`[AutoCheckOutService] Check-out API call failed:`, {
        statusCode,
        errorMessage,
        networkType: networkInfo?.type,
        hasFingerprint: !!checkOutRequest.systemFingerprint,
        response: error.response?.data,
      });
      
      loggerService.logAttempt(`checkout_${trigger}`, 'failed', errorMessage, {
        statusCode,
        networkType: networkInfo?.type,
        hasFingerprint: !!checkOutRequest.systemFingerprint,
      });

      const enhancedError: any = new Error(errorMessage);
      enhancedError.statusCode = statusCode;
      enhancedError.originalError = error;
      throw enhancedError;
    }
  }

  /**
   * Attempt check-out with error handling
   */
  async attemptCheckout(
    trigger: AutoCheckOutTrigger,
    useFastMode: boolean = false,
    networkInfo?: NetworkInfo,
    checkOutTime?: Date // Optional - for recovery check-outs at specific time
  ): Promise<AutoCheckOutResult> {
    console.log(`[AutoCheckOutService] Attempting check-out - trigger: ${trigger}, fastMode: ${useFastMode}, checkOutTime: ${checkOutTime?.toISOString() || 'current'}`);
    
    const result: AutoCheckOutResult = {
      success: false,
      trigger,
      timestamp: new Date(),
    };

    try {
      // Check eligibility - verify user is actually checked in and can check out
      const eligibility = await this.checkEligibilityForCheckout(networkInfo);
      if (!eligibility.eligible) {
        result.reason = eligibility.reason || 'Eligibility check failed';
        console.log(`[AutoCheckOutService] Eligibility check failed: ${result.reason}`);
        
        // If already checked out or not checked in, don't log as failure - it's expected
        if (eligibility.alreadyCheckedOut || eligibility.notCheckedIn) {
          result.success = false; // Not an error, just not eligible
          return result;
        }
        
        loggerService.logAttempt(`checkout_${trigger}`, 'failed', result.reason, { eligibility });
        return result;
      }

      console.log('[AutoCheckOutService] Eligibility check passed. Proceeding with check-out...');
      
      // Perform check-out (pass checkOutTime if provided for recovery)
      const attendance = await this.performCheckout(trigger, networkInfo, useFastMode, checkOutTime);

      // Success!
      result.success = true;
      result.attendanceId = attendance.id;

      // Store check-out info
      storageService.setLastCheckOutAttempt(new Date(), attendance.id);

      // Store network info (only if not 'none')
      let networkInfoToStore: {
        type: 'wifi' | 'ethernet';
        ssid?: string;
        bssid?: string;
        macAddress?: string;
      } | undefined;

      if (networkInfo && networkInfo.type !== 'none') {
        if (networkInfo.type === 'wifi' && networkInfo.wifi) {
          networkInfoToStore = {
            type: 'wifi',
            ssid: networkInfo.wifi.ssid,
            bssid: networkInfo.wifi.bssid || undefined,
          };
        } else if (networkInfo.type === 'ethernet' && networkInfo.ethernet) {
          networkInfoToStore = {
            type: 'ethernet',
            macAddress: networkInfo.ethernet.macAddress,
          };
        }
      }

      if (networkInfoToStore) {
        storageService.updateStorage({
          lastNetworkUsed: networkInfoToStore,
        });
      }

      // Update session state - mark check-out completed
      try {
        const fingerprint = await getSystemFingerprint();
        storageService.saveSessionState({
          lastCheckOutTimestamp: new Date(),
          lastNetworkInfo: networkInfoToStore,
          systemFingerprint: fingerprint || undefined,
          pendingCheckout: false,
        });
      } catch (error) {
        console.error('[AutoCheckOutService] Failed to save session state:', error);
      }

      // Log success
      loggerService.logAttempt(`checkout_${trigger}`, 'success', undefined, {
        attendanceId: attendance.id,
        networkType: networkInfo?.type,
      });

      // Show success notification
      if (configService.areCheckoutNotificationsEnabled()) {
        const networkName =
          networkInfo?.type === 'wifi'
            ? networkInfo.wifi?.ssid || 'Office Wi-Fi'
            : 'Office Network';
        this.showNotification(
          'Check-out Successful',
          `You have been checked out successfully (${networkName})`,
          'success'
        );
      }

      return result;
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error during check-out';
      const statusCode = error.statusCode || error.response?.status || 500;
      
      let errorCode: string | undefined;
      if (error.response?.data?.errorCode) {
        errorCode = error.response.data.errorCode;
      } else {
        const messageUpper = errorMessage.toUpperCase();
        if (messageUpper.includes('NOT CHECKED IN')) errorCode = 'NOT_CHECKED_IN';
        else if (messageUpper.includes('ALREADY CHECKED OUT')) errorCode = 'ALREADY_CHECKED_OUT';
        else if (messageUpper.includes('CANNOT PERFORM') || messageUpper.includes('CURRENT ATTENDANCE STATUS')) {
          // This usually means already checked out or invalid status
          errorCode = 'INVALID_STATUS';
        }
        else if (messageUpper.includes('NETWORK') || messageUpper.includes('WIFI')) errorCode = 'NETWORK_NOT_APPROVED';
        else if (messageUpper.includes('DEVICE') || messageUpper.includes('FINGERPRINT')) errorCode = 'DEVICE_FINGERPRINT_REQUIRED';
      }

      const errorType = this.getErrorType(errorCode, errorMessage);

      result.reason = this.getUserFriendlyMessage(errorCode || '', errorMessage);
      result.errorCode = errorCode;
      result.errorType = errorType;
      
      // If error is due to invalid status (already checked out, etc.), don't treat as failure
      // This can happen if status changed between check and actual check-out
      if (errorCode === 'INVALID_STATUS' || errorCode === 'ALREADY_CHECKED_OUT') {
        console.log(`[AutoCheckOutService] Check-out not needed: ${errorMessage}`);
        result.reason = 'Already checked out or invalid status';
        return result;
      }

      loggerService.logAttempt(`checkout_${trigger}`, 'failed', result.reason, {
        errorCode,
        errorType,
        statusCode,
        originalError: error.toString(),
      });

      // Show error notification
      if (configService.areCheckoutNotificationsEnabled() && errorType !== 'authentication') {
        this.showNotification(
          'Check-out Failed',
          result.reason,
          'error'
        );
      }

      return result;
    }
  }

  /**
   * Get user-friendly message based on error code
   */
  private getUserFriendlyMessage(errorCode: string, defaultMessage: string): string {
    const errorMessages: Record<string, string> = {
      'NOT_CHECKED_IN': 'You are not checked in. Cannot check out.',
      'ALREADY_CHECKED_OUT': 'You have already checked out for today.',
      'INVALID_STATUS': 'Cannot check out in your current attendance status. You may already be checked out.',
      'NETWORK_NOT_APPROVED': 'The network you are connected to is not approved for attendance.',
      'DEVICE_FINGERPRINT_REQUIRED': 'Device identification is required. Please restart the application and try again.',
    };

    return errorMessages[errorCode] || defaultMessage;
  }

  /**
   * Determine error type from error code or message
   */
  private getErrorType(errorCode?: string, message?: string): 'validation' | 'network' | 'authentication' | 'system' {
    if (!errorCode && !message) {
      return 'system';
    }

    const errorStr = (errorCode || message || '').toUpperCase();

    if (errorStr.includes('NETWORK') || errorStr.includes('WIFI') || errorStr.includes('ETHERNET')) {
      return 'network';
    }

    if (errorStr.includes('AUTH') || errorStr.includes('UNAUTHORIZED') || errorStr.includes('TOKEN')) {
      return 'authentication';
    }

    if (
      errorStr.includes('NOT CHECKED IN') ||
      errorStr.includes('ALREADY CHECKED OUT') ||
      errorStr.includes('VALIDATION')
    ) {
      return 'validation';
    }

    return 'system';
  }

  /**
   * Show notification
   */
  private showNotification(title: string, body: string, type: 'success' | 'error' | 'warning' = 'success'): void {
    try {
      if (!Notification.isSupported()) {
        console.warn('[AutoCheckOutService] Notifications not supported');
        return;
      }

      const notification = new Notification({
        title,
        body,
        silent: type === 'success', // Silent for success, sound for errors/warnings
      });

      notification.show();
    } catch (error) {
      console.error('[AutoCheckOutService] Failed to show notification:', error);
    }
  }
}

export const autoCheckOutService = new AutoCheckOutService();

