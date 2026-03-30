/**
 * Inventory Settings Component - Configuration and administrative tools
 */

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SerialAttributeTemplateManagement } from './SerialAttributeTemplateManagement';
import { BulkOperations } from './BulkOperations';
import { ReasonCodeManagement } from './ReasonCodeManagement';
import './InventorySettings.css';

type SettingsSubTab = 'templates' | 'bulk' | 'reason-codes' | 'preferences';

const SETTINGS_SUB_TABS: SettingsSubTab[] = ['templates', 'bulk', 'reason-codes', 'preferences'];

export const InventorySettings: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeSubTab, setActiveSubTab] = useState<SettingsSubTab>('templates');

  // Sync activeSubTab with URL param subTab (for deep-linking from global search)
  useEffect(() => {
    const subTab = searchParams.get('subTab');
    if (subTab && SETTINGS_SUB_TABS.includes(subTab as SettingsSubTab)) {
      setActiveSubTab(subTab as SettingsSubTab);
    }
  }, [searchParams]);

  return (
    <div className="inventory-settings">
      <div className="settings-header">
        <h2>Inventory Settings</h2>
        <p className="settings-subtitle">Configure inventory module settings and tools</p>
      </div>

      <div className="settings-sub-tabs">
        <button
          className={`settings-sub-tab ${activeSubTab === 'templates' ? 'active' : ''}`}
          onClick={() => {
            setActiveSubTab('templates');
            setSearchParams((p) => { const next = new URLSearchParams(p); next.set('subTab', 'templates'); return next; });
          }}
        >
          Serial Templates
        </button>
        <button
          className={`settings-sub-tab ${activeSubTab === 'bulk' ? 'active' : ''}`}
          onClick={() => {
            setActiveSubTab('bulk');
            setSearchParams((p) => { const next = new URLSearchParams(p); next.set('subTab', 'bulk'); return next; });
          }}
        >
          Bulk Operations
        </button>
        <button
          className={`settings-sub-tab ${activeSubTab === 'reason-codes' ? 'active' : ''}`}
          onClick={() => {
            setActiveSubTab('reason-codes');
            setSearchParams((p) => { const next = new URLSearchParams(p); next.set('subTab', 'reason-codes'); return next; });
          }}
        >
          Reason Codes
        </button>
        <button
          className={`settings-sub-tab ${activeSubTab === 'preferences' ? 'active' : ''}`}
          onClick={() => {
            setActiveSubTab('preferences');
            setSearchParams((p) => { const next = new URLSearchParams(p); next.set('subTab', 'preferences'); return next; });
          }}
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
