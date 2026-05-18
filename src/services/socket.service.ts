/**
 * Socket.IO Service - Real-time communication
 */

import { io, Socket } from 'socket.io-client';
import { config } from '@/config';
import { authStore } from '@/store/authStore';
import {
  AttendanceSocketEnvelope,
  DashboardRefreshEnvelope,
} from '@/features/attendance/types/attendance-socket';

class SocketService {
  private socket: Socket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  connect(): void {
    if (this.socket?.connected) {
      return;
    }

    const token = authStore.getState().accessToken;
    if (!token) {
      return;
    }

    const baseURL = config.api.baseURL.replace('/api/v1', '');

    this.socket = io(baseURL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: this.maxReconnectAttempts,
      reconnectionDelay: 1000,
    });

    this.socket.on('connect', () => {
      this.reconnectAttempts = 0;
    });

    this.socket.on('disconnect', () => {
      // no-op
    });

    this.socket.on('connect_error', () => {
      this.reconnectAttempts++;
    });

    this.socket.on('reconnect', () => {
      const currentToken = authStore.getState().accessToken;
      if (!currentToken) {
        this.disconnect();
      }
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  reconnect(): void {
    this.disconnect();
    this.connect();
  }

  onAttendanceUpdate(callback: (data: AttendanceSocketEnvelope) => void): void {
    if (!this.socket) return;
    this.socket.on('attendance:update', callback);
    this.socket.on('attendance:status', callback);
  }

  onDashboardRefresh(callback: (data: DashboardRefreshEnvelope) => void): void {
    if (!this.socket) return;
    this.socket.on('attendance:dashboard:refresh', callback);
  }

  onApprovalPending(callback: (data: AttendanceSocketEnvelope) => void): void {
    if (!this.socket) return;
    this.socket.on('attendance:approval:pending', callback);
  }

  offAttendanceUpdate(callback: (data: AttendanceSocketEnvelope) => void): void {
    if (!this.socket) return;
    this.socket.off('attendance:update', callback);
    this.socket.off('attendance:status', callback);
  }

  offDashboardRefresh(callback: (data: DashboardRefreshEnvelope) => void): void {
    if (!this.socket) return;
    this.socket.off('attendance:dashboard:refresh', callback);
  }

  offApprovalPending(callback: (data: AttendanceSocketEnvelope) => void): void {
    if (!this.socket) return;
    this.socket.off('attendance:approval:pending', callback);
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }
}

export const socketService = new SocketService();
