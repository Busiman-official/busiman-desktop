/**
 * API Service - Axios instance configuration
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { config } from '@/config';
import { authStore } from '@/store/authStore';
import { logger } from '@/shared/utils/logger';
import { isTransientNetworkError, isFatalRefreshAuthError } from '@/utils/authHttpErrors';
import type { RefreshTokenResponse } from '@/types';

/** Single in-flight refresh so concurrent 401s share one token rotation. */
let refreshPromise: Promise<RefreshTokenResponse> | null = null;

function runSharedRefresh(refreshToken: string): Promise<RefreshTokenResponse> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const { authService } = await import('./auth.service');
      return authService.refreshToken(refreshToken);
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

class ApiService {
  private instance: AxiosInstance;

  constructor() {
    this.instance = axios.create({
      baseURL: config.api.baseURL,
      timeout: config.api.timeout,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // Request interceptor - Add auth token
    this.instance.interceptors.request.use(
      (config) => {
        const token = authStore.getState().accessToken;
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        // For FormData, don't set Content-Type - browser will set it with boundary
        if (config.data instanceof FormData) {
          delete config.headers['Content-Type'];
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Response interceptor - Handle errors and token refresh
    this.instance.interceptors.response.use(
      (response) => {
        return response;
      },
      async (error: AxiosError) => {
        const originalRequest = error.config as any;

        // Don't retry refresh token endpoint - it would cause infinite loop
        const isRefreshEndpoint = originalRequest?.url?.includes('/auth/refresh');

        // Handle 401 Unauthorized
        if (error.response?.status === 401 && !originalRequest._retry && !isRefreshEndpoint) {
          originalRequest._retry = true;

          const { refreshToken, user } = authStore.getState();

          if (refreshToken && user) {
            try {
              const tokenData = await runSharedRefresh(refreshToken);

              authStore.getState().login(
                user,
                tokenData.accessToken,
                tokenData.refreshToken,
                tokenData.sessionId
              );

              originalRequest.headers.Authorization = `Bearer ${tokenData.accessToken}`;
              return this.instance(originalRequest);
            } catch (refreshError: unknown) {
              logger.error('[ApiService] Token refresh failed', refreshError, {
                message: refreshError instanceof Error ? refreshError.message : String(refreshError),
                transient: isTransientNetworkError(refreshError),
              });
              if (isTransientNetworkError(refreshError)) {
                return Promise.reject(refreshError);
              }
              if (isFatalRefreshAuthError(refreshError)) {
                authStore.getState().logout();
              }
              return Promise.reject(refreshError);
            }
          } else {
            authStore.getState().logout();
          }
        }

        if (error.response?.status === 401 && isRefreshEndpoint) {
          logger.error('[ApiService] Refresh token endpoint failed - logging out', error);
          if (!isTransientNetworkError(error)) {
            authStore.getState().logout();
          }
        }

        return Promise.reject(error);
      }
    );
  }

  public getInstance(): AxiosInstance {
    return this.instance;
  }
}

export const apiService = new ApiService();
export const api = apiService.getInstance();

