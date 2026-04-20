import React from 'react';
import { Button, type ButtonProps } from '@/shared/components/ui';

/** Primary (filled) action — matches Sales module header primary controls */
export const ModuleHeaderPrimaryButton: React.FC<Omit<ButtonProps, 'variant' | 'size'>> = (props) => (
  <Button type="button" variant="primary" size="sm" {...props} />
);

/** Outline-style action — matches Sales module header secondary controls (e.g. Filter, Export) */
export const ModuleHeaderOutlineButton: React.FC<Omit<ButtonProps, 'variant' | 'size'>> = (props) => (
  <Button type="button" variant="secondary" size="sm" {...props} />
);
