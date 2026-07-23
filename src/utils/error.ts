/**
 * Error Handling Utilities
 * Centralized error extraction and formatting
 */

import { AxiosError } from 'axios';

export interface ApiError {
  message: string;
  status?: number;
  code?: string;
  data?: any;
}

/**
 * Extract user-friendly error message from various error types
 */
type ApiErrorBody = {
  message?: string;
  error?: string;
  errorCode?: string;
  data?: { message?: string };
};

export function getApiErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'response' in error) {
    const axiosError = error as AxiosError<ApiErrorBody>;
    return axiosError.response?.data?.errorCode;
  }
  return undefined;
}

/** Checkout/sale flows that should close the payment modal and show a blocking alert. */
export function isPosCheckoutBlockingError(error: unknown): boolean {
  const code = getApiErrorCode(error);
  if (code === 'INVENTORY_MOVEMENTS_FROZEN') return true;
  const msg = extractErrorMessage(error, '');
  return /session is closed/i.test(msg) || /counter session is closed/i.test(msg);
}

export function extractErrorMessage(error: unknown, defaultMessage: string = 'An error occurred'): string {
  // Axios errors
  if (error && typeof error === 'object' && 'response' in error) {
    const axiosError = error as AxiosError<ApiErrorBody>;
    
    // Check response data
    if (axiosError.response?.data) {
      const data = axiosError.response.data;
      
      // Try message field first
      if (data.message) {
        return data.message;
      }
      
      // Try error field
      if (data.error) {
        return data.error;
      }
      
      // Try nested data.message
      if (data.data?.message) {
        return data.data.message;
      }
    }
    
    // Check status code for common errors
    const status = axiosError.response?.status;
    if (status === 401) {
      return 'Your session has expired. Please log in again.';
    }
    if (status === 403) {
      return 'You do not have permission to perform this action.';
    }
    if (status === 404) {
      return 'The requested resource was not found.';
    }
    if (status === 500) {
      return 'Server error. Please try again later.';
    }
  }
  
  // Error objects with message
  if (error && typeof error === 'object' && 'message' in error) {
    const errorMessage = String((error as Error).message);
    
    // Clean up technical error messages
    return errorMessage
      .replace(/^Request failed with status code \d+$/i, '')
      .replace(/^Error: /i, '')
      .replace(/^AppError: /i, '')
      .replace(/^AxiosError: /i, '')
      .replace(/Network Error/i, 'Unable to connect to the server. Please check your internet connection.')
      .replace(/timeout/i, 'The request took too long. Please try again.')
      .replace(/ECONNREFUSED/i, 'Cannot connect to the server. Please ensure the server is running.')
      .trim() || defaultMessage;
  }
  
  // String errors
  if (typeof error === 'string') {
    return error;
  }
  
  return defaultMessage;
}

/**
 * Extract full error information
 */
export function extractError(error: unknown): ApiError {
  const message = extractErrorMessage(error);
  
  if (error && typeof error === 'object' && 'response' in error) {
    const axiosError = error as AxiosError;
    return {
      message,
      status: axiosError.response?.status,
      code: axiosError.code,
      data: axiosError.response?.data,
    };
  }
  
  return { message };
}

/**
 * Check if error is a network error
 */
export function isNetworkError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as Error).message).toLowerCase();
    return message.includes('network') || message.includes('econnrefused') || message.includes('timeout');
  }
  return false;
}

/**
 * Check if error is an authentication error
 */
export function isAuthError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'response' in error) {
    const axiosError = error as AxiosError;
    return axiosError.response?.status === 401 || axiosError.response?.status === 403;
  }
  return false;
}
