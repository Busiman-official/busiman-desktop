/**
 * Reports Settings Section
 * Reports preferences and export settings
 */

import React from 'react';
import './ReportsSettings.css';
import './PersonalSettings.css';

export const ReportsSettings: React.FC = () => {
  return (
    <div className="reports-settings">
      <div className="settings-section-header">
        <h2>Reports</h2>
        <p className="settings-section-description">
          Reports and export preferences — coming in a future update.
        </p>
      </div>

      <div className="settings-card">
        <div className="settings-card-content">
          <p className="settings-info-text">
            Export settings, report templates, and default date range will be available in a future update.
          </p>
        </div>
      </div>
    </div>
  );
};
