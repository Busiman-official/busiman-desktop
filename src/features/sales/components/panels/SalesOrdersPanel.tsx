import React from 'react';
import { PosShell } from '../pos';
import { docId } from '../../utils/ids';

interface Props {
  branchId: string | null;
  salesPointId: string | null;
  customerId: string | null;
  salesPoints: Record<string, unknown>[];
  customers: Record<string, unknown>[];
  /** YYYY-MM-DD — sale/invoice date for POS checkout and draft quotation orders. */
  invoiceDateYmd: string;
}

export const SalesOrdersPanel: React.FC<Props> = ({
  branchId,
  salesPointId,
  customerId,
  salesPoints,
  customers,
  invoiceDateYmd,
}) => {
  const selectedSalesPoint = React.useMemo(() => {
    if (!salesPointId) return null;
    return (
      salesPoints.find((s) => docId(s as { _id?: string; id?: string }) === salesPointId) ??
      null
    );
  }, [salesPointId, salesPoints]);

  const locationId = React.useMemo(() => {
    const sp = selectedSalesPoint as { locationId?: unknown } | null;
    if (!sp?.locationId) return null;
    const loc = sp.locationId;
    if (typeof loc === 'string') return loc;
    if (loc && typeof loc === 'object') {
      const obj = loc as { _id?: unknown; id?: unknown };
      if (obj._id) return String(obj._id);
      if (obj.id) return String(obj.id);
    }
    return null;
  }, [selectedSalesPoint]);

  const sessionStatus = React.useMemo(() => {
    const sp = selectedSalesPoint as { sessionStatus?: unknown } | null;
    return sp?.sessionStatus === 'open' || sp?.sessionStatus === 'closed'
      ? (sp.sessionStatus as 'open' | 'closed')
      : null;
  }, [selectedSalesPoint]);

  const customerAllowsSale = React.useMemo(() => {
    if (!customerId) return true;
    const row = customers.find((c) => docId(c as { _id?: string; id?: string }) === customerId) as
      | { isActive?: boolean }
      | undefined;
    if (!row) return true;
    return row.isActive !== false;
  }, [customerId, customers]);

  if (!branchId) {
    return <p className="sales-muted">Branch required.</p>;
  }

  return (
    <div className="pos-orders-root">
      <PosShell
        branchId={branchId}
        salesPointId={salesPointId}
        locationId={locationId}
        customerId={customerId}
        salesPointSessionStatus={sessionStatus}
        customerAllowsSale={customerAllowsSale}
        invoiceDateYmd={invoiceDateYmd}
      />
    </div>
  );
};
