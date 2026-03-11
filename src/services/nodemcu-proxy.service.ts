/**
 * NodeMCU Proxy Service - API calls for NodeMCU proxy management (Admin only)
 */

import { api } from './api';
import { NodeMCUProxy } from '@/types';
import { extractApiData } from '@/utils/api';

class NodeMCUProxyService {
  async getAll(): Promise<NodeMCUProxy[]> {
    const response = await api.get('/nodemcu-proxy');
    const data = extractApiData<NodeMCUProxy[]>(response);
    return Array.isArray(data) ? data : [];
  }

  async register(
    nodeMCUId: string,
    secret: string,
    displayName?: string
  ): Promise<{ nodeMCUId: string; displayName?: string }> {
    const response = await api.post('/nodemcu-proxy/register', {
      nodeMCUId,
      secret,
      displayName: displayName || undefined,
    });
    return extractApiData<{ nodeMCUId: string; displayName?: string }>(response);
  }

  async deactivate(nodeMCUId: string): Promise<void> {
    await api.delete(`/nodemcu-proxy/${encodeURIComponent(nodeMCUId)}`);
  }
}

export const nodemcuProxyService = new NodeMCUProxyService();
