import React, { useEffect, useMemo, useState } from 'react';
import { SideDrawer } from '@/shared/components/modals';
import { Button, Checkbox, ImageUpload, Input, Select } from '@/shared/components/ui';
import {
  type InventoryItem,
  IndustryType,
  ProductType,
  type UpdateInventoryItemRequest,
} from '@/services/inventory.service';
import { CATEGORY_OPTIONS, PRODUCT_TYPE_OPTIONS, getPresetForCategory, resolveInventoryBehavior } from '../constants/productCatalog';
import { VARIANT_UNIT_OPTIONS, type VariantUnitOption } from './ProductCreationWizard/variantGridUnits';
import type { ImageData } from '@/shared/components/ui/ImageUpload';

type AlternateUnitRow = {
  unitCode: string;
  factorToBase: string;
  isActive: boolean;
};

type EditMasterDrawerProps = {
  isOpen: boolean;
  item: InventoryItem | null;
  onClose: () => void;
  onSave: (itemId: string, data: UpdateInventoryItemRequest) => Promise<void>;
};

function initialIndustryType(item: InventoryItem): IndustryType {
  return item.industryClassification?.industryType ?? item.industryFlags?.industryType ?? IndustryType.FMCG;
}

function mapItemImages(item: InventoryItem): ImageData[] {
  return (item.images ?? []).map((img) => ({
    url: img.url,
    publicId: img.publicId,
    isPrimary: img.isPrimary,
  }));
}

