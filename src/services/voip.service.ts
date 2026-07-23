/**
 * VoIP API service (FreePBX extension helpers)
 */

import { api } from './api';
import { extractApiData } from '@/utils/api';

export interface VoipConfigStatus {
  configured: boolean;
  serverHost?: string;
  serverPort?: number;
  extensionRangeStart?: number;
  extensionRangeEnd?: number;
}

export interface NextExtensionResponse {
  suggestedExtension: string;
  rangeStart: number;
  rangeEnd: number;
  voipConfigured: boolean;
}

class VoipService {
  async getConfigStatus(): Promise<VoipConfigStatus> {
    const response = await api.get('/voip/config-status');
    return extractApiData<VoipConfigStatus>(response);
  }

  async getNextExtension(): Promise<NextExtensionResponse> {
    const response = await api.get('/voip/next-extension');
    return extractApiData<NextExtensionResponse>(response);
  }
}

export const voipService = new VoipService();
