import React from 'react';
import { ReceiptShell } from './ReceiptShell';

type Props = {
  branchId: string | null;
  locationId: string | null;
  receiptDateYmd: string;
  purchaseOrderId?: string | null;
  onPosted?: () => void;
  onUnlinkPo?: () => void;
};

export const PurchaseReceiptsPanel: React.FC<Props> = ({
  branchId,
  locationId,
  receiptDateYmd,
  purchaseOrderId,
  onPosted,
  onUnlinkPo,
}) => {
  if (!branchId) {
    return (
      <p className="sales-muted" style={{ padding: 16 }}>
        Branch required.
      </p>
    );
  }

  if (!locationId) {
    return (
      <p className="sales-muted" style={{ padding: 16 }}>
        Select a default storage location in the header to start receiving goods.
      </p>
    );
  }

  return (
    <div className="pos-orders-root">
      <ReceiptShell
        branchId={branchId}
        locationId={locationId}
        receiptDateYmd={receiptDateYmd}
        purchaseOrderId={purchaseOrderId}
        onPosted={onPosted}
        onUnlinkPo={onUnlinkPo}
      />
    </div>
  );
};
