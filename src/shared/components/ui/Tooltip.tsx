/**
 * Tooltip Component
 * Uses React Portal to mount on document.body so it is not clipped by overflow.
 */

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import './Tooltip.css';

const GAP = 8;

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
  className?: string;
  /** Show when the child (or any descendant) receives focus — for keyboard users. */
  openOnFocus?: boolean;
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  position = 'top',
  delay = 200,
  className = '',
  openOnFocus = false,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; transform: string } | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    let top = 0;
    let left = 0;
    let transform = '';

    switch (position) {
      case 'top':
        left = rect.left + rect.width / 2;
        top = rect.top - GAP;
        transform = 'translate(-50%, -100%)';
        break;
      case 'bottom':
        left = rect.left + rect.width / 2;
        top = rect.bottom + GAP;
        transform = 'translateX(-50%)';
        break;
      case 'left':
        left = rect.left - GAP;
        top = rect.top + rect.height / 2;
        transform = 'translate(-100%, -50%)';
        break;
      case 'right':
        left = rect.right + GAP;
        top = rect.top + rect.height / 2;
        transform = 'translateY(-50%)';
        break;
    }

    setCoords({ top, left, transform });
  }, [position]);

  const showTooltip = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setIsVisible(true), delay);
  };

  const hideTooltip = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsVisible(false);
    setCoords(null);
  };

  const handleFocusIn = (e: React.FocusEvent) => {
    if (!openOnFocus) return;
    const t = e.target as Node | null;
    if (!wrapperRef.current || !t || !wrapperRef.current.contains(t)) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsVisible(true);
  };

  const handleFocusOut = (e: React.FocusEvent) => {
    if (!openOnFocus) return;
    const next = e.relatedTarget as Node | null;
    if (wrapperRef.current && next && wrapperRef.current.contains(next)) return;
    hideTooltip();
  };

  useLayoutEffect(() => {
    if (isVisible && wrapperRef.current) {
      updatePosition();
    }
  }, [isVisible, updatePosition]);

  useEffect(() => {
    if (!isVisible) return;
    const onScroll = () => updatePosition();
    const onResize = () => updatePosition();
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [isVisible, updatePosition]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <>
      <div
        ref={wrapperRef}
        className={`tooltip-wrapper ${className}`}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={openOnFocus ? handleFocusIn : undefined}
        onBlur={openOnFocus ? handleFocusOut : undefined}
      >
        {children}
      </div>
      {isVisible && coords && createPortal(
        <div
          className="tooltip tooltip--portal"
          role="tooltip"
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            transform: coords.transform,
            zIndex: 1060,
          }}
        >
          {content}
        </div>,
        document.body
      )}
    </>
  );
};
