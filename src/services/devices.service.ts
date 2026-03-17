/**
 * Edge Devices Service - API calls for unified edge device registry (Admin only)
 */

import { api } from './api';
import { EdgeDevice } from '@/types';
import { extractApiData } from '@/utils/api';

export type RegisterEdgeDevicePayload = {
  deviceId: string;
  secret: string;
  displayName?: string;
  deviceType?: 'esp8266' | 'esp32' | 'unknown';
  capabilities?: { proxy?: boolean; gateBeacon?: boolean; gateAudio?: boolean };
  meta?: { branchId?: string; locationId?: string };
};

export type UpdateEdgeDevicePayload = {
  displayName?: string;
  deviceType?: 'esp8266' | 'esp32' | 'unknown';
  capabilities?: { proxy?: boolean; gateBeacon?: boolean; gateAudio?: boolean };
  isActive?: boolean;
  meta?: { branchId?: string; locationId?: string };
};

class DevicesService {
  async getAll(): Promise<EdgeDevice[]> {
    const response = await api.get('/devices');
    const data = extractApiData<EdgeDevice[]>(response);
    return Array.isArray(data) ? data : [];
  }

  async register(payload: RegisterEdgeDevicePayload): Promise<{ deviceId: string; displayName?: string }> {
    const response = await api.post('/devices/register', payload);
    return extractApiData<{ deviceId: string; displayName?: string }>(response);
  }

  async update(deviceId: string, payload: UpdateEdgeDevicePayload): Promise<EdgeDevice> {
    const response = await api.patch(`/devices/${encodeURIComponent(deviceId)}`, payload);
    return extractApiData<EdgeDevice>(response);
  }

  async rotateSecret(deviceId: string): Promise<{ deviceId: string; secret: string }> {
    const response = await api.post(`/devices/${encodeURIComponent(deviceId)}/rotate-secret`);
    return extractApiData<{ deviceId: string; secret: string }>(response);
  }
}

export const devicesService = new DevicesService();

