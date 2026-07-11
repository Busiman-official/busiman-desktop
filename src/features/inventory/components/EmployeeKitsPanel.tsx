/**
 * Employee Kits admin view — browse per-employee kit balances.
 */

import { useCallback, useEffect, useState, type ReactElement } from 'react';

import {
  employeeInventoryService,
  type EmployeeKitHolder,
  type EmployeeKitSummary,
} from '@/services/employee-inventory.service';
import { Button, Select } from '@/shared/components/ui';

export function EmployeeKitsPanel(): ReactElement {
  const [employees, setEmployees] = useState<EmployeeKitHolder[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [kit, setKit] = useState<EmployeeKitSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadEmployees = useCallback(async () => {
    try {
      const rows = await employeeInventoryService.listEmployees();
      setEmployees(rows);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to load employees');
    }
  }, []);

  useEffect(() => {
    void loadEmployees();
  }, [loadEmployees]);

  const loadKit = useCallback(async () => {
    if (!selectedUserId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await employeeInventoryService.getKit(selectedUserId);
      setKit(data);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to load kit');
      setKit(null);
    } finally {
      setLoading(false);
    }
  }, [selectedUserId]);

  const forceReturnAll = useCallback(async () => {
    if (!selectedUserId || !kit) return;
    const rows = (kit.stock ?? []).filter((row: any) => {
      const qty = Number(row?.onHandQuantity ?? row?.available ?? row?.quantity ?? 0);
      return qty > 0 && row?.itemId;
    });
    if (!rows.length) {
      setError('Kit is already empty');
      return;
    }
    const warehouseLocationId = window.prompt(
      'Enter warehouse / pick location ID to return kit stock into:',
    );
    if (!warehouseLocationId?.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await employeeInventoryService.transfer({
        kind: 'RETURN',
        fromUserId: selectedUserId,
        warehouseLocationId: warehouseLocationId.trim(),
        notes: 'Manager force return from Employee Kits panel',
        lines: rows.map((row: any) => ({
          itemId: String(row.itemId),
          quantity: Number(row.onHandQuantity ?? row.available ?? row.quantity ?? 0),
          variantId: row.variantId ? String(row.variantId) : undefined,
        })),
      });
      await loadKit();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Force return failed');
    } finally {
      setLoading(false);
    }
  }, [kit, loadKit, selectedUserId]);

  useEffect(() => {
    void loadKit();
  }, [loadKit]);

  const stockRows = (kit?.stock ?? []).filter((row: any) => {
    const qty = Number(row?.onHandQuantity ?? row?.available ?? row?.quantity ?? 0);
    return qty > 0;
  });

  return (
    <div style={{ padding: 16, display: 12 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Employee Kits</h2>
      <p style={{ margin: 0, color: '#64748b', fontSize: 13 }}>
        View personal kit inventory. Reassigning a service job auto-handoffs unused kit stock.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Select
          value={selectedUserId}
          onChange={(e) => setSelectedUserId(e.target.value)}
          options={[
            { value: '', label: 'Select employee' },
            ...employees.map((e) => ({
              value: e.userId,
              label: `${e.name}${e.hasKit ? '' : ' (no kit yet)'}`,
            })),
          ]}
        />
        <Button variant="secondary" size="sm" disabled={loading || !selectedUserId} onClick={() => void loadKit()}>
          Refresh
        </Button>
        <Button
          variant="danger"
          size="sm"
          disabled={loading || !selectedUserId || !kit}
          onClick={() => void forceReturnAll()}
        >
          Force return to warehouse
        </Button>
      </div>
      {error ? <p style={{ color: '#dc2626' }}>{error}</p> : null}
      {kit ? (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
          <div style={{ fontWeight: 600 }}>{kit.employeeName || kit.name}</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            {kit.code} · {kit.kitLocationId}
          </div>
          {stockRows.length === 0 ? (
            <p style={{ color: '#94a3b8' }}>Kit is empty</p>
          ) : (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {stockRows.map((row: any, idx: number) => (
                <li key={`${row.itemId ?? idx}`}>
                  {row.itemName || row.name || row.sku || 'Item'} ×{' '}
                  {Number(row.onHandQuantity ?? row.available ?? row.quantity ?? 0)}
                </li>
              ))}
            </ul>
          )}
          {kit.serials?.length ? (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Serials</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {kit.serials.map((s) => (
                  <li key={s.serialNumber}>{s.serialNumber}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default EmployeeKitsPanel;
