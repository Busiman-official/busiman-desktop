/**
 * Company Settings Section
 * Admin-only management of global company details (name, logo, contact info) and branches
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { companyStore } from '@/store/companyStore';
import { authStore } from '@/store/authStore';
import { CompanyProfile, companyService, UpdateCompanyRequest } from '@/services/company.service';
import { branchService } from '@/services/branch.service';
import { Branch, CreateBranchRequest, UpdateBranchRequest } from '@/types';
import { employeeService } from '@/services/employee.service';
import { User, UserRole } from '@/types';
import { logger } from '@/shared/utils/logger';
import { Modal } from '@/shared/components/modals/Modal';

const STANDARD_DEPARTMENTS = ['attendance', 'inventory', 'sales', 'reports', 'calendar'] as const;
import './CompanySettings.css';

type CompanySettingsTab = 'details' | 'branches';

export const CompanySettings: React.FC = () => {
  const navigate = useNavigate();
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

  const [wipeWarnOpen, setWipeWarnOpen] = useState(false);
  const [wipeConfirmOpen, setWipeConfirmOpen] = useState(false);
  const [wipeCreds, setWipeCreds] = useState<{ adminEmail: string; adminPassword: string } | null>(null);
  const [wipeUnderstand, setWipeUnderstand] = useState(false);
  const [wipeDisplayNameInput, setWipeDisplayNameInput] = useState('');
  const [wipePassword, setWipePassword] = useState('');
  const [wipeBusy, setWipeBusy] = useState(false);
  const [wipeError, setWipeError] = useState<string | null>(null);

  const expectedCompanyDisplayName = (company?.displayName || 'Busiman').trim();

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
        gstNumber: company.gstNumber,
        bankAccountName: company.bankAccountName,
        bankAccountNumber: company.bankAccountNumber,
        bankName: company.bankName,
        bankBranch: company.bankBranch,
        bankIfsc: company.bankIfsc,
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

  const openWipeFlow = () => {
    setWipeError(null);
    setWipeUnderstand(false);
    setWipeDisplayNameInput('');
    setWipePassword('');
    setWipeWarnOpen(true);
  };

  const executeCompanyWipe = async () => {
    setWipeError(null);
    if (wipeDisplayNameInput.trim() !== expectedCompanyDisplayName) {
      setWipeError(`Type the exact display name: "${expectedCompanyDisplayName}"`);
      return;
    }
    setWipeBusy(true);
    try {
      const data = await companyService.wipeCompanyData({
        confirmationDisplayName: wipeDisplayNameInput.trim(),
        currentPassword: wipePassword.trim() || undefined,
      });
      setWipeConfirmOpen(false);
      setWipeCreds({ adminEmail: data.adminEmail, adminPassword: data.adminPassword });
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { message?: string } }; message?: string };
      setWipeError(ax?.response?.data?.message || ax?.message || 'Operation failed');
    } finally {
      setWipeBusy(false);
    }
  };

  const finishWipeLogout = async () => {
    setWipeCreds(null);
    companyStore.getState().setCompany({ displayName: 'Busiman', logoUrl: null });
    await authStore.getState().logout();
    navigate('/login', { replace: true, state: { companyWipeCompleted: true } });
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

            <div className="form-group">
              <label>GST Number</label>
              <input
                type="text"
                className="form-input"
                value={form.gstNumber || ''}
                onChange={(e) => handleInputChange('gstNumber', e.target.value.toUpperCase())}
                placeholder="e.g., 29ABCDE1234F1Z5"
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

      <div className="settings-card">
        <div className="settings-card-header">
          <h3>Primary Bank Account</h3>
        </div>
        <div className="settings-card-content">
          <div className="form-grid">
            <div className="form-group">
              <label>Account Holder Name</label>
              <input
                type="text"
                className="form-input"
                value={form.bankAccountName || ''}
                onChange={(e) => handleInputChange('bankAccountName', e.target.value)}
                placeholder="e.g., Busiman Private Limited"
              />
            </div>
            <div className="form-group">
              <label>Account Number</label>
              <input
                type="text"
                className="form-input"
                value={form.bankAccountNumber || ''}
                onChange={(e) => handleInputChange('bankAccountNumber', e.target.value)}
                placeholder="e.g., 123456789012"
              />
            </div>
            <div className="form-group">
              <label>Bank Name</label>
              <input
                type="text"
                className="form-input"
                value={form.bankName || ''}
                onChange={(e) => handleInputChange('bankName', e.target.value)}
                placeholder="e.g., Kotak Mahindra Bank"
              />
            </div>
            <div className="form-group">
              <label>Branch</label>
              <input
                type="text"
                className="form-input"
                value={form.bankBranch || ''}
                onChange={(e) => handleInputChange('bankBranch', e.target.value)}
                placeholder="e.g., M.G. Road, Bengaluru"
              />
            </div>
            <div className="form-group">
              <label>IFSC</label>
              <input
                type="text"
                className="form-input"
                value={form.bankIfsc || ''}
                onChange={(e) => handleInputChange('bankIfsc', e.target.value.toUpperCase())}
                placeholder="e.g., KKBK0008066"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="settings-card company-settings-danger">
        <div className="settings-card-header">
          <h3>Danger zone</h3>
        </div>
        <div className="settings-card-content">
          <p className="company-settings-danger__text">
            Permanently delete all data for this deployment: database, sessions, sales, inventory, HR, and linked
            cloud files where applicable. This cannot be undone. Off-site backups, if any, are not removed—see your
            backup policy.
          </p>
          <button type="button" className="btn-danger" onClick={openWipeFlow} disabled={saving || wipeBusy}>
            Delete all company data…
          </button>
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
                        <strong>Modules available for this branch:</strong>
                        <div className="department-checkboxes">
                          {STANDARD_DEPARTMENTS.map((dept) => (
                            <label key={dept} className="department-checkbox">
                              <input
                                type="checkbox"
                                checked={branchForm.departments?.includes(dept) || false}
                                onChange={() => handleDepartmentToggle(dept)}
                              />
                              <span>{dept.charAt(0).toUpperCase() + dept.slice(1)}</span>
                            </label>
                          ))}
                        </div>
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

      <Modal
        isOpen={wipeWarnOpen}
        onClose={() => {
          setWipeWarnOpen(false);
          setWipeUnderstand(false);
        }}
        title="Delete all company data?"
        size="md"
      >
        <p>
          You will lose every record in this system. A new administrator account will be created; you must copy the
          password immediately—it is shown only once.
        </p>
        <label className="company-settings-wipe-check">
          <input
            type="checkbox"
            checked={wipeUnderstand}
            onChange={(e) => setWipeUnderstand(e.target.checked)}
          />
          I understand this is irreversible and that backups outside this app may still exist.
        </label>
        <div className="form-actions" style={{ marginTop: 16 }}>
          <button
            type="button"
            className="btn-primary"
            disabled={!wipeUnderstand}
            onClick={() => {
              setWipeWarnOpen(false);
              setWipeConfirmOpen(true);
              setWipeError(null);
            }}
          >
            Continue
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setWipeWarnOpen(false);
              setWipeUnderstand(false);
            }}
          >
            Cancel
          </button>
        </div>
      </Modal>

      <Modal
        isOpen={wipeConfirmOpen}
        onClose={() => {
          if (!wipeBusy) {
            setWipeConfirmOpen(false);
            setWipeDisplayNameInput('');
            setWipePassword('');
            setWipeError(null);
          }
        }}
        title="Confirm permanent deletion"
        size="md"
      >
        <p>
          Type the company <strong>display name</strong> exactly as shown in Basic Information:{' '}
          <strong>{expectedCompanyDisplayName}</strong>
        </p>
        <div className="form-group">
          <label>Display name</label>
          <input
            type="text"
            className="form-input"
            value={wipeDisplayNameInput}
            onChange={(e) => setWipeDisplayNameInput(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="form-group">
          <label>Your current password (recommended)</label>
          <input
            type="password"
            className="form-input"
            value={wipePassword}
            onChange={(e) => setWipePassword(e.target.value)}
            autoComplete="current-password"
            placeholder="Optional but strongly recommended"
          />
        </div>
        {wipeError ? <div className="settings-error">{wipeError}</div> : null}
        <p className="form-help">You will be logged out when the operation completes. Your session will no longer be valid.</p>
        <div className="form-actions" style={{ marginTop: 16 }}>
          <button
            type="button"
            className="btn-danger"
            disabled={wipeBusy}
            onClick={() => void executeCompanyWipe()}
          >
            {wipeBusy ? 'Deleting…' : 'Delete everything'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={wipeBusy}
            onClick={() => {
              setWipeConfirmOpen(false);
              setWipeDisplayNameInput('');
              setWipePassword('');
              setWipeError(null);
            }}
          >
            Cancel
          </button>
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(wipeCreds)}
        onClose={() => void finishWipeLogout()}
        title="New administrator credentials"
        size="md"
        closeOnOverlayClick={false}
        closeOnEscape={false}
        showCloseButton={false}
      >
        {wipeCreds ? (
          <>
            <p>Copy these now. They will not be shown again. Then continue to log in.</p>
            <div className="form-group">
              <label>Email (login ID)</label>
              <div className="company-settings-wipe-cred-row">
                <input type="text" className="form-input" readOnly value={wipeCreds.adminEmail} />
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => void navigator.clipboard.writeText(wipeCreds.adminEmail)}
                >
                  Copy
                </button>
              </div>
            </div>
            <div className="form-group">
              <label>Password</label>
              <div className="company-settings-wipe-cred-row">
                <input type="text" className="form-input" readOnly value={wipeCreds.adminPassword} />
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => void navigator.clipboard.writeText(wipeCreds.adminPassword)}
                >
                  Copy
                </button>
              </div>
            </div>
            <div className="form-actions" style={{ marginTop: 16 }}>
              <button type="button" className="btn-primary" onClick={() => void finishWipeLogout()}>
                Continue to login
              </button>
            </div>
          </>
        ) : null}
      </Modal>
    </div>
  );
};


