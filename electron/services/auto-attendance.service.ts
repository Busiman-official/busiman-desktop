/**
 * Auto Attendance Service - Core logic for auto check-in
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
type AutoCheckInTrigger = 'app_start' | 'login' | 'network_change' | 'system_wake';

interface AutoCheckInResult {
  success: boolean;
  trigger: AutoCheckInTrigger;
  reason?: string;
  attendanceId?: string;
  timestamp: Date;
  errorCode?: string;
  errorType?: 'validation' | 'network' | 'authentication' | 'system';
}

interface EligibilityResult {
  eligible: boolean;
  reason?: string;
  alreadyCheckedIn?: boolean;
  shiftAssigned?: boolean;
  isWorkingDay?: boolean;
  withinTimeWindow?: boolean;
  autoCheckInEnabled?: boolean;
  networkValid?: boolean;
}

interface CheckInRequest {
  source: string;
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

// Debounce period: 30 seconds (30000 ms) - prevents rapid duplicate triggers but allows retries
const DEBOUNCE_PERIOD_MS = 30 * 1000;

class AutoAttendanceService {
  /**
   * Pre-check eligibility before attempting check-in
   */
  async preCheckEligibility(networkInfo: NetworkInfo): Promise<EligibilityResult> {
    // 1. Check if auto check-in is enabled
    if (!configService.isAutoCheckInEnabled()) {
      return {
        eligible: false,
        reason: 'Auto check-in is disabled',
        autoCheckInEnabled: false,
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

    // 3. Check if already checked in today
    try {
      const status = await apiService.getAttendanceStatus();
      if (status.status !== 'NOT_STARTED') {
        return {
          eligible: false,
          reason: 'Already checked in today',
          alreadyCheckedIn: true,
        };
      }

      // Status response doesn't explicitly tell us about shift assignment,
      // but if we can get status, it means user has a shift assigned
      // Backend will validate shift rules during check-in
    } catch (error: any) {
      // Handle connection errors gracefully
      if (error.isConnectionError || error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
        console.warn('[AutoAttendanceService] Server connection failed - server may not be running');
        return {
          eligible: false,
          reason: 'Server connection failed. Please ensure the server is running.',
        };
      }
      // If status check fails for other reasons, we can't proceed
      return {
        eligible: false,
        reason: `Failed to check attendance status: ${error.message || 'Unknown error'}`,
      };
    }

    // 3b. HR may allow check-in without approved office network (desktop policy)
    try {
      const session = await sessionService.getSessionFromRenderer();
      const u = session.user as { allowCheckinWithoutWifi?: boolean } | undefined;
      if (u?.allowCheckinWithoutWifi === true) {
        console.log('[AutoAttendanceService] allowCheckinWithoutWifi — skipping network pre-check');
        return {
          eligible: true,
          shiftAssigned: true,
          isWorkingDay: true,
          withinTimeWindow: true,
          autoCheckInEnabled: true,
          networkValid: true,
        };
      }
    } catch {
      // ignore — fall through to network validation
    }

    // 4. Verify network is valid
    if (networkInfo.type === 'none') {
      return {
        eligible: false,
        reason: 'No network connection',
        networkValid: false,
      };
    }

    try {
      const validationRequest: any = {};
      if (networkInfo.type === 'wifi' && networkInfo.wifi) {
        validationRequest.ssid = networkInfo.wifi.ssid;
        if (networkInfo.wifi.bssid) {
          validationRequest.bssid = networkInfo.wifi.bssid;
        }
      } else if (networkInfo.type === 'ethernet' && networkInfo.ethernet) {
        validationRequest.macAddress = networkInfo.ethernet.macAddress;
      }

      const networkValidation = await apiService.validateNetwork(validationRequest);
      if (!networkValidation.allowed) {
        return {
          eligible: false,
          reason: networkValidation.reason || 'Network not approved for attendance',
          networkValid: false,
        };
      }
    } catch (error: any) {
      return {
        eligible: false,
        reason: `Failed to validate network: ${error.message || 'Unknown error'}`,
        networkValid: false,
      };
    }

      // All checks passed
      console.log('[AutoAttendanceService] Network validation passed - network is allowed');
      return {
        eligible: true,
        shiftAssigned: true,
        isWorkingDay: true, // Backend will validate this
        withinTimeWindow: true, // Backend will validate this
        autoCheckInEnabled: true,
        networkValid: true,
      };
    }

  /**
   * Execute check-in
   */
  async executeCheckIn(trigger: AutoCheckInTrigger, networkInfo: NetworkInfo): Promise<AttendanceRecord> {
    console.log(`[AutoAttendanceService] Executing check-in for trigger: ${trigger}`);
    
    const checkInRequest: CheckInRequest = {
      source: 'desktop',
    };

    // Add network information
    if (networkInfo.type === 'wifi' && networkInfo.wifi) {
      checkInRequest.wifi = {
        ssid: networkInfo.wifi.ssid,
        bssid: networkInfo.wifi.bssid || undefined,
      };
      console.log(`[AutoAttendanceService] Adding WiFi info - SSID: ${networkInfo.wifi.ssid}`);
    } else if (networkInfo.type === 'ethernet' && networkInfo.ethernet) {
      checkInRequest.ethernet = {
        macAddress: networkInfo.ethernet.macAddress,
      };
      console.log(`[AutoAttendanceService] Adding Ethernet info - MAC: ${networkInfo.ethernet.macAddress}`);
    }

    // Add system fingerprint (required for desktop)
    try {
      const fingerprint = await getSystemFingerprint();
      if (fingerprint && fingerprint.trim() !== '') {
        checkInRequest.systemFingerprint = fingerprint;
        console.log('[AutoAttendanceService] System fingerprint generated successfully');
      } else {
        console.warn('[AutoAttendanceService] Generated fingerprint is empty');
      }
    } catch (error) {
      console.error('[AutoAttendanceService] Failed to get system fingerprint:', error);
      // In development, allow check-in without fingerprint (backend will handle gracefully)
      if (process.env.NODE_ENV === 'development') {
        console.warn('[AutoAttendanceService] Continuing without fingerprint in development mode');
      } else {
        throw new Error('Failed to generate system fingerprint. Cannot mark attendance.');
      }
    }

    try {
      console.log('[AutoAttendanceService] Calling check-in API...');
      const attendance = await apiService.checkIn(checkInRequest);
      console.log(`[AutoAttendanceService] Check-in successful! Attendance ID: ${attendance.id}`);
      return attendance;
    } catch (error: any) {
      // Log the error with more context
      const errorMessage = error.message || error.response?.data?.error || 'Unknown error';
      const statusCode = error.statusCode || error.response?.status || 500;
      
      console.error(`[AutoAttendanceService] Check-in API call failed:`, {
        statusCode,
        errorMessage,
        networkType: networkInfo.type,
        hasFingerprint: !!checkInRequest.systemFingerprint,
        response: error.response?.data,
      });
      
      loggerService.logAttempt(trigger, 'failed', errorMessage, {
        statusCode,
        networkType: networkInfo.type,
        hasFingerprint: !!checkInRequest.systemFingerprint,
      });

      // Re-throw with more context
      const enhancedError: any = new Error(errorMessage);
      enhancedError.statusCode = statusCode;
      enhancedError.originalError = error;
      throw enhancedError;
    }
  }

  /**
   * Check if we should skip this attempt (debouncing only)
   * Note: We don't check if already checked in here - that's done via API in preCheckEligibility
   */
  private shouldSkipAttempt(trigger: AutoCheckInTrigger): boolean {
    const lastAttempt = storageService.getLastTriggerAttempt(trigger);
    if (!lastAttempt) {
      return false;
    }

    const now = new Date();
    const timeSinceLastAttempt = now.getTime() - lastAttempt.getTime();

    // Skip if last attempt was within debounce period (5 minutes)
    // This prevents spam from rapid triggers, but actual check-in status is checked via API
    if (timeSinceLastAttempt < DEBOUNCE_PERIOD_MS) {
      console.log(`[AutoAttendanceService] Skipping due to debounce (last attempt ${Math.round(timeSinceLastAttempt / 1000)}s ago)`);
      return true;
    }

    return false;
  }

  /**
   * Attempt auto check-in
   */
  async attemptAutoCheckIn(trigger: AutoCheckInTrigger): Promise<AutoCheckInResult> {
    console.log(`[AutoAttendanceService] Attempting auto check-in - trigger: ${trigger}`);
    
    const result: AutoCheckInResult = {
      success: false,
      trigger,
      timestamp: new Date(),
    };

    try {
      // Check if we should skip (debouncing only - prevents rapid duplicate attempts)
      // Note: We only store trigger attempt timestamp on SUCCESS, so failed attempts allow retries
      if (this.shouldSkipAttempt(trigger)) {
        result.reason = 'Skipped due to debouncing (recent successful attempt within 30 seconds)';
        console.log(`[AutoAttendanceService] Check-in skipped: ${result.reason}`);
        loggerService.logAttempt(trigger, 'skipped', result.reason);
        return result;
      }

      // Get current network
      console.log('[AutoAttendanceService] Getting current network info...');
      const networkInfo = await getCurrentNetwork();
      console.log(`[AutoAttendanceService] Network type: ${networkInfo.type}`);
      
      if (networkInfo.type === 'none') {
        result.reason = 'No network connection';
        console.log(`[AutoAttendanceService] Check-in failed: ${result.reason}`);
        loggerService.logAttempt(trigger, 'failed', result.reason);
        return result;
      }

      // Pre-check eligibility (this checks actual check-in status via API)
      console.log('[AutoAttendanceService] Checking eligibility...');
      const eligibility = await this.preCheckEligibility(networkInfo);
      if (!eligibility.eligible) {
        result.reason = eligibility.reason || 'Eligibility check failed';
        console.log(`[AutoAttendanceService] Eligibility check failed: ${result.reason}`);
        loggerService.logAttempt(trigger, 'failed', result.reason, { eligibility });
        // Don't update trigger attempt timestamp on failure - allows retries
        return result;
      }

      console.log('[AutoAttendanceService] Eligibility check passed. Proceeding with check-in...');
      
      // Execute check-in
      const attendance = await this.executeCheckIn(trigger, networkInfo);

      // Success!
      result.success = true;
      result.attendanceId = attendance.id;

      // Store check-in info - only update trigger attempt timestamp on SUCCESS
      // This ensures debouncing only applies to successful attempts, allowing retries after failures
      storageService.setLastCheckInAttempt(new Date(), attendance.id);
      storageService.setLastTriggerAttempt(trigger, new Date());

      // Store network info
      const networkInfoToStore = {
        type: networkInfo.type,
        ssid: networkInfo.wifi?.ssid,
        bssid: networkInfo.wifi?.bssid || undefined, // Convert null to undefined
        macAddress: networkInfo.ethernet?.macAddress,
      };
      
      storageService.updateStorage({
        lastNetworkUsed: networkInfoToStore,
      });

      // Store session state for check-out recovery
      try {
        const fingerprint = await getSystemFingerprint();
        storageService.saveSessionState({
          lastCheckInTimestamp: new Date(),
          lastNetworkInfo: networkInfoToStore,
          systemFingerprint: fingerprint || undefined,
          pendingCheckout: false,
        });
      } catch (error) {
        console.error('[AutoAttendanceService] Failed to save session state:', error);
      }

      // Log success
      loggerService.logAttempt(trigger, 'success', undefined, {
        attendanceId: attendance.id,
        networkType: networkInfo.type,
      });

      // Show success notification
      const networkName =
        networkInfo.type === 'wifi'
          ? networkInfo.wifi?.ssid || 'Office Wi-Fi'
          : 'Office Network';
      this.showNotification(
        'Attendance Marked',
        `You have been automatically checked in (${networkName} detected)`,
        'success'
      );

      return result;
    } catch (error: any) {
      // Extract error information
      const errorMessage = error.message || 'Unknown error during check-in';
      const statusCode = error.statusCode || error.response?.status || 500;
      
      // Try to extract error code from response
      let errorCode: string | undefined;
      if (error.response?.data?.errorCode) {
        errorCode = error.response.data.errorCode;
      } else {
        // Try to infer error code from message
        const messageUpper = errorMessage.toUpperCase();
        if (messageUpper.includes('TOO EARLY')) errorCode = 'TOO_EARLY';
        else if (messageUpper.includes('TOO LATE')) errorCode = 'TOO_LATE';
        else if (messageUpper.includes('NO SHIFT')) errorCode = 'NO_SHIFT_ASSIGNED';
        else if (messageUpper.includes('SHIFT INACTIVE')) errorCode = 'SHIFT_INACTIVE';
        else if (messageUpper.includes('DAY NOT ALLOWED')) errorCode = 'DAY_NOT_ALLOWED';
        else if (messageUpper.includes('HOLIDAY')) errorCode = 'HOLIDAY_NOT_ALLOWED';
        else if (messageUpper.includes('ALREADY CHECKED IN')) errorCode = 'ALREADY_CHECKED_IN';
        else if (messageUpper.includes('NETWORK') || messageUpper.includes('WIFI')) errorCode = 'NETWORK_NOT_APPROVED';
        else if (messageUpper.includes('DEVICE') || messageUpper.includes('FINGERPRINT')) errorCode = 'DEVICE_FINGERPRINT_REQUIRED';
      }

      // Determine error type
      const errorType = this.getErrorType(errorCode, errorMessage);

      // Get user-friendly message
      const userFriendlyMessage = this.getUserFriendlyMessage(errorCode || '', errorMessage);

      result.reason = userFriendlyMessage;
      result.errorCode = errorCode;
      result.errorType = errorType;

      // Log failure
      loggerService.logAttempt(trigger, 'failed', userFriendlyMessage, {
        errorCode,
        errorType,
        statusCode,
        originalError: error.toString(),
      });

      // Show error notification based on error type
      if (errorType === 'validation') {
        // Show validation errors (shift rules, time windows, etc.)
        this.showNotification(
          'Check-In Failed',
          userFriendlyMessage,
          'error'
        );
      } else if (errorType === 'network') {
        // Show network errors
        this.showNotification(
          'Network Error',
          userFriendlyMessage,
          'error'
        );
      } else if (errorType === 'authentication') {
        // Authentication errors - don't show notification, user needs to login
        console.warn('[AutoAttendanceService] Authentication error - user may need to login');
      } else {
        // System errors - show generic message
        this.showNotification(
          'Check-In Failed',
          'Unable to mark attendance. Please try again or contact support.',
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
      'NO_SHIFT_ASSIGNED': 'You do not have a shift assigned for today. Please contact your manager or HR to assign a shift.',
      'SHIFT_INACTIVE': 'Your assigned shift is currently inactive. Please contact your manager or HR for assistance.',
      'DAY_NOT_ALLOWED': 'You are not scheduled to work today. Please check your shift schedule.',
      'HOLIDAY_NOT_ALLOWED': 'Today is a holiday and your shift does not allow work on holidays. Please contact your manager if you need to work today.',
      'TOO_EARLY': 'It is too early to check in. Please check in during your assigned shift time window.',
      'TOO_LATE': 'It is too late to check in. Please contact your manager if you need to mark attendance.',
      'ALREADY_CHECKED_IN': 'You are already checked in for today.',
      'ALREADY_CHECKED_OUT': 'You have already checked out for today. Cannot check in again.',
      'WIFI_REQUIRED': 'WiFi or Ethernet connection is required for attendance. Please connect to an approved network.',
      'LOCATION_REQUIRED': 'Location information is required for attendance. Please enable location services.',
      'DEVICE_FINGERPRINT_REQUIRED': 'Device identification is required. Please restart the application and try again.',
      'NETWORK_NOT_APPROVED': 'The network you are connected to is not approved for attendance. Please connect to an approved office network.',
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
      errorStr.includes('SHIFT') ||
      errorStr.includes('EARLY') ||
      errorStr.includes('LATE') ||
      errorStr.includes('DAY') ||
      errorStr.includes('HOLIDAY') ||
      errorStr.includes('ALREADY')
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
      // Check if notifications are supported
      if (!Notification.isSupported()) {
        console.warn('[AutoAttendanceService] Notifications not supported');
        return;
      }

      // Only show notifications if enabled
      if (!configService.areNotificationsEnabled() && type !== 'error') {
        return;
      }

      const notification = new Notification({
        title,
        body,
        silent: type === 'success', // Silent for success, sound for errors/warnings
      });

      notification.show();
    } catch (error) {
      console.error('[AutoAttendanceService] Failed to show notification:', error);
    }
  }
}

export const autoAttendanceService = new AutoAttendanceService();

