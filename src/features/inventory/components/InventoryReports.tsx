/**
 * Inventory Reports Component - All inventory reports
 */

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  inventoryService,
  StockSummaryReport,
  LocationWiseStockReport,
  BatchExpiryRiskReport,
  MovementAuditReport,
  DamageWasteAnalysisReport,
  StockReconciliationReport,
  VariantStockReport,
} from '@/services/inventory.service';
import { Button, Input, Card, Select } from '@/shared/components/ui';
import { LoadingState, EmptyState } from '@/shared/components/data-display';
import { extractErrorMessage } from '@/utils/error';
import { movementTransactionIso } from '@/utils/commercialDates';
import { logger } from '@/shared/utils/logger';
import './InventoryReports.css';

type ReportType = 'summary' | 'location' | 'expiry' | 'audit' | 'damage' | 'reconciliation' | 'variant';

const REPORT_TYPES: ReportType[] = ['summary', 'location', 'expiry', 'audit', 'damage', 'reconciliation', 'variant'];

export const InventoryReports: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeReport, setActiveReport] = useState<ReportType>('summary');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Sync activeReport with URL param report (for deep-linking from global search)
  useEffect(() => {
    const report = searchParams.get('report');
    if (report && REPORT_TYPES.includes(report as ReportType)) {
      setActiveReport(report as ReportType);
    }
  }, [searchParams]);

  const [summaryReport, setSummaryReport] = useState<StockSummaryReport[]>([]);
  const [locationReport, setLocationReport] = useState<LocationWiseStockReport[]>([]);
  const [expiryReport, setExpiryReport] = useState<BatchExpiryRiskReport[]>([]);
  const [auditReport, setAuditReport] = useState<MovementAuditReport[]>([]);
  const [damageReport, setDamageReport] = useState<DamageWasteAnalysisReport[]>([]);
  const [reconciliationReport, setReconciliationReport] = useState<StockReconciliationReport[]>([]);
  const [variantReport, setVariantReport] = useState<VariantStockReport[]>([]);

  useEffect(() => {
    loadReport();
  }, [activeReport]);

  const loadReport = async () => {
    setLoading(true);
    setError(null);
    try {
      switch (activeReport) {
        case 'summary':
          const summary = await inventoryService.getStockSummaryReport();
          setSummaryReport(summary);
          break;
        case 'location':
          const location = await inventoryService.getLocationWiseStockReport();
          setLocationReport(location);
          break;
        case 'expiry':
          const expiry = await inventoryService.getBatchExpiryRiskReport(30);
          setExpiryReport(expiry);
          break;
        case 'audit':
          const audit = await inventoryService.getMovementAuditReport(dateFrom || undefined, dateTo || undefined);
          setAuditReport(audit);
          break;
        case 'damage':
          const damage = await inventoryService.getDamageWasteAnalysisReport(dateFrom || undefined, dateTo || undefined);
          setDamageReport(damage);
          break;
        case 'reconciliation':
          const reconciliation = await inventoryService.getStockReconciliationReport();
          setReconciliationReport(reconciliation);
          break;
        case 'variant':
          const variant = await inventoryService.getVariantStockReport();
          setVariantReport(variant);
          break;
      }
    } catch (err: any) {
      const message = extractErrorMessage(err, 'Failed to load report');
      setError(message);
      logger.error('[InventoryReports] Failed to load report', err);
    } finally {
      setLoading(false);
    }
  };

  const renderSummaryReport = () => (
    <div className="report-content">
      {loading ? (
        <LoadingState message="Loading report..." />
      ) : summaryReport.length === 0 ? (
        <EmptyState message="No data available" />
      ) : (
        <table className="report-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Variant</th>
              <th>Total On Hand</th>
              <th>Reserved</th>
              <th>Blocked</th>
              <th>Damaged</th>
              <th>Available</th>
              <th>Locations</th>
            </tr>
          </thead>
          <tbody>
            {summaryReport.map((item) => (
              <tr key={`${item.itemId}-${item.variantId || 'none'}`}>
                <td>{item.item.name}</td>
                <td>{item.variant ? `${item.variant.code} - ${item.variant.name}` : '-'}</td>
                <td>{item.totalOnHand}</td>
                <td>{item.totalReserved}</td>
                <td>{item.totalBlocked}</td>
                <td>{item.totalDamaged}</td>
                <td>{item.totalAvailable}</td>
                <td>{item.locations.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  const renderLocationReport = () => (
    <div className="report-content">
      {loading ? (
        <LoadingState message="Loading report..." />
      ) : locationReport.length === 0 ? (
        <EmptyState message="No data available" />
      ) : (
        <div className="report-list">
          {locationReport.map((location) => (
            <Card key={location.locationId} className="location-report-card">
              <h3>{location.location.code} - {location.location.name}</h3>
              <p>Total Items: {location.totalItems} | Total Quantity: {location.totalQuantity}</p>
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Quantity</th>
                    <th>Batch</th>
                  </tr>
                </thead>
                <tbody>
                  {location.items.map((item) => (
                    <tr key={item.itemId}>
                      <td>{item.item.name}</td>
                      <td>{item.quantity}</td>
                      <td>{item.batchNumber || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}
        </div>
      )}
    </div>
  );

  const renderExpiryReport = () => (
    <div className="report-content">
      {loading ? (
        <LoadingState message="Loading report..." />
      ) : expiryReport.length === 0 ? (
        <EmptyState message="No batches expiring soon" />
      ) : (
        <table className="report-table">
          <thead>
            <tr>
              <th>Batch</th>
              <th>Item</th>
              <th>Expiry Date</th>
              <th>Days Until Expiry</th>
              <th>Total Quantity</th>
              <th>Locations</th>
            </tr>
          </thead>
          <tbody>
            {expiryReport.map((batch) => (
              <tr key={batch.batchNumber}>
                <td>{batch.batchNumber}</td>
                <td>{batch.item.name}</td>
                <td>{new Date(batch.expiryDate).toLocaleDateString()}</td>
                <td className={batch.daysUntilExpiry <= 7 ? 'critical' : ''}>{batch.daysUntilExpiry}</td>
                <td>{batch.totalQuantity}</td>
                <td>{batch.locations.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  const renderAuditReport = () => (
    <div className="report-content">
      <div className="report-filters">
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} placeholder="From Date" />
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} placeholder="To Date" />
        <Button variant="primary" onClick={loadReport}>Apply Filters</Button>
      </div>
      {loading ? (
        <LoadingState message="Loading report..." />
      ) : auditReport.length === 0 ? (
        <EmptyState message="No movements found" />
      ) : (
        <table className="report-table">
          <thead>
            <tr>
              <th>Movement #</th>
              <th>Type</th>
              <th>Item</th>
              <th>From</th>
              <th>To</th>
              <th>Quantity</th>
              <th>Reason</th>
              <th>Created By</th>
              <th>Transaction date</th>
            </tr>
          </thead>
          <tbody>
            {auditReport.map((movement) => (
              <tr key={movement.movementId}>
                <td>{movement.movementNumber}</td>
                <td>{movement.movementType}</td>
                <td>{movement.item.name}</td>
                <td>{movement.fromLocation || '-'}</td>
                <td>{movement.toLocation || '-'}</td>
                <td>{movement.quantity}</td>
                <td>{movement.reasonCode}</td>
                <td>{movement.createdBy}</td>
                <td
                  title={
                    movement.postingDate
                      ? `Entered: ${new Date(movement.createdAt).toLocaleDateString()}`
                      : undefined
                  }
                >
                  {new Date(
                    movementTransactionIso({
                      postingDate: movement.postingDate,
                      createdAt: movement.createdAt,
                    })
                  ).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  const renderDamageReport = () => (
    <div className="report-content">
      <div className="report-filters">
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} placeholder="From Date" />
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} placeholder="To Date" />
        <Button variant="primary" onClick={loadReport}>Apply Filters</Button>
      </div>
      {loading ? (
        <LoadingState message="Loading report..." />
      ) : damageReport.length === 0 ? (
        <EmptyState message="No damage/waste data found" />
      ) : (
        <table className="report-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Total Damage</th>
              <th>Total Waste</th>
              <th>Total Loss</th>
              <th>Movements</th>
            </tr>
          </thead>
          <tbody>
            {damageReport.map((item) => (
              <tr key={item.itemId}>
                <td>{item.item.name}</td>
                <td>{item.totalDamage}</td>
                <td>{item.totalWaste}</td>
                <td>{item.totalLoss}</td>
                <td>{item.movements.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  const renderVariantReport = () => (
    <div className="report-content">
      {loading ? (
        <LoadingState message="Loading report..." />
      ) : variantReport.length === 0 ? (
        <EmptyState message="No variant stock data available" />
      ) : (
        <table className="report-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Variant</th>
              <th>Total On Hand</th>
              <th>Reserved</th>
              <th>Blocked</th>
              <th>Damaged</th>
              <th>Available</th>
              <th>Locations</th>
            </tr>
          </thead>
          <tbody>
            {variantReport.map((item) => (
              <tr key={`${item.itemId}-${item.variantId}`}>
                <td>{item.item.name}</td>
                <td>{item.variant.code} - {item.variant.name}</td>
                <td>{item.totalOnHand}</td>
                <td>{item.totalReserved}</td>
                <td>{item.totalBlocked}</td>
                <td>{item.totalDamaged}</td>
                <td>{item.totalAvailable}</td>
                <td>{item.locations.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  const renderReconciliationReport = () => (
    <div className="report-content">
      {loading ? (
        <LoadingState message="Loading report..." />
      ) : reconciliationReport.length === 0 ? (
        <EmptyState message="No reconciliation data available" />
      ) : (
        <table className="report-table">
          <thead>
            <tr>
              <th>Location</th>
              <th>Item</th>
              <th>System Qty</th>
              <th>Physical Qty</th>
              <th>Variance</th>
              <th>Last Count</th>
            </tr>
          </thead>
          <tbody>
            {reconciliationReport.map((rec, index) => (
              <tr key={index}>
                <td>{rec.location.code}</td>
                <td>{rec.item.name}</td>
                <td>{rec.systemQuantity}</td>
                <td>{rec.physicalQuantity}</td>
                <td className={rec.variance === 0 ? '' : rec.variance > 0 ? 'variance-positive' : 'variance-negative'}>
                  {rec.variance > 0 ? '+' : ''}{rec.variance}
                </td>
                <td>{rec.lastCountDate ? new Date(rec.lastCountDate).toLocaleDateString() : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  return (
    <div className="inventory-reports">
      <div className="reports-tabs">
        <button className={activeReport === 'summary' ? 'active' : ''} onClick={() => { setActiveReport('summary'); setSearchParams((p) => { const next = new URLSearchParams(p); next.set('report', 'summary'); return next; }); }}>
          Stock Summary
        </button>
        <button className={activeReport === 'location' ? 'active' : ''} onClick={() => { setActiveReport('location'); setSearchParams((p) => { const next = new URLSearchParams(p); next.set('report', 'location'); return next; }); }}>
          Location Wise
        </button>
        <button className={activeReport === 'expiry' ? 'active' : ''} onClick={() => { setActiveReport('expiry'); setSearchParams((p) => { const next = new URLSearchParams(p); next.set('report', 'expiry'); return next; }); }}>
          Expiry Risk
        </button>
        <button className={activeReport === 'audit' ? 'active' : ''} onClick={() => { setActiveReport('audit'); setSearchParams((p) => { const next = new URLSearchParams(p); next.set('report', 'audit'); return next; }); }}>
          Movement Audit
        </button>
        <button className={activeReport === 'damage' ? 'active' : ''} onClick={() => { setActiveReport('damage'); setSearchParams((p) => { const next = new URLSearchParams(p); next.set('report', 'damage'); return next; }); }}>
          Damage/Waste
        </button>
        <button className={activeReport === 'reconciliation' ? 'active' : ''} onClick={() => { setActiveReport('reconciliation'); setSearchParams((p) => { const next = new URLSearchParams(p); next.set('report', 'reconciliation'); return next; }); }}>
          Reconciliation
        </button>
        <button className={activeReport === 'variant' ? 'active' : ''} onClick={() => { setActiveReport('variant'); setSearchParams((p) => { const next = new URLSearchParams(p); next.set('report', 'variant'); return next; }); }}>
          Variant Stock
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}

      {activeReport === 'summary' && renderSummaryReport()}
      {activeReport === 'location' && renderLocationReport()}
      {activeReport === 'expiry' && renderExpiryReport()}
      {activeReport === 'audit' && renderAuditReport()}
      {activeReport === 'damage' && renderDamageReport()}
      {activeReport === 'reconciliation' && renderReconciliationReport()}
      {activeReport === 'variant' && renderVariantReport()}
    </div>
  );
};
