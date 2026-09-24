// Production API URL — hardcoded so packaged builds always hit the real backend regardless of
// .env at build time. Production moved from Fly.io to AWS (api.busiman.org) — every packaged
// build before this fix was still pointed at the old, abandoned Fly.io app.
const PRODUCTION_API_BASE_URL = 'https://api.busiman.org/api/v1';

export const config = {
  api: {
    baseURL: import.meta.env.DEV
      ? (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api/v1')
      : PRODUCTION_API_BASE_URL,
    timeout: 30000,
  },
  app: {
    name: 'Busiman Desktop',
    version: '1.0.0',
  },
  updates: {
    serverUrl: import.meta.env.VITE_UPDATE_SERVER_URL || 'https://your-update-server.com/updates/',
    checkInterval: 3600000, // Check every hour (1 hour in milliseconds)
  },
};