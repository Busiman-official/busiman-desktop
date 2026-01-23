/**
 * Serial Breadcrumb Component - Navigation context for serials
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { getSerialBreadcrumb, BreadcrumbItem } from '../utils/serialNavigation';
import './SerialBreadcrumb.css';

interface SerialBreadcrumbProps {
  itemId?: string;
  itemName?: string;
  variantId?: string;
  variantName?: string;
  serialNumber?: string;
}

export const SerialBreadcrumb: React.FC<SerialBreadcrumbProps> = ({
  itemId,
  itemName,
  variantId,
  variantName,
  serialNumber,
}) => {
  const navigate = useNavigate();
  const breadcrumbs = getSerialBreadcrumb(itemId, itemName, variantId, variantName, serialNumber);

  const handleBreadcrumbClick = (item: BreadcrumbItem) => {
    if (item.path) {
      navigate(item.path);
    }
  };

  return (
    <nav className="serial-breadcrumb" aria-label="Breadcrumb">
      <ol className="serial-breadcrumb-list">
        {breadcrumbs.map((item, index) => {
          const isLast = index === breadcrumbs.length - 1;
          return (
            <li key={index} className="serial-breadcrumb-item">
              {item.path && !isLast ? (
                <button
                  className="serial-breadcrumb-link"
                  onClick={() => handleBreadcrumbClick(item)}
                  type="button"
                >
                  {item.label}
                </button>
              ) : (
                <span className="serial-breadcrumb-current">{item.label}</span>
              )}
              {!isLast && <span className="serial-breadcrumb-separator">›</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
