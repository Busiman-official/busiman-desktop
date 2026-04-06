/**
 * Variant tab: editable variant fields + pricing/stock/logistics overrides.
 */

import { memo, useCallback } from 'react';
import { Input, Select } from '@/shared/components/ui';
import { ImageUpload } from '@/shared/components/ui';
import type { WizardVariantImage } from '../variantGridModel';
import { VARIANT_UNIT_OPTIONS } from '../variantGridUnits';

export type VariantLevelSectionProps = {
  variantName: string;
  barcode: string;
  unitOfMeasure: string;
  baseSkuPreview: string;
  images: WizardVariantImage[];
  supplierSku: string;
  /** GST HSN (India): 4, 6, or 8 digits. */
  hsn: string;
  costPriceOverride?: number;
  sellingPriceOverride?: number;
  mrpOverride?: number;
  taxOverride?: number;
  reorderLevel?: number;
  minStock?: number;
  maxStock?: number;
  weightOverride?: number;
  dimensionsOverride?: { length?: number; width?: number; height?: number };
  packSize?: number;
  unitsPerBox?: number;
  shelfLifeDaysOverride?: number;
  defaults: {
    costPrice?: number;
    sellingPrice?: number;
    mrp?: number;
    tax?: number;
    trackSerial?: boolean;
    trackBatch?: boolean;
    weight?: number;
    dimensions?: { length?: number; width?: number; height?: number };
    shelfLifeDays?: number;
  };
  onVariantNameChange: (value: string) => void;
  onBarcodeChange: (value: string) => void;
  onUnitOfMeasureChange: (value: string) => void;
  onImagesChange: (images: WizardVariantImage[]) => void;
  onSupplierSkuChange: (value: string) => void;
  onHsnChange: (value: string) => void;
  onCostPriceOverrideChange: (value: number | undefined) => void;
  onSellingPriceOverrideChange: (value: number | undefined) => void;
  onMrpOverrideChange: (value: number | undefined) => void;
  onTaxOverrideChange: (value: number | undefined) => void;
  onReorderLevelChange: (value: number | undefined) => void;
  onMinStockChange: (value: number | undefined) => void;
  onMaxStockChange: (value: number | undefined) => void;
  onWeightOverrideChange: (value: number | undefined) => void;
  onDimensionsOverrideChange: (value: { length?: number; width?: number; height?: number } | undefined) => void;
  onPackSizeChange: (value: number | undefined) => void;
  onUnitsPerBoxChange: (value: number | undefined) => void;
  onShelfLifeDaysOverrideChange: (value: number | undefined) => void;
};

