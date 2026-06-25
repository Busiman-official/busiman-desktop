import React from 'react';

export interface CounterCartEmptyStateProps {
  title: string;
  subtitle: string;
}

export const CounterCartEmptyState: React.FC<CounterCartEmptyStateProps> = ({ title, subtitle }) => (
  <div className="pos-empty">
    <div className="pos-empty__box">
      <p className="pos-empty__title">{title}</p>
      <p className="pos-empty__sub">{subtitle}</p>
    </div>
  </div>
);
