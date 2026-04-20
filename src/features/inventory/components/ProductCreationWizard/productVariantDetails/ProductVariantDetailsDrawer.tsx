/**
 * Right drawer: selected variant details only (wizard step 2).
 */

import { useCallback, useState } from 'react';
import { SideDrawer } from '@/shared/components/modals';
import { Button } from '@/shared/components/ui';
import type { WizardVariantRow } from '../variantGridModel';
import { VariantLevelSection } from './VariantLevelSection';
import { resolveVariantUnit } from '../variantGridUnits';
import './productVariantDetailsDrawer.css';

function normalizeOptionalNumber(n: number | null | undefined): number | undefined {
  if (n == null || (typeof n === 'number' && Number.isNaN(n))) return undefined;
  return n;
}

/** Align with apply/save logic so “dirty” detection matches what we persist. */
function effectiveDimensionsOverride(
  d: WizardVariantRow['dimensionsOverride'] | undefined,
): WizardVariantRow['dimensionsOverride'] | undefined {
  if (!d) return undefined;
  if (d.length == null && d.width == null && d.height == null) return undefined;
  return d;
}

export type ProductVariantDetailsDrawerApplyPayload = {
  variantPatch: Partial<
    Pick<
      WizardVariantRow,
      | 'value'
      | 'name'
      | 'barcode'
      | 'unitOfMeasure'
      | 'images'
      | 'supplierSku'
      | 'hsn'
      | 'costPriceOverride'
      | 'sellingPriceOverride'
      | 'mrpOverride'
      | 'taxOverride'
      | 'reorderLevel'
      | 'minStock'
      | 'maxStock'
      | 'allowBackorder'
      | 'trackSerialOverride'
      | 'trackBatchOverride'
      | 'isActive'
      | 'isDiscontinued'
      | 'weightOverride'
      | 'dimensionsOverride'
      | 'packSize'
      | 'unitsPerBox'
      | 'shelfLifeDaysOverride'
    >
  >;
};

export type ProductVariantDetailsDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  initialVariantRow: WizardVariantRow | null;
  productDefaultUnit: string;
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
  baseSkuPreview: string;
  onApply: (payload: ProductVariantDetailsDrawerApplyPayload) => void;
};

