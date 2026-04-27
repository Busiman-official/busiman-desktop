/**
 * Non-blocking offline indicator; when the browser goes back online, attempt silent token refresh.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { authStore } from '@/store/authStore';
import './OfflineConnectivityBanner.css';

export const OfflineConnectivityBanner: React.FC = () => {
  const [online, setOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  const trySilentRefresh = useCallback(() => {
    const { isAuthenticated } = authStore.getState();
    if (isAuthenticated) {
      void authStore.getState().trySilentRefresh();
    } else {
      void authStore.getState().initializeAuth();
    }
  }, []);

  useEffect(() => {
    const onOffline = () => setOnline(false);
    const onOnline = () => {
      setOnline(true);
      trySilentRefresh();
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [trySilentRefresh]);

  if (online) return null;

  return (
    <div className="offline-connectivity-banner" role="status">
      You are offline. Your session is kept until you sign out. Actions will resume when the connection returns.
    </div>
  );
};
