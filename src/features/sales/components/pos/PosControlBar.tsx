import React from 'react';
import { Select } from '@/shared/components/ui';
import type { SelectOption } from '@/shared/components/ui';
import './PosControlBar.css';

export interface PosControlBarProps {
  salesPointId: string | null;
  salesPointOptions: SelectOption[];
  onSalesPointChange: (id: string) => void;
  showOrderControls?: boolean;
  adminBranchSelect?: React.ReactNode;
  /** Shown on the far right of the bar (e.g. tab-specific primary actions) */
  trailing?: React.ReactNode;
}

export const PosControlBar: React.FC<PosControlBarProps> = ({
  salesPointId,
  salesPointOptions,
  onSalesPointChange,
  showOrderControls = true,
  adminBranchSelect,
  trailing,
}) => {
  return (
    <header className="pos-control-bar">
      <div className="pos-control-bar__row">
        <div className="pos-control-bar__brand">
          <span className="pos-control-bar__title">Sales</span>
        </div>

        {showOrderControls ? (
          <div className="pos-control-bar__fields">
            <Select
              value={salesPointId || ''}
              onChange={(e) => onSalesPointChange(e.target.value)}
              options={salesPointOptions}
              placeholder="Sales point"
            />
          </div>
        ) : null}

        {adminBranchSelect ? <div className="pos-control-bar__admin">{adminBranchSelect}</div> : null}

        {trailing ? <div className="pos-control-bar__trailing">{trailing}</div> : null}
      </div>
    </header>
  );
};