export function ProductVariantDetailsDrawer({
  isOpen,
  onClose,
  initialVariantRow,
  productDefaultUnit,
  defaults,
  baseSkuPreview,
  onApply,
}: ProductVariantDetailsDrawerProps) {
  const [variantName, setVariantName] = useState(() => initialVariantRow?.name ?? '');
  const [barcode, setBarcode] = useState(() => initialVariantRow?.barcode ?? '');
  const [unitOfMeasure, setUnitOfMeasure] = useState(() =>
    resolveVariantUnit(initialVariantRow?.unitOfMeasure, productDefaultUnit)
  );
  const [images, setImages] = useState<NonNullable<WizardVariantRow['images']>>(() =>
    initialVariantRow?.images?.length ? initialVariantRow.images.map((i) => ({ ...i })) : []
  );
  const [supplierSku, setSupplierSku] = useState(() => initialVariantRow?.supplierSku ?? '');
  const [hsn, setHsn] = useState(() => initialVariantRow?.hsn ?? '');
  const [costPriceOverride, setCostPriceOverride] = useState<number | undefined>(initialVariantRow?.costPriceOverride);
  const [sellingPriceOverride, setSellingPriceOverride] = useState<number | undefined>(initialVariantRow?.sellingPriceOverride);
  const [mrpOverride, setMrpOverride] = useState<number | undefined>(initialVariantRow?.mrpOverride);
  const [taxOverride, setTaxOverride] = useState<number | undefined>(initialVariantRow?.taxOverride);
  const [reorderLevel, setReorderLevel] = useState<number | undefined>(initialVariantRow?.reorderLevel);
  const [minStock, setMinStock] = useState<number | undefined>(initialVariantRow?.minStock);
  const [maxStock, setMaxStock] = useState<number | undefined>(initialVariantRow?.maxStock);
  const [allowBackorder] = useState<boolean | undefined>(initialVariantRow?.allowBackorder);
  const [trackSerialOverride] = useState<boolean | undefined>(initialVariantRow?.trackSerialOverride);
  const [trackBatchOverride] = useState<boolean | undefined>(initialVariantRow?.trackBatchOverride);
  const [isActive] = useState<boolean | undefined>(initialVariantRow?.isActive);
  const [isDiscontinued] = useState<boolean | undefined>(initialVariantRow?.isDiscontinued);
  const [weightOverride, setWeightOverride] = useState<number | undefined>(initialVariantRow?.weightOverride);
  const [dimensionsOverride, setDimensionsOverride] = useState<WizardVariantRow['dimensionsOverride']>(
    initialVariantRow?.dimensionsOverride ? { ...initialVariantRow.dimensionsOverride } : undefined
  );
  const [packSize, setPackSize] = useState<number | undefined>(initialVariantRow?.packSize);
  const [unitsPerBox, setUnitsPerBox] = useState<number | undefined>(initialVariantRow?.unitsPerBox);
  const [shelfLifeDaysOverride, setShelfLifeDaysOverride] = useState<number | undefined>(initialVariantRow?.shelfLifeDaysOverride);
  const [validationError, setValidationError] = useState<string | null>(null);
  const selectedVariantLabel = (variantName || initialVariantRow?.name || '')
    .trim();
  const drawerTitle = selectedVariantLabel ? `Variant details - ${selectedVariantLabel}` : 'Variant details';
  const hasUnsavedChanges = useCallback((): boolean => {
    if (!initialVariantRow) return false;
    const same = {
      name: (variantName ?? '').trim(),
      barcode: String(barcode ?? '').trim(),
      unitOfMeasure: resolveVariantUnit(unitOfMeasure, productDefaultUnit),
      images: [...images]
        .map((i) => ({ url: i.url, publicId: i.publicId, isPrimary: i.isPrimary }))
        .sort((a, b) => a.publicId.localeCompare(b.publicId)),
      supplierSku: String(supplierSku ?? '').trim(),
      hsn: hsn.trim(),
      costPriceOverride: normalizeOptionalNumber(costPriceOverride),
      sellingPriceOverride: normalizeOptionalNumber(sellingPriceOverride),
      mrpOverride: normalizeOptionalNumber(mrpOverride),
      taxOverride: normalizeOptionalNumber(taxOverride),
      reorderLevel: normalizeOptionalNumber(reorderLevel),
      minStock: normalizeOptionalNumber(minStock),
      maxStock: normalizeOptionalNumber(maxStock),
      weightOverride: normalizeOptionalNumber(weightOverride),
      dimensionsOverride: effectiveDimensionsOverride(dimensionsOverride),
      packSize: normalizeOptionalNumber(packSize),
      unitsPerBox: normalizeOptionalNumber(unitsPerBox),
      shelfLifeDaysOverride: normalizeOptionalNumber(shelfLifeDaysOverride),
    };
    const base = {
      name: (initialVariantRow.name ?? '').trim(),
      barcode: String(initialVariantRow.barcode ?? '').trim(),
      unitOfMeasure: resolveVariantUnit(initialVariantRow.unitOfMeasure, productDefaultUnit),
      images: [...(initialVariantRow.images ?? [])]
        .map((i) => ({ url: i.url, publicId: i.publicId, isPrimary: i.isPrimary }))
        .sort((a, b) => a.publicId.localeCompare(b.publicId)),
      supplierSku: String(initialVariantRow.supplierSku ?? '').trim(),
      hsn: (initialVariantRow.hsn ?? '').trim(),
      costPriceOverride: normalizeOptionalNumber(initialVariantRow.costPriceOverride),
      sellingPriceOverride: normalizeOptionalNumber(initialVariantRow.sellingPriceOverride),
      mrpOverride: normalizeOptionalNumber(initialVariantRow.mrpOverride),
      taxOverride: normalizeOptionalNumber(initialVariantRow.taxOverride),
      reorderLevel: normalizeOptionalNumber(initialVariantRow.reorderLevel),
      minStock: normalizeOptionalNumber(initialVariantRow.minStock),
      maxStock: normalizeOptionalNumber(initialVariantRow.maxStock),
      weightOverride: normalizeOptionalNumber(initialVariantRow.weightOverride),
      dimensionsOverride: effectiveDimensionsOverride(initialVariantRow.dimensionsOverride),
      packSize: normalizeOptionalNumber(initialVariantRow.packSize),
      unitsPerBox: normalizeOptionalNumber(initialVariantRow.unitsPerBox),
      shelfLifeDaysOverride: normalizeOptionalNumber(initialVariantRow.shelfLifeDaysOverride),
    };
    return JSON.stringify(same) !== JSON.stringify(base);
  }, [
    initialVariantRow,
    variantName,
    barcode,
    unitOfMeasure,
    productDefaultUnit,
    images,
    supplierSku,
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
    hsn,
  ]);

  const HSN_PATTERN = /^\d{4}(\d{2}){0,2}$/;

  const handleApply = useCallback(() => {
    if (minStock != null && maxStock != null && minStock > maxStock) {
      setValidationError('Min stock cannot be greater than max stock.');
      return;
    }
    const hsnTrim = hsn.trim();
    if (hsnTrim && !HSN_PATTERN.test(hsnTrim)) {
      setValidationError('HSN must be 4, 6, or 8 digits (GST India).');
      return;
    }
    setValidationError(null);
    const variantPatch: ProductVariantDetailsDrawerApplyPayload['variantPatch'] = {
      name: variantName,
      barcode: barcode.trim() || undefined,
      unitOfMeasure: resolveVariantUnit(unitOfMeasure, productDefaultUnit),
      images: images.length > 0 ? images.map((i) => ({ ...i })) : undefined,
      supplierSku: supplierSku.trim() || undefined,
      hsn: hsnTrim || undefined,
      costPriceOverride,
      sellingPriceOverride,
      mrpOverride,
      taxOverride,
      reorderLevel,
      minStock,
      maxStock,
      allowBackorder,
      trackSerialOverride,
      trackBatchOverride,
      isActive,
      isDiscontinued,
      weightOverride,
      dimensionsOverride:
        dimensionsOverride && (dimensionsOverride.length != null || dimensionsOverride.width != null || dimensionsOverride.height != null)
          ? dimensionsOverride
          : undefined,
      packSize,
      unitsPerBox,
      shelfLifeDaysOverride,
    };
    onApply({ variantPatch });
    onClose();
  }, [
    variantName,
    barcode,
    unitOfMeasure,
    productDefaultUnit,
    images,
    supplierSku,
    costPriceOverride,
    sellingPriceOverride,
    mrpOverride,
    taxOverride,
    reorderLevel,
    minStock,
    maxStock,
    allowBackorder,
    trackSerialOverride,
    trackBatchOverride,
    isActive,
    isDiscontinued,
    weightOverride,
    dimensionsOverride,
    packSize,
    unitsPerBox,
    shelfLifeDaysOverride,
    hsn,
    onApply,
    onClose,
  ]);

  const handleCancel = useCallback(() => {
    if (hasUnsavedChanges()) {
      const confirmed = window.confirm('Discard draft and close?');
      if (!confirmed) return;
    }
    onClose();
  }, [hasUnsavedChanges, onClose]);

  return (
    <SideDrawer
      isOpen={isOpen}
      onClose={handleCancel}
      title={drawerTitle}
      width="520px"
      className="product-variant-details-side-drawer"
    >
      <div className="product-variant-details-inner">

        <div className="product-variant-details-panel product-variant-details-panel--solo">
          {!initialVariantRow ? (
            <p className="product-variant-details-empty">No variant selected.</p>
          ) : (
            <>
              {validationError ? <p className="product-variant-details-empty">{validationError}</p> : null}
              <VariantLevelSection
                variantName={variantName}
                barcode={barcode}
                unitOfMeasure={unitOfMeasure}
                baseSkuPreview={baseSkuPreview}
                images={images}
                supplierSku={supplierSku}
                hsn={hsn}
                costPriceOverride={costPriceOverride}
                sellingPriceOverride={sellingPriceOverride}
                mrpOverride={mrpOverride}
                taxOverride={taxOverride}
                reorderLevel={reorderLevel}
                minStock={minStock}
                maxStock={maxStock}
                weightOverride={weightOverride}
                dimensionsOverride={dimensionsOverride}
                packSize={packSize}
                unitsPerBox={unitsPerBox}
                shelfLifeDaysOverride={shelfLifeDaysOverride}
                defaults={defaults}
                onVariantNameChange={setVariantName}
                onBarcodeChange={setBarcode}
                onUnitOfMeasureChange={setUnitOfMeasure}
                onImagesChange={setImages}
                onSupplierSkuChange={setSupplierSku}
                onHsnChange={setHsn}
                onCostPriceOverrideChange={setCostPriceOverride}
                onSellingPriceOverrideChange={setSellingPriceOverride}
                onMrpOverrideChange={setMrpOverride}
                onTaxOverrideChange={setTaxOverride}
                onReorderLevelChange={setReorderLevel}
                onMinStockChange={setMinStock}
                onMaxStockChange={setMaxStock}
                onWeightOverrideChange={setWeightOverride}
                onDimensionsOverrideChange={setDimensionsOverride}
                onPackSizeChange={setPackSize}
                onUnitsPerBoxChange={setUnitsPerBox}
                onShelfLifeDaysOverrideChange={setShelfLifeDaysOverride}
              />
            </>
          )}
        </div>

        <div className="product-variant-details-footer">
          <Button type="button" variant="secondary" onClick={handleCancel}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={handleApply} disabled={!initialVariantRow}>
            Apply
          </Button>
        </div>
      </div>
    </SideDrawer>
  );
}