function VariantLevelSectionInner({
  variantName,
  barcode,
  unitOfMeasure,
  baseSkuPreview,
  images,
  supplierSku,
  hsn,
  costPriceOverride,
  sellingPriceOverride,
  mrpOverride,
  taxOverride,
  reorderLevel,
  minStock,
  maxStock,
  weightOverride,
  dimensionsOverride,
  packSize,
  unitsPerBox,
  shelfLifeDaysOverride,
  defaults,
  onCodeSuffixChange,
  onVariantNameChange,
  onBarcodeChange,
  onUnitOfMeasureChange,
  onImagesChange,
  onSupplierSkuChange,
  onHsnChange,
  onCostPriceOverrideChange,
  onSellingPriceOverrideChange,
  onMrpOverrideChange,
  onTaxOverrideChange,
  onReorderLevelChange,
  onMinStockChange,
  onMaxStockChange,
  onWeightOverrideChange,
  onDimensionsOverrideChange,
  onPackSizeChange,
  onUnitsPerBoxChange,
  onShelfLifeDaysOverrideChange,
}: VariantLevelSectionProps) {
  const handleReorderPrimary = useCallback(
    (next: WizardVariantImage[]) => {
      onImagesChange(next);
    },
    [onImagesChange]
  );

  return (
    <div className="product-variant-details-sections">
      <section
        className="product-variant-details-section product-variant-details-section--photos"
        aria-labelledby="pvd-var-photos-heading"
      >
        <ImageUpload images={images} onChange={handleReorderPrimary} maxImages={10} folder="inventory" />
      </section>

      <section className="product-variant-details-section" aria-labelledby="pvd-var-summary-heading">
        <h3 id="pvd-var-summary-heading" className="product-variant-details-section-title">
          Variant fields
        </h3>
        <div className="product-variant-details-form-grid">
          <div className="product-variant-details-field">
            <label htmlFor="pvd-variant-name" className="product-variant-details-label">
              Name
            </label>
            <Input
              id="pvd-variant-name"
              value={variantName}
              onChange={(e) => onVariantNameChange(e.target.value)}
              placeholder="e.g. Small"
              aria-label="Variant name"
            />
          </div>
          <div className="product-variant-details-field">
            <label htmlFor="pvd-barcode" className="product-variant-details-label">
              Barcode
            </label>
            <Input
              id="pvd-barcode"
              value={barcode}
              onChange={(e) => onBarcodeChange(e.target.value)}
              placeholder="Optional"
              aria-label="Variant barcode"
            />
          </div>
          <div className="product-variant-details-field">
            <label htmlFor="pvd-unit" className="product-variant-details-label">
              Unit
            </label>
            <Select
              id="pvd-unit"
              options={VARIANT_UNIT_OPTIONS}
              value={unitOfMeasure}
              onChange={(e) => onUnitOfMeasureChange(e.target.value)}
              aria-label="Variant unit"
            />
          </div>
        </div>
        <p className="product-variant-details-readonly">
          <span className="product-variant-details-label">SKU preview</span>
          <span className="product-variant-details-value product-variant-details-mono">{baseSkuPreview || '—'}</span>
        </p>
      </section>

      <section className="product-variant-details-section" aria-labelledby="pvd-pricing-heading">
        <h3 id="pvd-pricing-heading" className="product-variant-details-section-title">
          Pricing & Tax
        </h3>
        <div className="product-variant-details-form-grid">
          <div className="product-variant-details-field">
            <label className="product-variant-details-label">Cost price</label>
            <Input
              type="number"
              min={0}
              step={0.01}
              value={costPriceOverride ?? ''}
              onChange={(e) => onCostPriceOverrideChange(e.target.value === '' ? undefined : Number(e.target.value))}
              placeholder={defaults.costPrice != null ? String(defaults.costPrice) : 'cost price'}
            />
          </div>
          <div className="product-variant-details-field">
            <label className="product-variant-details-label">Selling price</label>
            <Input
              type="number"
              min={0}
              step={0.01}
              value={sellingPriceOverride ?? ''}
              onChange={(e) => onSellingPriceOverrideChange(e.target.value === '' ? undefined : Number(e.target.value))}
              placeholder={defaults.sellingPrice != null ? String(defaults.sellingPrice) : 'selling price'}
            />
          </div>
          <div className="product-variant-details-field">
            <label className="product-variant-details-label">MRP</label>
            <Input
              type="number"
              min={0}
              step={0.01}
              value={mrpOverride ?? ''}
              onChange={(e) => onMrpOverrideChange(e.target.value === '' ? undefined : Number(e.target.value))}
              placeholder={defaults.mrp != null ? String(defaults.mrp) : 'mrp'}
            />
          </div>
          <div className="product-variant-details-field">
            <label className="product-variant-details-label">Tax (GST/VAT %)</label>
            <Input
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={taxOverride ?? ''}
              onChange={(e) => onTaxOverrideChange(e.target.value === '' ? undefined : Number(e.target.value))}
              placeholder={defaults.tax != null ? String(defaults.tax) : 'tax'}
            />
          </div>
          <div className="product-variant-details-field">
            <label htmlFor="pvd-hsn" className="product-variant-details-label">
              HSN
            </label>
            <Input
              id="pvd-hsn"
              inputMode="numeric"
              maxLength={8}
              value={hsn}
              onChange={(e) => onHsnChange(e.target.value.replace(/\D/g, '').slice(0, 8))}
              placeholder="4, 6, or 8 digits"
              aria-label="HSN code for this variant"
            />
            <span className="product-variant-details-hint">GST India — per variant</span>
          </div>
        </div>
      </section>

      <section className="product-variant-details-section" aria-labelledby="pvd-stock-heading">
        <h3 id="pvd-stock-heading" className="product-variant-details-section-title">
          Stock Behavior
        </h3>
        <div className="product-variant-details-form-grid">
          <div className="product-variant-details-field">
            <label className="product-variant-details-label">Reorder level</label>
            <Input type="number" min={0} step={1} value={reorderLevel ?? ''} onChange={(e) => onReorderLevelChange(e.target.value === '' ? undefined : Number(e.target.value))} />
          </div>
          <div className="product-variant-details-field">
            <label className="product-variant-details-label">Min stock</label>
            <Input type="number" min={0} step={1} value={minStock ?? ''} onChange={(e) => onMinStockChange(e.target.value === '' ? undefined : Number(e.target.value))} />
          </div>
          <div className="product-variant-details-field">
            <label className="product-variant-details-label">Max stock</label>
            <Input type="number" min={0} step={1} value={maxStock ?? ''} onChange={(e) => onMaxStockChange(e.target.value === '' ? undefined : Number(e.target.value))} />
          </div>
        </div>
      </section>

      <section className="product-variant-details-section" aria-labelledby="pvd-logistics-heading">
        <h3 id="pvd-logistics-heading" className="product-variant-details-section-title">
          Physical & Logistics
        </h3>
        <div className="product-variant-details-form-grid">
          <div className="product-variant-details-field">
            <label className="product-variant-details-label">Weight</label>
            <Input
              type="number"
              min={0}
              step={0.01}
              value={weightOverride ?? ''}
              onChange={(e) => onWeightOverrideChange(e.target.value === '' ? undefined : Number(e.target.value))}
              placeholder={defaults.weight != null ? String(defaults.weight) : 'weight'}
            />
          </div>
          <div className="product-variant-details-field">
            <label className="product-variant-details-label">Length</label>
            <Input type="number" min={0} step={0.01} value={dimensionsOverride?.length ?? ''} onChange={(e) => onDimensionsOverrideChange({ ...dimensionsOverride, length: e.target.value === '' ? undefined : Number(e.target.value) })} />
          </div>
          <div className="product-variant-details-field">
            <label className="product-variant-details-label">Width</label>
            <Input type="number" min={0} step={0.01} value={dimensionsOverride?.width ?? ''} onChange={(e) => onDimensionsOverrideChange({ ...dimensionsOverride, width: e.target.value === '' ? undefined : Number(e.target.value) })} />
          </div>
          <div className="product-variant-details-field">
            <label className="product-variant-details-label">Height</label>
            <Input type="number" min={0} step={0.01} value={dimensionsOverride?.height ?? ''} onChange={(e) => onDimensionsOverrideChange({ ...dimensionsOverride, height: e.target.value === '' ? undefined : Number(e.target.value) })} />
          </div>
          <div className="product-variant-details-field">
            <label className="product-variant-details-label">Pack size</label>
            <Input type="number" min={0} step={1} value={packSize ?? ''} onChange={(e) => onPackSizeChange(e.target.value === '' ? undefined : Number(e.target.value))} />
          </div>
          <div className="product-variant-details-field">
            <label className="product-variant-details-label">Units per box</label>
            <Input type="number" min={0} step={1} value={unitsPerBox ?? ''} onChange={(e) => onUnitsPerBoxChange(e.target.value === '' ? undefined : Number(e.target.value))} />
          </div>
          <div className="product-variant-details-field">
            <label className="product-variant-details-label">Shelf life days</label>
            <Input
              type="number"
              min={0}
              step={1}
              value={shelfLifeDaysOverride ?? ''}
              onChange={(e) => onShelfLifeDaysOverrideChange(e.target.value === '' ? undefined : Number(e.target.value))}
              placeholder={defaults.shelfLifeDays != null ? String(defaults.shelfLifeDays) : 'shelf life days'}
            />
          </div>
        </div>
      </section>

      <section className="product-variant-details-section" aria-labelledby="pvd-var-supplier-heading">
        <h3 id="pvd-var-supplier-heading" className="product-variant-details-section-title">
          Supplier SKU
        </h3>
        <Input
          id="pvd-supplier-sku"
          value={supplierSku}
          onChange={(e) => onSupplierSkuChange(e.target.value)}
          placeholder="Optional supplier or alternate code"
          aria-label="Supplier SKU"
        />
      </section>
    </div>
  );
}

export const VariantLevelSection = memo(VariantLevelSectionInner);