export const EditMasterDrawer: React.FC<EditMasterDrawerProps> = ({ isOpen, item, onClose, onSave }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');
  const [productType, setProductType] = useState<ProductType>(ProductType.STOCK_ITEM);
  const [isMisc, setIsMisc] = useState(false);
  const [unitOfMeasure, setUnitOfMeasure] = useState<string>('pcs');
  const [alternateUnits, setAlternateUnits] = useState<AlternateUnitRow[]>([]);

  const [requiresBatchTracking, setRequiresBatchTracking] = useState(false);
  const [requiresSerialTracking, setRequiresSerialTracking] = useState(false);
  const [serialOptional, setSerialOptional] = useState(false);
  const [hasExpiryDate, setHasExpiryDate] = useState(false);
  const [serviceable, setServiceable] = useState(false);
  /** Off by default — this control now only sets the default new variants of this product are
   * created with. Checking it is an explicit, one-time "also overwrite every existing variant's
   * own tracking setting" bulk action (see VariantManagement for setting one variant at a time). */
  const [applyTrackingToAllVariants, setApplyTrackingToAllVariants] = useState(false);
  const [initialSerialMode, setInitialSerialMode] = useState<'none' | 'required' | 'optional'>('none');

  const [industryType, setIndustryType] = useState<IndustryType>(IndustryType.FMCG);

  const [images, setImages] = useState<ImageData[]>([]);

  useEffect(() => {
    if (!isOpen || !item) return;

    const iType = initialIndustryType(item);
    setIndustryType(iType);
    setName(item.name ?? '');
    setDescription(item.description ?? '');
    setCategory(item.category ?? 'general');
    setProductType((item.productType as ProductType) ?? ProductType.STOCK_ITEM);
    setIsMisc(Boolean(item.isMisc));
    setUnitOfMeasure(item.unitOfMeasure?.trim() || item.unitConfig?.baseUnit?.trim() || 'pcs');
    setAlternateUnits(
      (item.unitConfig?.alternateUnits ?? [])
        .filter((u) => u?.unitCode && u.factorToBase != null)
        .map((u) => ({
          unitCode: String(u.unitCode ?? ''),
          factorToBase: String(u.factorToBase ?? ''),
          isActive: u.isActive !== false,
        })),
    );

    // industryFlags.requires* is the product's own honest default (what a newly-created variant
    // inherits) — the `|| item.variantTracking?.*` fallback only matters for items saved before
    // this was true (older data whose master flags were still zeroed and whose real state only
    // ever lived on variants); harmless to keep checking it either way.
    const serialOn = Boolean(item.industryFlags?.requiresSerialTracking || item.variantTracking?.serial);
    const serialOpt = Boolean(item.industryFlags?.serialOptional || item.variantTracking?.serialOptional);
    setRequiresBatchTracking(
      Boolean(item.industryFlags?.requiresBatchTracking || item.variantTracking?.batch),
    );
    setRequiresSerialTracking(serialOn);
    setSerialOptional(serialOpt);
    setInitialSerialMode(!serialOn ? 'none' : serialOpt ? 'optional' : 'required');
    setApplyTrackingToAllVariants(false);
    setHasExpiryDate(Boolean(item.industryFlags?.hasExpiryDate ?? false));
    setServiceable(Boolean(item.serviceable));

    setImages(mapItemImages(item));
    setError(null);
    setBusy(false);
  }, [isOpen, item]);

  const resolvedBehavior = useMemo(() => {
    return resolveInventoryBehavior({ productType, isMisc });
  }, [productType, isMisc]);

  // Keep tracking mutually exclusive + consistent with misc mode.
  useEffect(() => {
    if (!resolvedBehavior.trackingAllowed) {
      setRequiresBatchTracking(false);
      setRequiresSerialTracking(false);
      setSerialOptional(false);
      setHasExpiryDate(false);
    } else if (requiresBatchTracking && requiresSerialTracking) {
      // Shouldn't happen with our UI, but keep server-consistent.
      setRequiresSerialTracking(false);
    } else if (serialOptional && !requiresSerialTracking) {
      setSerialOptional(false);
    }
  }, [resolvedBehavior.trackingAllowed, requiresBatchTracking, requiresSerialTracking, serialOptional]);

  const setSerialTrackingMode = (mode: 'none' | 'required' | 'optional') => {
    setRequiresSerialTracking(mode !== 'none');
    setSerialOptional(mode === 'optional');
    if (mode !== 'none') setRequiresBatchTracking(false);
  };

  const categoryPreset = useMemo(() => getPresetForCategory(category), [category]);

  const canSave = useMemo(() => name.trim().length > 0 && !busy && Boolean(item), [name, busy, item]);

  const onSaveClick = async () => {
    if (!item) return;
    if (!canSave) return;

    setBusy(true);
    setError(null);
    try {
      const normalizedCategory = category.trim() || 'general';
      const baseUnit = (unitOfMeasure || 'pcs').trim().toLowerCase();

      const alternate = alternateUnits
        .map((u) => ({
          unitCode: u.unitCode.trim().toLowerCase(),
          factorToBase: Number(u.factorToBase),
          isActive: u.isActive !== false,
        }))
        .filter((u) => u.unitCode && Number.isFinite(u.factorToBase) && u.factorToBase > 0);

      const presetIndustryType = categoryPreset.industryType;
      const outIndustryType: IndustryType =
        (presetIndustryType as IndustryType | undefined) ?? industryType ?? ('fmcg' as IndustryType);

      const behavior = resolvedBehavior;

      const payload: UpdateInventoryItemRequest = {
        name: name.trim(),
        description: description.trim() || undefined,
        category: normalizedCategory,
        productType,
        isMisc,
        serviceable,
        itemType: behavior.itemType,
        unitOfMeasure: baseUnit,
        unitConfig: {
          baseUnit,
          alternateUnits: alternate.map((u) => ({
            unitCode: u.unitCode,
            factorToBase: u.factorToBase,
            isActive: u.isActive,
          })),
          allowCustomUnits: true,
        },
        industryFlags: {
          industryType: outIndustryType,
          isPerishable: item.industryFlags?.isPerishable ?? false,
          isHighValue:
            item.industryClassification?.isHighValue ??
            item.industryFlags?.isHighValue ??
            false,
          requiresBatchTracking: behavior.trackingAllowed ? requiresBatchTracking : false,
          requiresSerialTracking: behavior.trackingAllowed ? requiresSerialTracking : false,
          serialOptional: behavior.trackingAllowed && requiresSerialTracking ? serialOptional : false,
          hasExpiryDate: behavior.trackingAllowed ? hasExpiryDate : false,
        },
        // Explicit opt-in only — see the checkbox next to the Serial tracking control. Leaving
        // this out (or false) means the change above only sets the default for variants created
        // from now on; every existing variant keeps whatever it's individually set to.
        applyTrackingToAllVariants,
        images: images.length
          ? images.map((img) => ({ url: img.url, publicId: img.publicId, isPrimary: img.isPrimary }))
          : [],
      };

      await onSave(item.id, payload);
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to update master';
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const addAlternateUnitRow = () => {
    setAlternateUnits((prev) => [
      ...prev,
      { unitCode: '', factorToBase: '', isActive: true },
    ]);
  };

  return (
    <SideDrawer isOpen={isOpen} onClose={onClose} title="Edit Master" width="560px">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error ? (
          <div style={{ color: '#b91c1c', fontWeight: 600 }} role="alert">
            {error}
          </div>
        ) : null}

        {item ? (
          <>
            <ImageUpload images={images} onChange={setImages} maxImages={10} folder="inventory" />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label htmlFor="edit-master-description" style={{ fontSize: 12, fontWeight: 600 }}>
                Description
              </label>
              <textarea
                id="edit-master-description"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description shown on product master"
                maxLength={1000}
                style={{ width: '100%', borderRadius: 8, padding: 10, border: '1px solid #e2e8f0' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label htmlFor="edit-master-name" style={{ fontSize: 12, fontWeight: 600 }}>
                Product name *
              </label>
              <Input
                id="edit-master-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Organic whole milk"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label htmlFor="edit-master-category" style={{ fontSize: 12, fontWeight: 600 }}>
                  Catalog category
                </label>
                <Select
                  id="edit-master-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label htmlFor="edit-master-product-type" style={{ fontSize: 12, fontWeight: 600 }}>
                  Product type
                </label>
                <Select
                  id="edit-master-product-type"
                  value={productType}
                  onChange={(e) => setProductType(e.target.value as ProductType)}
                >
                  {PRODUCT_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label htmlFor="edit-master-unit" style={{ fontSize: 12, fontWeight: 600 }}>
                Base unit
              </label>
              <Select id="edit-master-unit" value={unitOfMeasure} onChange={(e) => setUnitOfMeasure(e.target.value)}>
                {VARIANT_UNIT_OPTIONS.map((o: VariantUnitOption) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>Alternate units</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {alternateUnits.map((alt, idx) => (
                  <div key={`alt-${idx}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8 }}>
                    <Input
                      placeholder="Unit (e.g. box)"
                      value={alt.unitCode}
                      onChange={(e) =>
                        setAlternateUnits((prev) =>
                          prev.map((u, i) => (i === idx ? { ...u, unitCode: e.target.value } : u)),
                        )
                      }
                    />
                    <Input
                      type="number"
                      min={0.0001}
                      step={0.0001}
                      placeholder={`1 ${alt.unitCode || 'alt'} = X ${unitOfMeasure}`}
                      value={alt.factorToBase}
                      onChange={(e) =>
                        setAlternateUnits((prev) =>
                          prev.map((u, i) => (i === idx ? { ...u, factorToBase: e.target.value } : u)),
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        setAlternateUnits((prev) => prev.filter((_, i) => i !== idx))
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="secondary" onClick={addAlternateUnitRow}>
                  Add alternate unit
                </Button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>Tracking & Handling</div>
              {resolvedBehavior.helperText ? (
                <p
                  style={{
                    margin: '6px 0 0',
                    fontSize: 11,
                    color: '#0f766e',
                    fontWeight: 600,
                  }}
                >
                  {resolvedBehavior.helperText}
                </p>
              ) : null}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label htmlFor="edit-master-serial-mode" style={{ fontSize: 11, color: '#64748b' }}>
                    Serial tracking
                  </label>
                  <Select
                    id="edit-master-serial-mode"
                    value={!requiresSerialTracking ? 'none' : serialOptional ? 'optional' : 'required'}
                    disabled={!resolvedBehavior.trackingAllowed}
                    onChange={(e) => setSerialTrackingMode(e.target.value as 'none' | 'required' | 'optional')}
                    aria-label="Serial tracking"
                    style={{ fontSize: 12, height: 28 }}
                  >
                    <option value="none">Not tracked</option>
                    <option value="required">Required (every unit)</option>
                    <option value="optional">Optional (assign at sale/dispatch)</option>
                  </Select>
                  <p style={{ margin: 0, fontSize: 10, color: '#94a3b8', maxWidth: 220 }}>
                    Sets the default for new variants. To change one existing variant, edit it
                    directly below instead.
                  </p>
                </div>

                {(() => {
                  const currentSerialMode: 'none' | 'required' | 'optional' = !requiresSerialTracking
                    ? 'none'
                    : serialOptional
                      ? 'optional'
                      : 'required';
                  if (currentSerialMode === initialSerialMode) return null;
                  return (
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 6,
                        cursor: 'pointer',
                        fontSize: 12,
                        maxWidth: 260,
                        padding: '6px 8px',
                        background: '#fffbeb',
                        border: '1px solid #fde68a',
                        borderRadius: 6,
                      }}
                    >
                      <Checkbox
                        checked={applyTrackingToAllVariants}
                        onChange={(e) => setApplyTrackingToAllVariants(e.target.checked)}
                        aria-label="Apply to all existing variants"
                      />
                      <span>
                        Also apply to every existing variant of this product
                        <span style={{ display: 'block', color: '#92400e', fontSize: 10 }}>
                          Overwrites each variant's own serial tracking setting. Leave unchecked
                          to only change the default for variants created from now on.
                        </span>
                      </span>
                    </label>
                  );
                })()}

                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                  <Checkbox
                    checked={hasExpiryDate}
                    disabled={!resolvedBehavior.trackingAllowed}
                    onChange={(e) => setHasExpiryDate(e.target.checked)}
                    aria-label="Has expiry date"
                  />
                  Has expiry date
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12 }}>
                  <Checkbox
                    checked={isMisc}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setIsMisc(checked);
                      if (checked) {
                        setRequiresBatchTracking(false);
                        setRequiresSerialTracking(false);
                        setSerialOptional(false);
                        setHasExpiryDate(false);
                      }
                    }}
                    aria-label="Mark as Misc"
                  />
                  Mark as Misc
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                  <Checkbox
                    checked={serviceable}
                    onChange={(e) => setServiceable(e.target.checked)}
                    aria-label="Serviceable"
                  />
                  Serviceable
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="button" variant="primary" onClick={() => void onSaveClick()} disabled={!canSave}>
                {busy ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </>
        ) : (
          <div style={{ color: '#64748b' }}>No item selected.</div>
        )}
      </div>
    </SideDrawer>
  );
};

