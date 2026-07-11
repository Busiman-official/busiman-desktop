/**
 * Company Service - API calls for global company profile
 */

import { api } from './api';
import { extractApiData } from '@/utils/api';

export interface CompanyBankAccount {
  id: string;
  label?: string;
  accountHolderName?: string;
  accountNumber?: string;
  bankName?: string;
  branch?: string;
  ifsc?: string;
  isPrimary?: boolean;
}

export interface CompanyUpiId {
  id: string;
  label?: string;
  upiId: string;
  isPrimary?: boolean;
}

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
  bankAccounts?: CompanyBankAccount[];
  upiIds?: CompanyUpiId[];
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
  bankAccounts?: CompanyBankAccount[];
  upiIds?: CompanyUpiId[];
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
        if (value === undefined || value === null) return;
        if (key === 'bankAccounts' || key === 'upiIds') {
          formData.append(key, JSON.stringify(value));
          return;
        }
        formData.append(key, String(value));
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

  /**
   * Irreversible: wipes entire server database and returns new admin credentials once.
   */
  async wipeCompanyData(body: {
    confirmationDisplayName: string;
    currentPassword?: string;
  }): Promise<{ adminEmail: string; adminPassword: string; requestId: string }> {
    const response = await api.post('/company/wipe', body);
    return extractApiData<{ adminEmail: string; adminPassword: string; requestId: string }>(response);
  }
}

export const companyService = new CompanyService();
