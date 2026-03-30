/**
 * SideDrawer Component - Slide-in drawer from right
 */

import React, { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './SideDrawer.css';

export interface SideDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  width?: string;
  className?: string;
  /** Optional id of element that describes the drawer (e.g. success/error messages) for screen readers */
  ariaDescribedBy?: string;
}

export const SideDrawer: React.FC<SideDrawerProps> = ({
  isOpen,
  onClose,
  title,
  children,
  width = '480px',
  className = '',
  ariaDescribedBy,
}) => {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const root = panelRef.current;
    if (!root) return;
    const focusable = root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    const list = Array.from(focusable).filter((el) => !el.hasAttribute('disabled'));
    const first = list[0];
    queueMicrotask(() => first?.focus());

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || list.length === 0) return;
      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!active || !root.contains(active)) return;
      if (e.shiftKey) {
        if (active === firstEl) {
          e.preventDefault();
          lastEl.focus();
        }
      } else if (active === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener('keydown', handleTab);
    return () => {
      document.removeEventListener('keydown', handleTab);
      const prev = previousFocusRef.current;
      if (prev && typeof prev.focus === 'function') {
        try {
          prev.focus();
        } catch {
          /* ignore */
        }
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="side-drawer-overlay" onClick={onClose}>
      <div
        ref={panelRef}
        className={`side-drawer ${className}`}
        style={{ width }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={ariaDescribedBy}
      >
        {title && (
          <div className="side-drawer-header">
            <h2 id={titleId} className="side-drawer-title">{title}</h2>
            <button
              className="side-drawer-close"
              onClick={onClose}
              aria-label="Close drawer"
            >
              ×
            </button>
          </div>
        )}
        <div className="side-drawer-content">{children}</div>
      </div>
    </div>,
    document.body
  );
};
