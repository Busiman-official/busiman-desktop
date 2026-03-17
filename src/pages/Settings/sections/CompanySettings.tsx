/**
 * Company Settings Section
 * Admin-only management of global company details (name, logo, contact info) and branches
 */

import React, { useEffect, useState } from 'react';
import { companyStore } from '@/store/companyStore';
import { CompanyProfile, companyService, UpdateCompanyRequest } from '@/services/company.service';
import { branchService } from '@/services/branch.service';
import { Branch, CreateBranchRequest, UpdateBranchRequest } from '@/types';
import { employeeService } from '@/services/employee.service';
import { User, UserRole } from '@/types';
import { logger } from '@/shared/utils/logger';

const STANDARD_DEPARTMENTS = ['attendance', 'inventory', 'hr', 'finance', 'sales'];
import './CompanySettings.css';

type CompanySettingsTab = 'details' | 'branches';

export const CompanySettings: React.FC = () => {
  const { company, isLoading, error, setCompany, loadCompany } = companyStore();
  const [activeTab, setActiveTab] = useState<CompanySettingsTab>('details');

  // Company details form state
  const [form, setForm] = useState<UpdateCompanyRequest>({});
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  // Branch management state
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [showBranchForm, setShowBranchForm] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [branchForm, setBranchForm] = useState<CreateBranchRequest>({
    name: '',
    code: '',
    address: '',
    phone: '',
    email: '',
    departments: [],
  });
  const [managers, setManagers] = useState<User[]>([]);
  const [customDepartment, setCustomDepartment] = useState('');

  useEffect(() => {
    if (!company && !isLoading) {
      loadCompany().catch(() => {
        // error already handled in store
      });
    }
  }, [company, isLoading, loadCompany]);

  useEffect(() => {
    if (company) {
      setForm({
        displayName: company.displayName,
        legalName: company.legalName,
        website: company.website,
        supportEmail: company.supportEmail,
        supportPhone: company.supportPhone,
        address: company.address,
        timezone: company.timezone,
      });
      setLogoPreview(company.logoUrl || null);
      setLogoFile(null);
    }
  }, [company]);

  useEffect(() => {
    if (activeTab === 'branches') {
      loadBranches();
      loadManagers();
    }
  }, [activeTab]);

  const loadBranches = async () => {
    try {
      setLoadingBranches(true);
      setBranchError(null);
      const data = await branchService.getBranches();
      setBranches(data);
    } catch (err: any) {
      setBranchError(err?.response?.data?.message || err?.message || 'Failed to load branches');
    } finally {
      setLoadingBranches(false);
    }
  };

  const loadManagers = async () => {
    try {
      const allEmployees = await employeeService.getAllEmployees();
      const managersList = allEmployees.filter(
        (emp) => emp.role === UserRole.MANAGER || emp.role === UserRole.HR || emp.role === UserRole.ADMIN
      );
      setManagers(managersList);
    } catch (err) {
      logger.error('[CompanySettings] Failed to load managers', err);
    }
  };

  const handleBranchFormChange = (field: keyof CreateBranchRequest, value: any) => {
    setBranchForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleDepartmentToggle = (dept: string) => {
    setBranchForm((prev) => {
      const departments = prev.departments || [];
      if (departments.includes(dept)) {
        return { ...prev, departments: departments.filter((d) => d !== dept) };
      } else {
        return { ...prev, departments: [...departments, dept] };
      }
    });
  };

  const handleAddCustomDepartment = () => {
    if (customDepartment.trim() && !branchForm.departments?.includes(customDepartment.trim())) {
      setBranchForm((prev) => ({
        ...prev,
        departments: [...(prev.departments || []), customDepartment.trim()],
      }));
      setCustomDepartment('');
    }
  };

  const handleCreateBranch = async () => {
    try {
      setSaving(true);
      setBranchError(null);
      await branchService.createBranch(branchForm);
      await loadBranches();
      setShowBranchForm(false);
      setBranchForm({
        name: '',
        code: '',
        address: '',
        phone: '',
        email: '',
        departments: [],
      });
      setSaveSuccess('Branch created successfully');
      setTimeout(() => setSaveSuccess(null), 3000);
    } catch (err: any) {
      setBranchError(err?.response?.data?.message || err?.message || 'Failed to create branch');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateBranch = async () => {
    if (!editingBranch) return;
    try {
      setSaving(true);
      setBranchError(null);
      await branchService.updateBranch(editingBranch.id, branchForm as UpdateBranchRequest);
      await loadBranches();
      setEditingBranch(null);
      setShowBranchForm(false);
      setBranchForm({
        name: '',
        code: '',
        address: '',
        phone: '',
        email: '',
        departments: [],
      });
      setSaveSuccess('Branch updated successfully');
      setTimeout(() => setSaveSuccess(null), 3000);
    } catch (err: any) {
      setBranchError(err?.response?.data?.message || err?.message || 'Failed to update branch');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteBranch = async (branchId: string) => {
    if (!window.confirm('Are you sure you want to delete this branch? This action cannot be undone.')) {
      return;
    }
    try {
      setSaving(true);
      setBranchError(null);
      await branchService.deleteBranch(branchId);
      await loadBranches();
      setSaveSuccess('Branch deleted successfully');
      setTimeout(() => setSaveSuccess(null), 3000);
    } catch (err: any) {
      setBranchError(err?.response?.data?.message || err?.message || 'Failed to delete branch');
    } finally {
      setSaving(false);
    }
  };

  const handleEditBranch = (branch: Branch) => {
    setEditingBranch(branch);
    setBranchForm({
      name: branch.name,
      code: branch.code,
      address: branch.address || '',
      phone: branch.phone || '',
      email: branch.email || '',
      branchManager: branch.branchManager?.id,
      departments: branch.departments || [],
    });
    setShowBranchForm(true);
  };

  const handleCancelBranchForm = () => {
    setShowBranchForm(false);
    setEditingBranch(null);
    setBranchForm({
      name: '',
      code: '',
      address: '',
      phone: '',
      email: '',
      departments: [],
    });
  };

  const handleInputChange = (field: keyof UpdateCompanyRequest, value: string) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleLogoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setSaveError('Please select an image file (PNG, JPG, etc.)');
      return;
    }

    setLogoFile(file);
    const reader = new FileReader();
    reader.onload = () => {
      setLogoPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setSaveError(null);
      setSaveSuccess(null);

      const updated: CompanyProfile = await companyService.updateCompany(form, logoFile || undefined);
      setCompany(updated);
      setLogoFile(null);
      setSaveSuccess('Company details updated successfully');
      setTimeout(() => setSaveSuccess(null), 3000);
    } catch (err: any) {
      const message =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        'Failed to update company details';
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  };

  if (isLoading && !company) {
    return <div className="settings-section-loading">Loading company details...</div>;
  }

  return (
    <div className="company-settings">
      <div className="settings-section-header">
        <h2>Company Management</h2>
        <p className="settings-section-description">
          Manage global company branding, contact details, and branch locations.
        </p>
      </div>

      {/* Tabs */}
      <div className="company-settings-tabs">
        <button
          className={`company-settings-tab ${activeTab === 'details' ? 'active' : ''}`}
          onClick={() => setActiveTab('details')}
        >
          Company Details
        </button>
        <button
          className={`company-settings-tab ${activeTab === 'branches' ? 'active' : ''}`}
          onClick={() => setActiveTab('branches')}
        >
          Branch Management
        </button>
      </div>

      {(error || saveError || branchError) && (
        <div className="settings-error">{saveError || branchError || error}</div>
      )}
      {saveSuccess && <div className="settings-success">{saveSuccess}</div>}

      {activeTab === 'details' && (
        <div>
      <div className="settings-card">
        <div className="settings-card-header">
          <h3>Basic Information</h3>
        </div>
        <div className="settings-card-content">
          <div className="form-grid">
            <div className="form-group">
              <label>Display Name *</label>
              <input
                type="text"
                className="form-input"
                value={form.displayName || ''}
                onChange={(e) => handleInputChange('displayName', e.target.value)}
                placeholder="Busiman"
              />
              <small className="form-help">
                This name appears in the application header and login screens.
              </small>
            </div>

            <div className="form-group">
              <label>Legal Name</label>
              <input
                type="text"
                className="form-input"
                value={form.legalName || ''}
                onChange={(e) => handleInputChange('legalName', e.target.value)}
                placeholder="Busiman Pvt. Ltd."
              />
            </div>

            <div className="form-group">
              <label>Website</label>
              <input
                type="url"
                className="form-input"
                value={form.website || ''}
                onChange={(e) => handleInputChange('website', e.target.value)}
                placeholder="https://busiman.com"
              />
            </div>

            <div className="form-group">
              <label>Support Email</label>
              <input
                type="email"
                className="form-input"
                value={form.supportEmail || ''}
                onChange={(e) => handleInputChange('supportEmail', e.target.value)}
                placeholder="support@busiman.com"
              />
            </div>

            <div className="form-group">
              <label>Support Phone</label>
              <input
                type="tel"
                className="form-input"
                value={form.supportPhone || ''}
                onChange={(e) => handleInputChange('supportPhone', e.target.value)}
                placeholder="+1 (555) 123-4567"
              />
            </div>

            <div className="form-group">
              <label>Timezone</label>
              <input
                type="text"
                className="form-input"
                value={form.timezone || ''}
                onChange={(e) => handleInputChange('timezone', e.target.value)}
                placeholder="e.g., Asia/Kolkata"
              />
            </div>

            <div className="form-group full-width">
              <label>Address</label>
              <textarea
                className="form-input"
                rows={3}
                value={form.address || ''}
                onChange={(e) => handleInputChange('address', e.target.value)}
                placeholder="Street address, City, State, ZIP"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="settings-card">
        <div className="settings-card-header">
          <h3>Company Logo</h3>
        </div>
        <div className="settings-card-content">
          <div className="logo-settings">
            <div className="logo-preview">
              {logoPreview ? (
                <img src={logoPreview} alt="Company logo preview" />
              ) : (
                <div className="logo-placeholder">No logo set</div>
              )}
            </div>
            <div className="logo-actions">
              <label className="btn-secondary btn-sm">
                Choose Logo
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoChange}
                  style={{ display: 'none' }}
                />
              </label>
              <p className="form-help">
                Recommended: square PNG/JPG, at least 128x128px.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="form-actions">
        <button
          className="btn-primary"
          onClick={handleSave}
          disabled={saving || !form.displayName}
        >
          {saving ? 'Saving...' : 'Save Company Details'}
        </button>
      </div>
        </div>
      )}

      {activeTab === 'branches' && (
        <div className="branch-management">
          <div className="branch-management-header">
            <h3>Branches</h3>
            <button
              className="btn-primary btn-sm"
              onClick={() => {
                setShowBranchForm(true);
                setEditingBranch(null);
                setBranchForm({
                  name: '',
                  code: '',
                  address: '',
                  phone: '',
                  email: '',
                  departments: [],
                });
              }}
            >
              + Create Branch
            </button>
          </div>

          {loadingBranches ? (
            <div className="settings-section-loading">Loading branches...</div>
          ) : branches.length === 0 ? (
            <div className="settings-empty-state">
              <p>No branches found. Create your first branch to get started.</p>
            </div>
          ) : (
            <div className="branches-list">
              {branches.map((branch) => (
                <div key={branch.id} className="branch-card">
                  <div className="branch-card-header">
                    <div>
                      <h4>{branch.name}</h4>
                      <span className="branch-code">{branch.code}</span>
                      {!branch.isActive && <span className="branch-inactive">Inactive</span>}
                    </div>
                    <div className="branch-actions">
                      <button
                        className="btn-secondary btn-sm"
                        onClick={() => handleEditBranch(branch)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn-danger btn-sm"
                        onClick={() => handleDeleteBranch(branch.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="branch-card-content">
                    {branch.address && <p><strong>Address:</strong> {branch.address}</p>}
                    {branch.phone && <p><strong>Phone:</strong> {branch.phone}</p>}
                    {branch.email && <p><strong>Email:</strong> {branch.email}</p>}
                    {branch.branchManager && (
                      <p><strong>Manager:</strong> {branch.branchManager.name} ({branch.branchManager.email})</p>
                    )}
                    {branch.departments.length > 0 && (
                      <div>
                        <strong>Departments:</strong>
                        <div className="branch-departments">
                          {branch.departments.map((dept) => (
                            <span key={dept} className="department-tag">{dept}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {showBranchForm && (
            <div className="branch-form-modal">
              <div className="branch-form-content">
                <h3>{editingBranch ? 'Edit Branch' : 'Create Branch'}</h3>
                <div className="form-grid">
                  <div className="form-group">
                    <label>Branch Name *</label>
                    <input
                      type="text"
                      className="form-input"
                      value={branchForm.name}
                      onChange={(e) => handleBranchFormChange('name', e.target.value)}
                      placeholder="Main Office"
                    />
                  </div>
                  <div className="form-group">
                    <label>Branch Code *</label>
                    <input
                      type="text"
                      className="form-input"
                      value={branchForm.code}
                      onChange={(e) => handleBranchFormChange('code', e.target.value.toUpperCase())}
                      placeholder="MAIN"
                    />
                    <small className="form-help">Unique code (uppercase letters, numbers, hyphens, underscores)</small>
                  </div>
                  <div className="form-group full-width">
                    <label>Address</label>
                    <textarea
                      className="form-input"
                      rows={3}
                      value={branchForm.address || ''}
                      onChange={(e) => handleBranchFormChange('address', e.target.value)}
                      placeholder="Street address, City, State, ZIP"
                    />
                  </div>
                  <div className="form-group">
                    <label>Phone</label>
                    <input
                      type="tel"
                      className="form-input"
                      value={branchForm.phone || ''}
                      onChange={(e) => handleBranchFormChange('phone', e.target.value)}
                      placeholder="+1 (555) 123-4567"
                    />
                  </div>
                  <div className="form-group">
                    <label>Email</label>
                    <input
                      type="email"
                      className="form-input"
                      value={branchForm.email || ''}
                      onChange={(e) => handleBranchFormChange('email', e.target.value)}
                      placeholder="branch@company.com"
                    />
                  </div>
                  <div className="form-group full-width">
                    <label>Branch Manager</label>
                    <select
                      className="form-input"
                      value={branchForm.branchManager || ''}
                      onChange={(e) => handleBranchFormChange('branchManager', e.target.value || undefined)}
                    >
                      <option value="">None</option>
                      {managers.map((manager) => (
                        <option key={manager.id} value={manager.id}>
                          {manager.name} ({manager.email})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group full-width">
                    <label>Departments</label>
                    <div className="departments-selection">
                      <div className="standard-departments">
                        <strong>Standard Departments:</strong>
                        <div className="department-checkboxes">
                          {STANDARD_DEPARTMENTS.map((dept) => (
                            <label key={dept} className="department-checkbox">
                              <input
                                type="checkbox"
                                checked={branchForm.departments?.includes(dept) || false}
                                onChange={() => handleDepartmentToggle(dept)}
                              />
                              <span>{dept}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="custom-departments">
                        <strong>Custom Departments:</strong>
                        <div className="custom-department-input">
                          <input
                            type="text"
                            className="form-input"
                            value={customDepartment}
                            onChange={(e) => setCustomDepartment(e.target.value)}
                            placeholder="Enter custom department name"
                            onKeyPress={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleAddCustomDepartment();
                              }
                            }}
                          />
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={handleAddCustomDepartment}
                          >
                            Add
                          </button>
                        </div>
                        {branchForm.departments?.filter((d) => !STANDARD_DEPARTMENTS.includes(d)).length > 0 && (
                          <div className="custom-departments-list">
                            {branchForm.departments
                              .filter((d) => !STANDARD_DEPARTMENTS.includes(d))
                              .map((dept) => (
                                <span key={dept} className="department-tag">
                                  {dept}
                                  <button
                                    type="button"
                                    className="department-tag-remove"
                                    onClick={() => handleDepartmentToggle(dept)}
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="form-actions">
                  <button
                    className="btn-primary"
                    onClick={editingBranch ? handleUpdateBranch : handleCreateBranch}
                    disabled={saving || !branchForm.name || !branchForm.code}
                  >
                    {saving ? 'Saving...' : editingBranch ? 'Update Branch' : 'Create Branch'}
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={handleCancelBranchForm}
                    disabled={saving}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};


