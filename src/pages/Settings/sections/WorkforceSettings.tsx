/**
 * Workforce Settings Section
 * Employees and Shifts for HR/Admin
 */

import React, { useState, useRef, useCallback } from 'react';
import {
  EmployeeManagement,
  type EmployeeManagementHandle,
} from '@/features/employees/components/EmployeeManagement';
import { ShiftManagement } from '@/features/shifts/components/ShiftManagement';
import { Button } from '@/shared/components/ui/Button';
import './PersonalSettings.css';
import './WorkforceSettings.css';

type WorkforceTab = 'employees' | 'shifts';

export const WorkforceSettings: React.FC = () => {
  const [activeTab, setActiveTab] = useState<WorkforceTab>('employees');
  const employeeMgmtRef = useRef<EmployeeManagementHandle>(null);

  const handleAddEmployee = useCallback(() => {
    employeeMgmtRef.current?.openAddEmployee();
  }, []);

  return (
    <div className="workforce-settings">
      <div className="settings-inner-tabs workforce-inner-tabs">
        <div className="settings-inner-tabs-left">
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
        <div className="settings-inner-tabs-right">
          {activeTab === 'employees' && (
            <Button variant="primary" onClick={handleAddEmployee} className="employee-roster-toolbar__add">
              Add employee
            </Button>
          )}
        </div>
      </div>

      {activeTab === 'employees' && (
        <div className="workforce-tab-content">
          <EmployeeManagement ref={employeeMgmtRef} />
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
