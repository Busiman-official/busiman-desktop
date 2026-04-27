import React from 'react';
import './BranchModuleCheckboxGroup.css';

export interface BranchModuleCheckboxGroupProps {
  label: string;
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  hint?: string;
}

function titleCaseSlug(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

export const BranchModuleCheckboxGroup: React.FC<BranchModuleCheckboxGroupProps> = ({
  label,
  options,
  value,
  onChange,
  disabled,
  hint,
}) => {
  const toggle = (slug: string) => {
    if (disabled) return;
    if (value.includes(slug)) onChange(value.filter((v) => v !== slug));
    else onChange([...value, slug]);
  };

  return (
    <div className="branch-module-checkbox-group">
      <div className="branch-module-checkbox-group__header">
        <span className="branch-module-checkbox-group__label">{label}</span>
        {!disabled && options.length > 0 ? (
          <span className="branch-module-checkbox-group__actions">
            <button type="button" className="branch-module-checkbox-group__link" onClick={() => onChange([...options])}>
              Select all
            </button>
            <button type="button" className="branch-module-checkbox-group__link" onClick={() => onChange([])}>
              Clear
            </button>
          </span>
        ) : null}
      </div>
      <div className="branch-module-checkbox-group__grid" role="group" aria-label={label}>
        {options.length === 0 ? (
          <p className="branch-module-checkbox-group__empty">No modules are enabled for this branch.</p>
        ) : (
          options.map((opt) => (
            <label key={opt} className="branch-module-checkbox-group__item">
              <input type="checkbox" checked={value.includes(opt)} onChange={() => toggle(opt)} disabled={disabled} />
              <span>{titleCaseSlug(opt)}</span>
            </label>
          ))
        )}
      </div>
      {hint ? <small className="branch-module-checkbox-group__hint">{hint}</small> : null}
    </div>
  );
};
