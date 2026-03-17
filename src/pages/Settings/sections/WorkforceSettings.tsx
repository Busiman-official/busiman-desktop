/**
 * Workforce Settings Section
 * Employees and Shifts for HR/Admin
 */

import React, { useState } from 'react';
import { EmployeeManagement } from '@/features/employees/components/EmployeeManagement';
import { ShiftManagement } from '@/features/shifts/components/ShiftManagement';
import './PersonalSettings.css';
import './WorkforceSettings.css';

type WorkforceTab = 'employees' | 'shifts';

export const WorkforceSettings: React.FC = () => {
  const [activeTab, setActiveTab] = useState<WorkforceTab>('employees');

  return (
    <div className="workforce-settings">
      <div className="settings-section-header">
        <h2>Workforce</h2>
        <p className="settings-section-description">
          Manage employees and shifts
        </p>
      </div>

      <div className="settings-inner-tabs">
        <button
          type="button"
          className={`settings-inner-tab ${activeTab === 'employees' ? 'active' : ''}`}
          onClick={() => setActiveTab('employees')}
        >
          Employees
        </button>
        <button
          type="button"
          className={`settings-inner-tab ${activeTab === 'shifts' ? 'active' : ''}`}
          onClick={() => setActiveTab('shifts')}
        >
          Shifts
        </button>
      </div>

      {activeTab === 'employees' && (
        <div className="workforce-tab-content">
          <EmployeeManagement />
        </div>
      )}
      {activeTab === 'shifts' && (
        <div className="workforce-tab-content">
          <ShiftManagement />
        </div>
      )}
    </div>
  );
};
