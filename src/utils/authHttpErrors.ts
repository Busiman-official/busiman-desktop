/**
 * Classify Axios failures for auth flows — do not treat transient network as session loss.
 */

import type { AxiosError } from 'axios';

const NETWORK_CODES = new Set([
  'ERR_NETWORK',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ECONNABORTED',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'EAI_AGAIN',
]);

export function isTransientNetworkError(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false;
  const ax = error as AxiosError;
  const code = (ax as { code?: string }).code;
  if (code && NETWORK_CODES.has(code)) return true;
  if (ax.request && !ax.response) return true;
  const msg = String((error as Error).message || '').toLowerCase();
  if (
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('connection') ||
    msg.includes('failed to fetch')
  ) {
    return true;
  }
  return false;
}

/** Refresh (or auth) failed in a way that should clear local session. */
export function isFatalRefreshAuthError(error: unknown): boolean {
  if (isTransientNetworkError(error)) return false;
  if (error instanceof Error && /no refresh token/i.test(error.message)) return true;
  const ax = error as AxiosError;
  const status = ax.response?.status;
  return status === 401 || status === 403 || status === 404;
}
