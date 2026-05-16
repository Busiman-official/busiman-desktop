/**
 * Settings Page - Minimal, compact design
 * Organized by sections with role-based access
 */

import React, { useState, useEffect } from 'react';
import { authStore } from '@/store/authStore';
import { UserRole } from '@/types';
import { PersonalSettings } from './sections/PersonalSettings';
import { AttendanceSettings } from './sections/AttendanceSettings';
import { WorkforceSettings } from './sections/WorkforceSettings';
import { DevicesSettings } from './sections/DevicesSettings';
import { SystemLogs } from './sections/SystemLogs';
import { CompanySettings } from './sections/CompanySettings';
import './SettingsPage.css';

type SettingsSection =
  | 'account'
  | 'attendance'
  | 'workforce'
  | 'company'
  | 'devices'
  | 'logs';

export const SettingsPage: React.FC = () => {
  const { user } = authStore();
  const [activeSection, setActiveSection] = useState<SettingsSection>('account');

  useEffect(() => {
    const handleOpenLogsViewer = () => {
      setActiveSection('logs');
    };

    window.addEventListener('open-logs-viewer', handleOpenLogsViewer);

    const hash = window.location.hash.replace('#', '');
    if (hash === 'logs') setActiveSection('logs');
    else if (hash === 'devices') setActiveSection('devices');
    else if (hash === 'workforce') setActiveSection('workforce');

    return () => {
      window.removeEventListener('open-logs-viewer', handleOpenLogsViewer);
    };
  }, []);

  const canManageEmployees = user?.role === UserRole.HR || user?.role === UserRole.ADMIN;

  const sections = [
    { id: 'account' as const, label: 'Account', icon: '👤' },
    { id: 'attendance' as const, label: 'Attendance', icon: '📅' },
    ...(canManageEmployees ? [{ id: 'workforce' as const, label: 'Workforce', icon: '👥' }] : []),
    ...(user?.role === UserRole.ADMIN
      ? [{ id: 'company' as const, label: 'Company', icon: '🏢' }]
      : []),
    { id: 'devices' as const, label: 'Devices', icon: '🔌' },
    { id: 'logs' as const, label: 'Logs', icon: '📋' },
  ];

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1 className="settings-title">Settings</h1>
        <p className="settings-subtitle">Manage your account settings and preferences</p>
      </div>

      <div className="settings-container">
        <div className="settings-sidebar">
          <nav className="settings-nav">
            {sections.map((section) => (
              <button
                key={section.id}
                className={`settings-nav-item ${activeSection === section.id ? 'active' : ''}`}
                onClick={() => setActiveSection(section.id)}
              >
                <span className="settings-nav-icon">{section.icon}</span>
                <span className="settings-nav-label">{section.label}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="settings-content">
          {activeSection === 'account' && <PersonalSettings />}
          {activeSection === 'attendance' && <AttendanceSettings />}
          {activeSection === 'workforce' && canManageEmployees && <WorkforceSettings />}
          {activeSection === 'company' && user?.role === UserRole.ADMIN && <CompanySettings />}
          {activeSection === 'devices' && <DevicesSettings />}
          {activeSection === 'logs' && <SystemLogs />}
        </div>
      </div>
    </div>
  );
};
