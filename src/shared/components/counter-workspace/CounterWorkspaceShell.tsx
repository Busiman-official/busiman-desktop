import React from 'react';
import './counter-workspace.css';

export interface CounterWorkspaceShellProps {
  toast?: string | null;
  loadingOverlay?: React.ReactNode;
  heldDraftsBanner?: React.ReactNode;
  leftAriaLabel?: string;
  leftBody: React.ReactNode;
  leftFooter: React.ReactNode;
  rightSearch: React.ReactNode;
  rightHeadActions: React.ReactNode;
  rightHeadStatus?: React.ReactNode;
  cartAriaLabel?: string;
  cart: React.ReactNode;
  children?: React.ReactNode;
}

export const CounterWorkspaceShell: React.FC<CounterWorkspaceShellProps> = ({
  toast,
  loadingOverlay,
  heldDraftsBanner,
  leftAriaLabel = 'Find and add products',
  leftBody,
  leftFooter,
  rightSearch,
  rightHeadActions,
  rightHeadStatus,
  cartAriaLabel = 'Cart',
  cart,
  children,
}) => (
  <div className="pos-shell">
    {toast ? (
      <div className="pos-toast" role="status">
        {toast}
      </div>
    ) : null}

    <div className="pos-main">
      {loadingOverlay}

      <section className="pos-scan" aria-label={leftAriaLabel}>
        {heldDraftsBanner}
        {leftBody}
        <footer className="pos-summary">{leftFooter}</footer>
      </section>

      <div className="pos-right">
        <div className="pos-order-head">
          <div className="pos-order-head__top">
            <div className="pos-order-head__left">{rightSearch}</div>
            <div className="pos-order-head__actions">
              {rightHeadActions}
              {rightHeadStatus}
            </div>
          </div>
        </div>
        <section className="pos-cart" aria-label={cartAriaLabel}>
          {cart}
        </section>
      </div>
    </div>

    {children}
  </div>
);
