/**
 * Authentication Service
 */

import axios from 'axios';
import { api } from './api';
import { config } from '@/config';
import { LoginRequest, LoginResponse, RefreshTokenResponse } from '@/types';
import { extractApiData } from '@/utils/api';
import type { ApiResponse } from '@/utils/api';

export class AuthService {
  /**
   * Login user
   */
  async login(credentials: LoginRequest): Promise<LoginResponse> {
    try {
      const response = await api.post<{ success: boolean; data: LoginResponse; message: string }>('/auth/login', credentials);
      const loginData = extractApiData<LoginResponse>(response);

      if (!loginData || !loginData.user || !loginData.accessToken) {
        throw new Error('Invalid response format from server');
      }

      return loginData;
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * Refresh access token using a bare Axios call (no api interceptors) to avoid
   * refresh → 401 → interceptor → refresh recursion.
   */
  async refreshToken(refreshToken: string): Promise<RefreshTokenResponse> {
    const response = await axios.post<ApiResponse<RefreshTokenResponse>>(
      `${config.api.baseURL}/auth/refresh`,
      { refreshToken },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: config.api.timeout,
      }
    );
    const tokenData = extractApiData<RefreshTokenResponse>(response);
    if (!tokenData?.accessToken || !tokenData?.refreshToken) {
      throw new Error('Invalid response format from server');
    }
    return tokenData;
  }

  /**
   * Get current user
   */
  async getCurrentUser() {
    const response = await api.get<{ success: boolean; data: any }>('/auth/me');
    return extractApiData(response);
  }

  /**
   * Logout user
   */
  async logout(): Promise<void> {
    try {
      await api.post('/auth/logout');
    } catch (error: any) {
      // Don't throw - logout should always succeed locally even if server call fails
      throw error;
    }
  }
}

export const authService = new AuthService();

