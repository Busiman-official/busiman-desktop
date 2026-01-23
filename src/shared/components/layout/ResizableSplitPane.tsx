import React, { useState, useEffect, useRef, useCallback } from 'react';
import './ResizableSplitPane.css';

export interface ResizableSplitPaneProps {
  left: React.ReactNode;
  right: React.ReactNode;
  leftMin?: number;
  leftMaxPercent?: number;
  rightMin?: number;
  handleSize?: number;
  storageKey?: string;
  defaultLeftPercent?: number;
  leftClassName?: string;
  rightClassName?: string;
  /** When true, right pane is collapsed (0 width) and left takes full space. */
  rightCollapsed?: boolean;
  /** Called when user drags to expand from collapsed or to collapse the right pane. */
  onRightCollapsedChange?: (collapsed: boolean) => void;
}

export const ResizableSplitPane: React.FC<ResizableSplitPaneProps> = ({
  left,
  right,
  leftMin = 250,
  leftMaxPercent = 60,
  rightMin = 400,
  handleSize = 8,
  storageKey,
  defaultLeftPercent = 60,
  leftClassName = '',
  rightClassName = '',
  rightCollapsed = false,
  onRightCollapsedChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [leftWidth, setLeftWidth] = useState<number>(leftMin);
  const [isDragging, setIsDragging] = useState(false);
  const rafRef = useRef<number | null>(null);
  const startXRef = useRef<number>(0);
  const startLeftRef = useRef<number>(0);
  const initializedRef = useRef(false);
  const currentLeftWidthRef = useRef<number>(leftMin);

  // Clamp leftWidth to valid range
  const clampLeftWidth = useCallback((width: number, containerWidth: number): number => {
    if (containerWidth <= 0) return leftMin;
    
    const maxByPercent = (leftMaxPercent / 100) * containerWidth;
    const maxByRightMin = containerWidth - rightMin - handleSize;
    const maxWidth = Math.min(maxByPercent, maxByRightMin);
    
    return Math.max(leftMin, Math.min(width, maxWidth));
  }, [leftMin, leftMaxPercent, rightMin, handleSize]);

  // Initialize from localStorage or default (when not collapsed)
  useEffect(() => {
    if (initializedRef.current || !containerRef.current || rightCollapsed) return;
    
    const containerWidth = containerRef.current.getBoundingClientRect().width;
    if (containerWidth <= 0) return;

    initializedRef.current = true;

    let ratio: number;
    if (storageKey) {
      const stored = localStorage.getItem(storageKey);
      const parsed = stored ? parseFloat(stored) : NaN;
      ratio = isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : defaultLeftPercent / 100;
    } else {
      ratio = defaultLeftPercent / 100;
    }

    const initialWidth = clampLeftWidth(ratio * containerWidth, containerWidth);
    setLeftWidth(initialWidth);
    currentLeftWidthRef.current = initialWidth;
  }, [clampLeftWidth, storageKey, defaultLeftPercent, rightCollapsed]);

  // When expanding from collapsed (e.g. double-click), set leftWidth so right pane gets space
  const prevRightCollapsedRef = useRef(rightCollapsed);
  useEffect(() => {
    if (prevRightCollapsedRef.current === rightCollapsed) return;
    prevRightCollapsedRef.current = rightCollapsed;
    if (rightCollapsed || !containerRef.current) return;

    const containerWidth = containerRef.current.getBoundingClientRect().width;
    if (containerWidth <= 0) return;

    let ratio: number;
    if (storageKey) {
      const stored = localStorage.getItem(storageKey);
      const parsed = stored ? parseFloat(stored) : NaN;
      ratio = isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : defaultLeftPercent / 100;
    } else {
      ratio = defaultLeftPercent / 100;
    }
    const w = clampLeftWidth(ratio * containerWidth, containerWidth);
    setLeftWidth(w);
    currentLeftWidthRef.current = w;
  }, [rightCollapsed, clampLeftWidth, storageKey, defaultLeftPercent]);

  // ResizeObserver to handle container size changes and initialize if needed
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver(() => {
      if (!containerRef.current) return;
      const containerWidth = containerRef.current.getBoundingClientRect().width;
      if (containerWidth <= 0) return;

      // Initialize on first resize if not already initialized
      if (!initializedRef.current) {
        initializedRef.current = true;
        let ratio: number;
        if (storageKey) {
          const stored = localStorage.getItem(storageKey);
          const parsed = stored ? parseFloat(stored) : NaN;
          ratio = isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : defaultLeftPercent / 100;
        } else {
          ratio = defaultLeftPercent / 100;
        }
        const initialWidth = clampLeftWidth(ratio * containerWidth, containerWidth);
        setLeftWidth(initialWidth);
        currentLeftWidthRef.current = initialWidth;
        return;
      }

      // Reclamp current leftWidth to ensure it's still valid
      setLeftWidth(prev => {
        const clamped = clampLeftWidth(prev, containerWidth);
        currentLeftWidthRef.current = clamped;
        return clamped;
      });
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [clampLeftWidth, storageKey, defaultLeftPercent]);

  // Add/remove body class during drag for global cursor and user-select
  useEffect(() => {
    if (isDragging) {
      document.body.classList.add('resizing');
    } else {
      document.body.classList.remove('resizing');
    }
    return () => {
      document.body.classList.remove('resizing');
    };
  }, [isDragging]);

  // Handle mouse drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;

    // Expanding from collapsed: give right pane space and notify parent
    if (rightCollapsed) {
      onRightCollapsedChange?.(false);
      const cw = containerRef.current.getBoundingClientRect().width;
      if (cw > 0) {
        let ratio = defaultLeftPercent / 100;
        if (storageKey) {
          const st = localStorage.getItem(storageKey);
          const p = st ? parseFloat(st) : NaN;
          if (isFinite(p) && p > 0 && p < 1) ratio = p;
        }
        const w = clampLeftWidth(ratio * cw, cw);
        setLeftWidth(w);
        startLeftRef.current = w;
        currentLeftWidthRef.current = w;
      }
    } else {
      startLeftRef.current = leftWidth;
    }

    setIsDragging(true);
    startXRef.current = e.clientX;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      
      const containerWidth = containerRef.current.getBoundingClientRect().width;
      const delta = e.clientX - startXRef.current;
      const nextWidth = clampLeftWidth(startLeftRef.current + delta, containerWidth);

      // Use requestAnimationFrame to throttle updates
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          setLeftWidth(nextWidth);
          currentLeftWidthRef.current = nextWidth;
          rafRef.current = null;
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);

      // Persist ratio to localStorage using current ref value
      if (storageKey && containerRef.current) {
        const containerWidth = containerRef.current.getBoundingClientRect().width;
        if (containerWidth > 0) {
          const ratio = currentLeftWidthRef.current / containerWidth;
          localStorage.setItem(storageKey, ratio.toFixed(4));
        }
        // If right pane ended up very narrow, collapse it
        const rightW = containerWidth - currentLeftWidthRef.current - handleSize;
        if (rightW < 50) onRightCollapsedChange?.(true);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [leftWidth, clampLeftWidth, storageKey, rightCollapsed, onRightCollapsedChange, defaultLeftPercent, handleSize]);

  // Handle touch drag
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!containerRef.current) return;
    if (e.touches.length !== 1) return;

    e.preventDefault();
    if (rightCollapsed) {
      onRightCollapsedChange?.(false);
      const cw = containerRef.current.getBoundingClientRect().width;
      if (cw > 0) {
        let ratio = defaultLeftPercent / 100;
        if (storageKey) {
          const st = localStorage.getItem(storageKey);
          const p = st ? parseFloat(st) : NaN;
          if (isFinite(p) && p > 0 && p < 1) ratio = p;
        }
        const w = clampLeftWidth(ratio * cw, cw);
        setLeftWidth(w);
        startLeftRef.current = w;
        currentLeftWidthRef.current = w;
      }
    } else {
      startLeftRef.current = leftWidth;
    }
    setIsDragging(true);
    startXRef.current = e.touches[0].clientX;

    const handleTouchMove = (e: TouchEvent) => {
      if (!containerRef.current || e.touches.length !== 1) return;
      
      e.preventDefault();
      const containerWidth = containerRef.current.getBoundingClientRect().width;
      const delta = e.touches[0].clientX - startXRef.current;
      const nextWidth = clampLeftWidth(startLeftRef.current + delta, containerWidth);

      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          setLeftWidth(nextWidth);
          currentLeftWidthRef.current = nextWidth;
          rafRef.current = null;
        });
      }
    };

    const handleTouchEnd = () => {
      setIsDragging(false);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);

      if (storageKey && containerRef.current) {
        const containerWidth = containerRef.current.getBoundingClientRect().width;
        if (containerWidth > 0) {
          const ratio = currentLeftWidthRef.current / containerWidth;
          localStorage.setItem(storageKey, ratio.toFixed(4));
        }
        const rightW = containerWidth - currentLeftWidthRef.current - handleSize;
        if (rightW < 50) onRightCollapsedChange?.(true);
      }
    };

    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
  }, [leftWidth, clampLeftWidth, storageKey, rightCollapsed, onRightCollapsedChange, defaultLeftPercent, handleSize]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!containerRef.current) return;
    
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const containerWidth = containerRef.current.getBoundingClientRect().width;
      const step = 20;
      const delta = e.key === 'ArrowLeft' ? -step : step;
      const nextWidth = clampLeftWidth(leftWidth + delta, containerWidth);
      
      setLeftWidth(nextWidth);
      currentLeftWidthRef.current = nextWidth;
      
      // Persist immediately on keyboard resize
      if (storageKey && containerWidth > 0) {
        const ratio = nextWidth / containerWidth;
        localStorage.setItem(storageKey, ratio.toFixed(4));
      }
    }
  }, [leftWidth, clampLeftWidth, storageKey]);

  // Calculate max width for aria-valuemax
  const containerWidth = containerRef.current?.getBoundingClientRect().width || 0;
  const maxByPercent = (leftMaxPercent / 100) * containerWidth;
  const maxByRightMin = containerWidth - rightMin - handleSize;
  const ariaMax = Math.min(maxByPercent, maxByRightMin);

  return (
    <div ref={containerRef} className="resize-split-container">
      <div
        className={`resize-pane-left ${leftClassName}`}
        style={rightCollapsed
          ? { flex: '1 1 0%', minWidth: `${leftMin}px`, minHeight: 0 }
          : {
              width: `${leftWidth}px`,
              minWidth: `${leftMin}px`,
              flexShrink: 0,
            }}
      >
        {left}
      </div>
      <div
        className={`resize-handle ${isDragging ? 'resizing' : ''}`}
        style={{ width: `${handleSize}px` }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onKeyDown={handleKeyDown}
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={rightCollapsed ? 0 : Math.round(leftWidth)}
        aria-valuemin={leftMin}
        aria-valuemax={Math.round(ariaMax)}
        aria-label="Resize list and details panels"
        tabIndex={0}
      />
      <div
        className={`resize-pane-right ${rightClassName}`}
        style={rightCollapsed
          ? { flex: '0 0 0', width: 0, minWidth: 0, overflow: 'hidden', minHeight: 0 }
          : {
              flex: '1 1 0%',
              minWidth: `${rightMin}px`,
              minHeight: 0,
            }}
      >
        {right}
      </div>
    </div>
  );
};
