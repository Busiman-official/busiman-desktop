/**
 * Profile Service - API calls for profile management
 */

import { api } from './api';
import { User } from '@/types';
import { extractApiData } from '@/utils/api';

export interface UpdateProfileRequest {
  name?: string;
  phoneNumber?: string;
  address?: string;
  employeeId?: string;
  designation?: string;
  dateOfJoining?: string;
  dateOfBirth?: string;
  emergencyContact?: {
    name?: string;
    phone?: string;
    relationship?: string;
  };
  bio?: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

class ProfileService {
  /**
   * Get current user profile
   */
  async getProfile(): Promise<User> {
    const response = await api.get('/profile');
    return extractApiData(response);
  }

  /**
   * Update profile
   */
  async updateProfile(request: UpdateProfileRequest): Promise<User> {
    const response = await api.put('/profile', request);
    return extractApiData(response);
  }

  /**
   * Change password
   */
  async changePassword(request: ChangePasswordRequest): Promise<void> {
    await api.post('/profile/password', request);
  }

  /**
   * Set (or clear, when branchId is null) the admin's active branch.
   */
  async setActiveBranch(branchId: string | null): Promise<User> {
    const response = await api.patch('/profile/active-branch', { branchId });
    return extractApiData(response);
  }
}

export const profileService = new ProfileService();

