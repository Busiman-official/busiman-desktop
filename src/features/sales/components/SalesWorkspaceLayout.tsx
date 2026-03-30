import React from 'react';
import './SalesWorkspaceLayout.css';

interface SalesWorkspaceLayoutProps {
  title: string;
  subtitle?: string;
  contextBar?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export const SalesWorkspaceLayout: React.FC<SalesWorkspaceLayoutProps> = ({
  title,
  subtitle,
  contextBar,
  actions,
  children,
}) => (
  <div className="sales-workspace">
    <header className="sales-workspace-header">
      <div>
        <h1 className="sales-workspace-title">{title}</h1>
        {subtitle ? <p className="sales-workspace-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="sales-workspace-actions">{actions}</div> : null}
    </header>
    {contextBar ? <div className="sales-workspace-context">{contextBar}</div> : null}
    <div className="sales-workspace-body">{children}</div>
  </div>
);
