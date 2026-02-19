/**
 * Inventory Settings Component - Configuration and administrative tools
 */

import React, { useState } from 'react';
import { SerialAttributeTemplateManagement } from './SerialAttributeTemplateManagement';
import { BulkOperations } from './BulkOperations';
import { ReasonCodeManagement } from './ReasonCodeManagement';
import './InventorySettings.css';

type SettingsSubTab = 'templates' | 'bulk' | 'reason-codes' | 'preferences';

export const InventorySettings: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<SettingsSubTab>('templates');

  return (
    <div className="inventory-settings">
      <div className="settings-header">
        <h2>Inventory Settings</h2>
        <p className="settings-subtitle">Configure inventory module settings and tools</p>
      </div>

      <div className="settings-sub-tabs">
        <button
          className={`settings-sub-tab ${activeSubTab === 'templates' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('templates')}
        >
          Serial Templates
        </button>
        <button
          className={`settings-sub-tab ${activeSubTab === 'bulk' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('bulk')}
        >
          Bulk Operations
        </button>
        <button
          className={`settings-sub-tab ${activeSubTab === 'reason-codes' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('reason-codes')}
        >
          Reason Codes
        </button>
        <button
          className={`settings-sub-tab ${activeSubTab === 'preferences' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('preferences')}
        >
          Preferences
        </button>
      </div>

      <div className="settings-content">
        {activeSubTab === 'templates' && <SerialAttributeTemplateManagement />}
        {activeSubTab === 'bulk' && <BulkOperations />}
        {activeSubTab === 'reason-codes' && <ReasonCodeManagement />}
        {activeSubTab === 'preferences' && (
          <div className="settings-placeholder">
            <h3>Inventory Preferences</h3>
            <p>Module preferences coming soon...</p>
          </div>
        )}
      </div>
    </div>
  );
};
