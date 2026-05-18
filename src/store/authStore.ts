/**
 * Authentication Store - Zustand
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { AuthState, User, UserRole } from '@/types';
import { authService } from '@/services/auth.service';
import { logger } from '@/shared/utils/logger';
import { branchContextStore } from './branchContextStore';
import { isTransientNetworkError } from '@/utils/authHttpErrors';
import { socketService } from '@/services/socket.service';

interface AuthStore extends AuthState {
  login: (user: User, accessToken: string, refreshToken: string, sessionId?: string) => void;
  logout: () => void;
  setUser: (user: User) => void;
  hasRole: (role: UserRole) => boolean;
  hasAnyRole: (roles: UserRole[]) => boolean;
  initializeAuth: () => Promise<void>;
  /** After connectivity returns — refresh tokens without full init spinner or clearing state on network blips. */
  trySilentRefresh: () => Promise<void>;
  isInitializing: boolean;
}

export const authStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isInitializing: true,

      login: (user: User, accessToken: string, refreshToken: string, sessionId?: string) => {
        set({
          user,
          accessToken,
          refreshToken,
          isAuthenticated: true,
          isInitializing: false,
        });

        socketService.reconnect();

        // Trigger auto check-in on login success
        if (window.electronAPI?.triggerAutoCheckInOnLogin) {
          window.electronAPI.triggerAutoCheckInOnLogin().catch((error) => {
            logger.error('[AuthStore] Failed to trigger auto check-in on login', error);
          });
        }

        // Auto-start proxy server on login if user prefers it
        if (window.electronAPI?.autoStartProxyIfDesired) {
          window.electronAPI.autoStartProxyIfDesired().catch((error) => {
            logger.error('[AuthStore] Failed to auto-start proxy on login', error);
          });
        }
      },

      initializeAuth: async () => {
        set({ isInitializing: true });
        const { refreshToken, user } = get();
        
        if (!refreshToken || !user) {
          logger.debug('[AuthStore] No refresh token or user, skipping auth initialization');
          set({ isAuthenticated: false, isInitializing: false });
          return;
        }

        try {
          logger.debug('[AuthStore] Attempting to refresh token on initialization...');
          // Try to refresh token to validate session
          const tokenData = await authService.refreshToken(refreshToken);
          
          logger.info('[AuthStore] Token refreshed successfully');
          set({
            accessToken: tokenData.accessToken,
            refreshToken: tokenData.refreshToken,
            isAuthenticated: true,
            isInitializing: false,
          });

          socketService.reconnect();

          // Trigger auto check-in after successful auth initialization
          if (window.electronAPI?.triggerAutoCheckInOnAuthInit) {
            window.electronAPI.triggerAutoCheckInOnAuthInit().catch((error) => {
              logger.error('[AuthStore] Failed to trigger auto check-in on auth init', error);
            });
          }

          // Auto-start proxy server after auth initialization if user prefers it
          if (window.electronAPI?.autoStartProxyIfDesired) {
            window.electronAPI.autoStartProxyIfDesired().catch((error) => {
              logger.error('[AuthStore] Failed to auto-start proxy on auth init', error);
            });
          }
        } catch (error: unknown) {
          logger.error('[AuthStore] Failed to refresh token on initialization', error, {
            message: error instanceof Error ? error.message : String(error),
            transient: isTransientNetworkError(error),
          });

          if (isTransientNetworkError(error)) {
            set({
              isAuthenticated: true,
              isInitializing: false,
            });
            return;
          }

          set({
            user: null,
            accessToken: null,
            refreshToken: null,
            isAuthenticated: false,
            isInitializing: false,
          });
        }
      },

      trySilentRefresh: async () => {
        const { refreshToken, user } = get();
        if (!refreshToken || !user) return;
        try {
          const tokenData = await authService.refreshToken(refreshToken);
          set({
            accessToken: tokenData.accessToken,
            refreshToken: tokenData.refreshToken,
            isAuthenticated: true,
          });

          socketService.reconnect();
        } catch (error: unknown) {
          if (isTransientNetworkError(error)) return;
          set({
            user: null,
            accessToken: null,
            refreshToken: null,
            isAuthenticated: false,
          });
        }
      },

      logout: async () => {
        // Always clear local state, even if server call fails
        // This ensures user can always logout locally
        const clearState = () => {
          set({
            user: null,
            accessToken: null,
            refreshToken: null,
            isAuthenticated: false,
          });

          socketService.disconnect();

          // Clear branch context
          branchContextStore.getState().clearContext();
          
          // Clear React Query cache if available
          try {
            const { useQueryClient } = require('@tanstack/react-query');
            // Note: This won't work directly in Zustand store
            // Query client should be cleared in component that calls logout
          } catch {
            // React Query not available, skip
          }
        };

        try {
          // Try to notify server, but don't fail if it doesn't work
          const { accessToken } = get();
          if (accessToken) {
            await authService.logout();
          }
        } catch (error: any) {
          // Ignore server logout errors - always allow local logout
        } finally {
          // Always clear local state
          clearState();
        }
      },

      setUser: (user: User) => {
        set({ user });
      },

      hasRole: (role: UserRole) => {
        const { user } = get();
        return user?.role === role;
      },

      hasAnyRole: (roles: UserRole[]) => {
        const { user } = get();
        return user ? roles.includes(user.role) : false;
      },
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
        // Don't persist isInitializing
      }),
    }
  )
);

