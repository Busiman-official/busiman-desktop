/**
 * Company Service - API calls for global company profile
 */

import { api } from './api';
import { extractApiData } from '@/utils/api';

export interface CompanyProfile {
  displayName: string;
  legalName?: string;
  website?: string;
  supportEmail?: string;
  supportPhone?: string;
  address?: string;
  timezone?: string;
  gstNumber?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankName?: string;
  bankBranch?: string;
  bankIfsc?: string;
  logoUrl?: string | null;
  updatedAt?: string;
  updatedBy?: string;
}

export interface UpdateCompanyRequest {
  displayName?: string;
  legalName?: string;
  website?: string;
  supportEmail?: string;
  supportPhone?: string;
  address?: string;
  timezone?: string;
  gstNumber?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankName?: string;
  bankBranch?: string;
  bankIfsc?: string;
  // logo is sent as multipart/form-data file when present
}

class CompanyService {
  async getCompany(): Promise<CompanyProfile> {
    const response = await api.get('/company');
    return extractApiData<CompanyProfile>(response);
  }

  /**
   * Update company profile.
   * If logoFile is provided, request is sent as multipart/form-data.
   */
  async updateCompany(
    data: UpdateCompanyRequest,
    logoFile?: File | null
  ): Promise<CompanyProfile> {
    if (logoFile) {
      const formData = new FormData();
      Object.entries(data).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          formData.append(key, String(value));
        }
      });
      formData.append('file', logoFile);

      const response = await api.patch('/company', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return extractApiData<CompanyProfile>(response);
    }

    const response = await api.patch('/company', data);
    return extractApiData<CompanyProfile>(response);
  }
}

export const companyService = new CompanyService();


