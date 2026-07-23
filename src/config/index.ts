// Production API URL — hardcoded so packaged builds always hit Fly.io regardless of .env at build time.
const PRODUCTION_API_BASE_URL = 'https://busiman-server-2.fly.dev/api/v1';

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