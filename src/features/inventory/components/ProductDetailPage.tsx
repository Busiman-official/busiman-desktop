/**
 * Product Detail Page - Full-page product detail view
 * 
 * @deprecated This component is deprecated. Use ItemMaster details view instead.
 * All routes to this component should redirect to ItemMaster details view.
 * This file will be removed after migration period.
 * 
 * Migration: Navigate to ItemMaster and select the item to view details.
 */

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  inventoryService,
  InventoryItem,
  InventoryVariant,
  StockByItem,
  StockMovementResponse,
  MovementType,
  IndustryFlags,
  IndustryType,
} from '@/services/inventory.service';
import { Button, Card, Input, Select } from '@/shared/components/ui';
import { LoadingState, EmptyState, ErrorState } from '@/shared/components/data-display';
import { extractErrorMessage } from '@/utils/error';
import { logger } from '@/shared/utils/logger';
import { ConfirmDialog } from '@/shared/components/modals';
import { VariantManagement } from './VariantManagement';
import { itemDisplaySku } from '../utils/itemDisplaySku';
import './ProductDetailPage.css';

type DetailTab = 'overview' | 'variants' | 'stock' | 'history' | 'settings';

export const ProductDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  
  // Redirect to ItemMaster details view
  useEffect(() => {
    if (id) {
      const variantId = searchParams.get('variantId');
      // Redirect to ItemMaster with item selected and appropriate tab
      navigate(`/inventory?itemId=${id}${variantId ? `&variantId=${variantId}` : ''}`, { replace: true });
    }
  }, [id, navigate, searchParams]);
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [variants, setVariants] = useState<InventoryVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const variantIdFromUrl = searchParams.get('variantId');
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [primaryImageIndex, setPrimaryImageIndex] = useState(0);
  const [showImageLightbox, setShowImageLightbox] = useState(false);
  const [stockData, setStockData] = useState<StockByItem[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [optimisticMigration, setOptimisticMigration] = useState<{
    variantId: string;
    ledgerModified: number;
    serialModified: number;
  } | null>(null);
  const [movementHistory, setMovementHistory] = useState<StockMovementResponse[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFilters, setHistoryFilters] = useState({
    dateFrom: '',
    dateTo: '',
    movementType: '',
    locationId: '',
  });
  const variantRowRef = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    if (id) {
      loadItem();
    }
  }, [id]);

  // Auto-switch to variants tab when variantId is in URL
  useEffect(() => {
    if (variantIdFromUrl && item?.hasVariants) {
      setActiveTab('variants');
      // Scroll to variant after a short delay to ensure DOM is ready
      setTimeout(() => {
        if (variantRowRef.current) {
          variantRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 300);
    }
  }, [variantIdFromUrl, item?.hasVariants]);

  // Load stock data when stock tab is active
  useEffect(() => {
    if (activeTab === 'stock' && id) {
      loadStockData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, id]);

  // Load movement history when history tab is active or filters change
  useEffect(() => {
    if (activeTab === 'history' && id) {
      loadMovementHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, id, historyFilters.dateFrom, historyFilters.dateTo, historyFilters.movementType, historyFilters.locationId]);

  const loadStockData = async () => {
    if (!id) return;
    setStockLoading(true);
    try {
      const data = await inventoryService.getStockByItem(id);
      setStockData(data);
    } catch (err: any) {
      logger.error('[ProductDetailPage] Failed to load stock data', err);
      setStockData([]);
    } finally {
      setStockLoading(false);
    }
  };

  const loadMovementHistory = async () => {
    if (!id) return;
    setHistoryLoading(true);
    try {
      const filters: any = { itemId: id };
      if (historyFilters.dateFrom) filters.dateFrom = historyFilters.dateFrom;
      if (historyFilters.dateTo) filters.dateTo = historyFilters.dateTo;
      if (historyFilters.movementType) filters.movementType = historyFilters.movementType as MovementType;
      if (historyFilters.locationId) filters.fromLocationId = historyFilters.locationId;
      
      const data = await inventoryService.getAllMovements(filters);
      setMovementHistory(data);
    } catch (err: any) {
      logger.error('[ProductDetailPage] Failed to load movement history', err);
      setMovementHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadItem = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await inventoryService.getItemById(id);
      setItem(data);
      if (data.hasVariants) {
        const variantData = await inventoryService.getVariantsByItem(id);
        setVariants(variantData);
      }
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to load product details');
      setError(message);
      logger.error('[ProductDetailPage] Failed to load item', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    try {
      await inventoryService.deleteItem(id);
      navigate('/inventory');
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to delete product');
      setError(message);
      logger.error('[ProductDetailPage] Failed to delete item', err);
    }
  };

  if (loading) {
    return (
      <div className="product-detail-page">
        <LoadingState message="Loading product details..." />
      </div>
    );
  }

  if (error && !item) {
    return (
      <div className="product-detail-page">
        <ErrorState message={error} />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="product-detail-page">
        <EmptyState message="Product not found" />
      </div>
    );
  }

  const allImages = item.images || [];
  const primaryImage = allImages.find(img => img.isPrimary) || allImages[0];
  
  // Get selected variant for display
  const selectedVariant = variantIdFromUrl && variants.length > 0 
    ? variants.find(v => v.id === variantIdFromUrl) 
    : null;

  const displaySku = itemDisplaySku(item, variants);
  const overviewIndustryFlags = ((): IndustryFlags => {
    if (item.industryFlags) return item.industryFlags;
    const ic = item.industryClassification;
    return {
      industryType: ic?.industryType ?? IndustryType.FMCG,
      isHighValue: ic?.isHighValue ?? false,
      isPerishable: false,
      requiresBatchTracking: variants.some((v) => v.trackBatchOverride),
      requiresSerialTracking: variants.some((v) => v.trackSerialOverride),
      hasExpiryDate: false,
    };
  })();

  return (
    <div className="product-detail-page">
      {/* Breadcrumb */}
      <div className="product-detail-breadcrumb">
        <button onClick={() => navigate('/inventory')} className="breadcrumb-link">
          Inventory
        </button>
        <span className="breadcrumb-separator">/</span>
        <span className="breadcrumb-current">{item.name}</span>
        {selectedVariant && (
          <>
            <span className="breadcrumb-separator">/</span>
            <span className="breadcrumb-current">{selectedVariant.name || selectedVariant.code || 'Variant'}</span>
          </>
        )}
      </div>

      {/* Hero Section */}
      <div className="product-detail-hero">
        <div className="product-hero-image-section">
          {primaryImage ? (
            <div className="product-primary-image-container">
              <img
                src={primaryImage.url}
                alt={item.name}
                className="product-primary-image"
                onClick={() => setShowImageLightbox(true)}
              />
              {allImages.length > 1 && (
                <div className="product-image-counter">
                  {allImages.length} image{allImages.length !== 1 ? 's' : ''}
                </div>
              )}
            </div>
          ) : (
            <div className="product-image-placeholder">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M21 19V5C21 3.9 20.1 3 19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19ZM8.5 13.5L11 16.51L14.5 12L19 18H5L8.5 13.5Z" fill="currentColor"/>
              </svg>
              <p>No Image Available</p>
            </div>
          )}
          
          {allImages.length > 1 && (
            <div className="product-image-thumbnails">
              {allImages.slice(0, 4).map((img, index) => (
                <img
                  key={img.publicId}
                  src={img.url}
                  alt={`${item.name} ${index + 1}`}
                  className={`thumbnail ${index === primaryImageIndex ? 'active' : ''}`}
                  onClick={() => setPrimaryImageIndex(index)}
                />
              ))}
              {allImages.length > 4 && (
                <div className="thumbnail-more">+{allImages.length - 4}</div>
              )}
            </div>
          )}
        </div>

        <div className="product-hero-info">
          <div className="product-hero-header">
            <div>
              <h1 className="product-hero-title">{item.name}</h1>
              <div className="product-hero-sku">SKU: {displaySku}</div>
              {item.category && (
                <div className="product-hero-category">{item.category}</div>
              )}
            </div>
            <div className="product-hero-actions">
              <span className={`status-badge ${item.isActive ? 'status-active' : 'status-inactive'}`}>
                {item.isActive ? 'Active' : 'Inactive'}
              </span>
              <Button variant="primary" onClick={() => navigate(`/inventory?edit=${item.id}`)}>
                Edit Product
              </Button>
              <Button variant="danger" onClick={() => setShowDeleteConfirm(true)}>
                Delete
              </Button>
            </div>
          </div>

          {item.description && (
            <p className="product-hero-description">{item.description}</p>
          )}

          {/* Quick Info Grid */}
          <div className="product-quick-info">
            {item.unitOfMeasure && (
              <div className="quick-info-item">
                <span className="quick-info-label">Unit</span>
                <span className="quick-info-value">{item.unitOfMeasure}</span>
              </div>
            )}
          </div>

          {item.tags && item.tags.length > 0 && (
            <div className="product-tags">
              {item.tags.map((tag, index) => (
                <span key={index} className="product-tag">{tag}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="product-detail-tabs">
        <button
          className={`product-detail-tab ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        {item.hasVariants && (
          <button
            className={`product-detail-tab ${activeTab === 'variants' ? 'active' : ''}`}
            onClick={() => setActiveTab('variants')}
          >
            Variants ({variants.length})
          </button>
        )}
        <button
          className={`product-detail-tab ${activeTab === 'stock' ? 'active' : ''}`}
          onClick={() => setActiveTab('stock')}
        >
          Stock
        </button>
        <button
          className={`product-detail-tab ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          History
        </button>
        <button
          className={`product-detail-tab ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          Settings
        </button>
      </div>

      {/* Tab Content */}
      <div className="product-detail-content">
        {activeTab === 'overview' && (
          <div className="product-overview">
            <div className="overview-grid">
              <Card className="overview-card">
                <h3>Basic Information</h3>
                <div className="overview-item">
                  <span className="overview-label">SKU:</span>
                  <span className="overview-value">{displaySku}</span>
                </div>
                <div className="overview-item">
                  <span className="overview-label">Category:</span>
                  <span className="overview-value">{item.category || '-'}</span>
                </div>
                <div className="overview-item">
                  <span className="overview-label">Unit of Measure:</span>
                  <span className="overview-value">{item.unitOfMeasure}</span>
                </div>
                <div className="overview-item">
                  <span className="overview-label">Status:</span>
                  <span className={`overview-value ${item.isActive ? 'status-active' : 'status-inactive'}`}>
                    {item.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </Card>


              {(item.dimensions || item.weight) && (
                <Card className="overview-card">
                  <h3>Dimensions & Weight</h3>
                  {item.dimensions && (
                    <>
                      <div className="overview-item">
                        <span className="overview-label">Length:</span>
                        <span className="overview-value">{item.dimensions.length} {item.dimensions.unit}</span>
                      </div>
                      <div className="overview-item">
                        <span className="overview-label">Width:</span>
                        <span className="overview-value">{item.dimensions.width} {item.dimensions.unit}</span>
                      </div>
                      <div className="overview-item">
                        <span className="overview-label">Height:</span>
                        <span className="overview-value">{item.dimensions.height} {item.dimensions.unit}</span>
                      </div>
                    </>
                  )}
                  {item.weight && (
                    <div className="overview-item">
                      <span className="overview-label">Weight:</span>
                      <span className="overview-value">{item.weight.value} {item.weight.unit}</span>
                    </div>
                  )}
                </Card>
              )}

              <Card className="overview-card">
                <h3>Industry Flags</h3>
                <div className="overview-item">
                  <span className="overview-label">Industry Type:</span>
                  <span className="overview-value">{overviewIndustryFlags.industryType}</span>
                </div>
                <div className="overview-item">
                  <span className="overview-label">Perishable:</span>
                  <span className="overview-value">{overviewIndustryFlags.isPerishable ? 'Yes' : 'No'}</span>
                </div>
                <div className="overview-item">
                  <span className="overview-label">Batch Tracking:</span>
                  <span className="overview-value">{overviewIndustryFlags.requiresBatchTracking ? 'Yes' : 'No'}</span>
                </div>
                <div className="overview-item">
                  <span className="overview-label">Serial Tracking:</span>
                  <span className="overview-value">{overviewIndustryFlags.requiresSerialTracking ? 'Yes' : 'No'}</span>
                </div>
                <div className="overview-item">
                  <span className="overview-label">Expiry Date:</span>
                  <span className="overview-value">{overviewIndustryFlags.hasExpiryDate ? 'Yes' : 'No'}</span>
                </div>
              </Card>

            </div>
          </div>
        )}

        {activeTab === 'variants' && item.hasVariants && id && (
          <div className="product-variants-tab">
        {selectedVariant && (
          <Card className="variant-detail-card">
            <div className="variant-detail-header">
              <h3>Variant Details</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchParams({});
                }}
              >
                Clear Selection
              </Button>
            </div>
            <div className="variant-detail-grid">
              <div className="variant-detail-item">
                <span className="variant-detail-label">SKU:</span>
                <span className="variant-detail-value">{selectedVariant.sku || selectedVariant.code || '-'}</span>
              </div>
              <div className="variant-detail-item">
                <span className="variant-detail-label">Name:</span>
                <span className="variant-detail-value">{selectedVariant.name || '-'}</span>
              </div>
              {selectedVariant.barcode && (
                <div className="variant-detail-item">
                  <span className="variant-detail-label">Barcode:</span>
                  <span className="variant-detail-value">{selectedVariant.barcode}</span>
                </div>
              )}
              <div className="variant-detail-item">
                <span className="variant-detail-label">Status:</span>
                <span className={`variant-detail-value ${selectedVariant.isActive ? 'status-active' : 'status-inactive'}`}>
                  {selectedVariant.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              {selectedVariant.isDefault && (
                <div className="variant-detail-item">
                  <span className="variant-detail-label">Default:</span>
                  <span className="variant-detail-value">Yes</span>
                </div>
              )}
            </div>
          </Card>
        )}
            <VariantManagement
              itemId={id}
              itemName={item.name}
              itemDefaultUnitOfMeasure={item.unitOfMeasure || 'pcs'}
              selectedVariantId={variantIdFromUrl || undefined}
              onVariantCreated={(variant, migration) => {
                if (migration) {
                  setOptimisticMigration({
                    variantId: variant.id,
                    ledgerModified: migration.ledgerModified,
                    serialModified: migration.serialModified,
                  });
                }
              }}
              onVariantChange={async () => {
                const variantData = await inventoryService.getVariantsByItem(id);
                setVariants(variantData);
                await loadStockData();
                setOptimisticMigration(null);
              }}
            />
          </div>
        )}

        {activeTab === 'stock' && (
          <div className="product-stock-tab">
            {stockLoading ? (
              <LoadingState message="Loading stock information..." />
            ) : (() => {
              const hasOptimistic = !!optimisticMigration;
              const existingForVariant = hasOptimistic ? stockData.find(s => s.variantId === optimisticMigration!.variantId) : null;
              const displayStock: StockByItem[] = hasOptimistic && !existingForVariant
                ? [
                    ...stockData,
                    {
                      locationId: '',
                      location: { id: '', code: '–', name: 'Migrated (updating…)', type: '' },
                      variantId: optimisticMigration!.variantId,
                      onHandQuantity: optimisticMigration!.ledgerModified,
                      reservedQuantity: 0,
                      blockedQuantity: 0,
                      damagedQuantity: 0,
                      availableQuantity: optimisticMigration!.ledgerModified,
                    } as StockByItem,
                  ]
                : stockData;
              let optimisticAdded = false;
              return displayStock.length === 0 ? (
                <EmptyState message="No stock information available" />
              ) : (
                <div className="stock-table-container">
                  <table className="stock-table">
                    <thead>
                      <tr>
                        <th>Location</th>
                        {item.hasVariants && <th>Variant</th>}
                        {overviewIndustryFlags.requiresBatchTracking && <th>Batch</th>}
                        {overviewIndustryFlags.requiresSerialTracking && <th>Serial</th>}
                        <th>On Hand</th>
                        <th>Reserved</th>
                        <th>Blocked</th>
                        <th>Damaged</th>
                        <th>Available</th>
                        {overviewIndustryFlags.hasExpiryDate && <th>Expiry Date</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {displayStock.map((stock, index) => {
                        const variant = stock.variantId ? variants.find(v => v.id === stock.variantId) : null;
                        const addOptimistic = hasOptimistic && stock.variantId === optimisticMigration!.variantId && !optimisticAdded;
                        if (addOptimistic) optimisticAdded = true;
                        const onHand = stock.onHandQuantity + (addOptimistic ? optimisticMigration!.ledgerModified : 0);
                        const available = stock.availableQuantity + (addOptimistic ? optimisticMigration!.ledgerModified : 0);
                        return (
                          <tr key={stock.locationId || `opt-${stock.variantId}-${index}`}>
                            <td>
                              {stock.location?.code ? (
                                <div>
                                  <div className="stock-location-code">{stock.location.code}</div>
                                  <div className="stock-location-name">{stock.location.name}</div>
                                </div>
                              ) : (
                                stock.location?.name || '-'
                              )}
                            </td>
                            {item.hasVariants && (
                              <td>
                                {variant ? (
                                  <span className="variant-badge">{variant.code}</span>
                                ) : (
                                  '-'
                                )}
                              </td>
                            )}
                            {overviewIndustryFlags.requiresBatchTracking && (
                              <td>{stock.batchNumber || '-'}</td>
                            )}
                            {overviewIndustryFlags.requiresSerialTracking && (
                              <td>{stock.serialNumber || '-'}</td>
                            )}
                            <td className="stock-quantity">{onHand}</td>
                            <td className="stock-quantity">{stock.reservedQuantity}</td>
                            <td className="stock-quantity">{stock.blockedQuantity}</td>
                            <td className="stock-quantity">{stock.damagedQuantity}</td>
                            <td className="stock-quantity available">{available}</td>
                            {overviewIndustryFlags.hasExpiryDate && (
                              <td>{stock.expiryDate ? new Date(stock.expiryDate).toLocaleDateString() : '-'}</td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="product-history-tab">
            <div className="history-filters">
              <div className="filter-group">
                <label>Date From</label>
                <Input
                  type="date"
                  value={historyFilters.dateFrom}
                  onChange={(e) => {
                    setHistoryFilters({ ...historyFilters, dateFrom: e.target.value });
                  }}
                />
              </div>
              <div className="filter-group">
                <label>Date To</label>
                <Input
                  type="date"
                  value={historyFilters.dateTo}
                  onChange={(e) => {
                    setHistoryFilters({ ...historyFilters, dateTo: e.target.value });
                  }}
                />
              </div>
              <div className="filter-group">
                <label>Movement Type</label>
                <Select
                  value={historyFilters.movementType}
                  onChange={(e) => {
                    setHistoryFilters({ ...historyFilters, movementType: e.target.value });
                  }}
                >
                  <option value="">All Types</option>
                  {Object.values(MovementType).map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                variant="ghost"
                onClick={() => {
                  setHistoryFilters({ dateFrom: '', dateTo: '', movementType: '', locationId: '' });
                }}
              >
                Clear Filters
              </Button>
            </div>

            {historyLoading ? (
              <LoadingState message="Loading movement history..." />
            ) : movementHistory.length === 0 ? (
              <EmptyState message="No movement history found" />
            ) : (
              <div className="history-table-container">
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Movement #</th>
                      <th>Type</th>
                      <th>From Location</th>
                      <th>To Location</th>
                      {item.hasVariants && <th>Variant</th>}
                      <th>Quantity</th>
                      <th>Status</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movementHistory.map((movement) => {
                      const variant = movement.variantId ? variants.find(v => v.id === movement.variantId) : null;
                      return (
                        <tr key={movement.id}>
                          <td>{movement.createdAt ? new Date(movement.createdAt).toLocaleString() : '-'}</td>
                          <td className="movement-number">{movement.movementNumber}</td>
                          <td>
                            <span className={`movement-type-badge movement-type-${movement.movementType.toLowerCase()}`}>
                              {movement.movementType}
                            </span>
                          </td>
                          <td>{movement.fromLocation?.name || '-'}</td>
                          <td>{movement.toLocation?.name || '-'}</td>
                          {item.hasVariants && (
                            <td>
                              {variant ? (
                                <span className="variant-badge">{variant.code}</span>
                              ) : (
                                '-'
                              )}
                            </td>
                          )}
                          <td className="movement-quantity">{movement.quantity} {movement.unitOfMeasure}</td>
                          <td>
                            <span className={`status-badge status-${movement.status.toLowerCase()}`}>
                              {movement.status}
                            </span>
                          </td>
                          <td>{movement.reasonDescription || movement.reasonCode}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="product-settings-tab">
            <Button variant="primary" onClick={() => navigate(`/inventory?edit=${item.id}`)}>
              Edit Product
            </Button>
          </div>
        )}
      </div>

      {/* Image Lightbox */}
      {showImageLightbox && allImages.length > 0 && (
        <div className="image-lightbox" onClick={() => setShowImageLightbox(false)}>
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <button className="lightbox-close" onClick={() => setShowImageLightbox(false)}>×</button>
            <img src={allImages[primaryImageIndex].url} alt={item.name} />
            {allImages.length > 1 && (
              <>
                <button
                  className="lightbox-nav lightbox-prev"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPrimaryImageIndex((prev) => (prev > 0 ? prev - 1 : allImages.length - 1));
                  }}
                >
                  ‹
                </button>
                <button
                  className="lightbox-nav lightbox-next"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPrimaryImageIndex((prev) => (prev < allImages.length - 1 ? prev + 1 : 0));
                  }}
                >
                  ›
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete Product"
        message={`Are you sure you want to delete "${item.name}"? This action cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
        variant="danger"
      />
    </div>
  );
};
