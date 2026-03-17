/**
 * Devices Settings Section
 * Desktop proxy, NodeMCU proxy servers, and gate devices
 */

import React, { useState } from 'react';
import { authStore } from '@/store/authStore';
import { UserRole } from '@/types';
import { ProxySettings } from './ProxySettings';
import { EdgeDeviceRegistrySection } from './EdgeDeviceRegistrySection.tsx';
import './PersonalSettings.css';
import './DevicesSettings.css';

type DevicesTab = 'desktop' | 'registry';

export const DevicesSettings: React.FC = () => {
  const { user } = authStore();
  const isAdmin = user?.role === UserRole.ADMIN;
  const [activeTab, setActiveTab] = useState<DevicesTab>('desktop');

  const tabs: { id: DevicesTab; label: string }[] = [
    { id: 'desktop', label: 'This computer' },
    ...(isAdmin ? [{ id: 'registry' as const, label: 'Registry' }] : []),
  ];

  return (
    <div className="devices-settings">
      <div className="settings-section-header">
        <h2>Devices</h2>
        <p className="settings-section-description">
          Proxy server and gate device management
        </p>
      </div>

      <div className="settings-inner-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`settings-inner-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="devices-tab-content">
        {activeTab === 'desktop' && <ProxySettings />}
        {activeTab === 'registry' && isAdmin && <EdgeDeviceRegistrySection />}
      </div>
    </div>
  );
};
