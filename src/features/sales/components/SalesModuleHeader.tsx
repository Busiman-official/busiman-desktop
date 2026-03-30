import React from 'react';
import './SalesModuleHeader.css';

export interface SalesTabDef {
  id: string;
  label: string;
}

export interface SalesModuleHeaderProps {
  title: string;
  tabs: readonly SalesTabDef[];
  activeTab: string;
  onTabChange: (id: string) => void;
  /** Highlights Customers when on customer detail route */
  tabActiveOverride?: (tabId: string) => boolean;
  branchSlot?: React.ReactNode;
  /** Sales point, filters, etc. */
  contextSlot?: React.ReactNode;
  trailing?: React.ReactNode;
}

export const SalesModuleHeader: React.FC<SalesModuleHeaderProps> = ({
  title,
  tabs,
  activeTab,
  onTabChange,
  tabActiveOverride,
  branchSlot,
  contextSlot,
  trailing,
}) => {
  const hasRight =
    Boolean(branchSlot) || Boolean(contextSlot) || Boolean(trailing);

  return (
    <header className="sales-module-header" role="banner">
      <div className="sales-module-header__row">
        <div className="sales-module-header__left">
          <span className="sales-module-header__title">{title}</span>
          <div className="sales-module-header__tabs-wrap">
            <div className="sales-module-header__tabs-scroll">
              <div className="sales-module-header__tabs" role="tablist" aria-label="Sales sections">
                {tabs.map((t) => {
                  const selected = tabActiveOverride ? tabActiveOverride(t.id) : activeTab === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      className="sales-module-header__tab"
                      onClick={() => onTabChange(t.id)}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {hasRight ? (
          <div className="sales-module-header__right">
            {branchSlot ? <div className="sales-module-header__branch">{branchSlot}</div> : null}
            {contextSlot ? <div className="sales-module-header__context">{contextSlot}</div> : null}
            {trailing ? <div className="sales-module-header__actions">{trailing}</div> : null}
          </div>
        ) : null}
      </div>
    </header>
  );
};
