/**
 * Create New Sale — guided entry step before the POS cart.
 * Pick a sales point (counter) and optionally a customer, then hand off into PosShell
 * (via SalesPage's `orders` tab) for the actual cart/checkout — no cart logic lives here.
 */

import React, { useMemo, useState } from 'react';
import { Button } from '@/shared/components/ui';
import { EmptyState } from '@/shared/components/data-display';
import { Modal } from '@/shared/components/modals/Modal';
import { docId } from '@/features/sales/utils/ids';
import { salesService, type SalesCustomer } from '@/services/sales.service';
import {
  PosCustomerSelectionModal,
  type PosNewCustomerPayload,
} from '@/features/sales/components/pos/PosCustomerSelectionModal';
import { extractErrorMessage } from '@/utils/error';
import './CreateNewSalePage.css';

type SalesPointRow = {
  _id?: string;
  id?: string;
  name?: string;
  code?: string;
  sessionStatus?: string;
};

interface Props {
  branchId: string | null;
  salesPoints: Record<string, unknown>[];
  customers: Record<string, unknown>[];
  onCancel: () => void;
  onStart: (salesPointId: string, customerId: string | null) => void;
}

export const CreateNewSalePage: React.FC<Props> = ({
  branchId,
  salesPoints,
  customers,
  onCancel,
  onStart,
}) => {
  const rows = salesPoints as SalesPointRow[];
  const [selectedId, setSelectedId] = useState<string>(() =>
    rows.length === 1 ? docId(rows[0]) || '' : ''
  );
  const [customer, setCustomer] = useState<SalesCustomer | null>(null);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [customerBusy, setCustomerBusy] = useState(false);
  const [customerError, setCustomerError] = useState<string | null>(null);

  const selectedSalesPoint = useMemo(
    () => rows.find((s) => docId(s) === selectedId) || null,
    [rows, selectedId]
  );
  const closedSelected = selectedSalesPoint?.sessionStatus === 'closed';

  const confirmExisting = (id: string) => {
    const row = customers.find((c) => docId(c as { _id?: string; id?: string }) === id) as
      | SalesCustomer
      | undefined;
    if (row) {
      setCustomer(row);
      setCustomerModalOpen(false);
      return;
    }
    setCustomerBusy(true);
    setCustomerError(null);
    salesService
      .getCustomer(id, branchId || undefined)
      .then((full) => {
        setCustomer(full);
        setCustomerModalOpen(false);
      })
      .catch((e: unknown) => setCustomerError(extractErrorMessage(e, 'Could not load customer.')))
      .finally(() => setCustomerBusy(false));
  };

  const confirmNew = (payload: PosNewCustomerPayload) => {
    if (!branchId) return;
    setCustomerBusy(true);
    setCustomerError(null);
    salesService
      .createCustomer(
        {
          name: payload.name.trim() || 'Customer',
          phone: payload.phone.trim(),
          email: payload.email,
          gstNumber: payload.gstNumber,
          segment: payload.segment,
          stateUt: payload.stateUt,
          paymentTerms: payload.paymentTerms,
          billingAddress: payload.billingAddress,
          shippingAddress: payload.shippingAddress,
        },
        branchId
      )
      .then((created) => {
        setCustomer(created);
        setCustomerModalOpen(false);
      })
      .catch((e: unknown) =>
        setCustomerError(extractErrorMessage(e, 'Could not create customer.'))
      )
      .finally(() => setCustomerBusy(false));
  };

  if (!branchId) {
    return <p className="sales-muted">Branch required.</p>;
  }

  return (
    <div className="cns-page">
      <div className="cns-card">
        <header className="cns-header">
          <h2>Create new sale</h2>
          <p>Pick a counter to start ringing up items — same cart and checkout as always.</p>
        </header>

        <section className="cns-section">
          <h3>1. Sales point</h3>
          {rows.length === 0 ? (
            <EmptyState
              title="No sales points yet"
              message="Create a sales point (counter) first, then come back here."
            />
          ) : (
            <div className="cns-sp-grid">
              {rows.map((sp) => {
                const id = docId(sp) || '';
                const active = id === selectedId;
                const closed = sp.sessionStatus === 'closed';
                return (
                  <button
                    key={id}
                    type="button"
                    className={`cns-sp-card${active ? ' cns-sp-card--active' : ''}`}
                    onClick={() => setSelectedId(id)}
                  >
                    <span className="cns-sp-card__name">{sp.name || 'Sales point'}</span>
                    {sp.sessionStatus ? (
                      <span className={`cns-sp-card__status cns-sp-card__status--${sp.sessionStatus}`}>
                        {closed ? 'Session closed' : 'Session open'}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
          {closedSelected ? (
            <p className="cns-hint cns-hint--warn">
              This counter&rsquo;s session is closed — you can still open the cart, but check
              with your admin if that&rsquo;s unexpected.
            </p>
          ) : null}
        </section>

        <section className="cns-section">
          <h3>2. Customer <span className="cns-optional">(optional)</span></h3>
          <div className="cns-customer-row">
            <div className="cns-customer-info">
              {customer ? (
                <>
                  <span className="cns-customer-name">{customer.name}</span>
                  <span className="cns-customer-meta">
                    {[customer.phone, customer.customerCode].filter(Boolean).join(' · ') || '—'}
                  </span>
                </>
              ) : (
                <span className="cns-customer-name cns-customer-name--muted">Walk-in customer</span>
              )}
            </div>
            <div className="cns-customer-actions">
              <Button type="button" variant="secondary" onClick={() => setCustomerModalOpen(true)}>
                {customer ? 'Change customer' : 'Choose customer'}
              </Button>
              {customer ? (
                <Button type="button" variant="ghost" onClick={() => setCustomer(null)}>
                  Clear
                </Button>
              ) : null}
            </div>
          </div>
        </section>

        <footer className="cns-footer">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!selectedId}
            onClick={() => onStart(selectedId, customer ? customer._id : null)}
          >
            Start sale
          </Button>
        </footer>
      </div>

      <Modal
        isOpen={customerModalOpen}
        onClose={() => setCustomerModalOpen(false)}
        title="Customer for this sale"
        size="xl"
        className="pos-checkout-customer-modal-wrap"
      >
        <PosCustomerSelectionModal
          isOpen={customerModalOpen}
          mode="quotation"
          branchId={branchId}
          busy={customerBusy}
          error={customerError}
          counterCustomerId={null}
          counterCustomerName={null}
          onClose={() => setCustomerModalOpen(false)}
          onConfirmExisting={confirmExisting}
          onConfirmNew={confirmNew}
          onWalkIn={() => setCustomerModalOpen(false)}
          onUseCounterCustomer={() => {}}
        />
      </Modal>
    </div>
  );
};
