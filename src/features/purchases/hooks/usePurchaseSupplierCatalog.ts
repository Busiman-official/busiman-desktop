import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  purchaseService,
  type PurchaseOrder,
  type PurchaseSupplierMaster,
  type SupplierMasterImportInput,
} from '@/services/purchase.service';
import {
  buildSupplierDirectory,
  clearSavedSuppliersLocal,
  exportsSavedSuppliersForSync,
  masterToSupplierRecord,
  mergeSupplierRecords,
  paymentLabelToValue,
  type SupplierRecord,
} from '../utils/supplierDirectory';

type SaveDraft = {
  name: string;
  gstin?: string;
  email?: string;
  phone?: string;
  contactPerson?: string;
  paymentTerms?: string;
  supplierCode?: string;
};

export function usePurchaseSupplierCatalog(
  branchId: string,
  orderRows: PurchaseOrder[],
  linkedPo?: PurchaseOrder | null
) {
  const [catalog, setCatalog] = useState<SupplierRecord[]>([]);
  const [ready, setReady] = useState(false);
  const syncStarted = useRef(false);

  const refreshCatalog = useCallback(async () => {
    const rows = await purchaseService.listSupplierMasterCatalog(undefined, branchId);
    setCatalog(rows.map(masterToSupplierRecord));
    setReady(true);
  }, [branchId]);

  useEffect(() => {
    if (!branchId.trim()) {
      setCatalog([]);
      setReady(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        if (!syncStarted.current) {
          syncStarted.current = true;
          const imports: SupplierMasterImportInput[] = exportsSavedSuppliersForSync(branchId);
          await purchaseService.syncSupplierMaster({ imports }, branchId);
          if (imports.length) clearSavedSuppliersLocal(branchId);
        }
        const rows = await purchaseService.listSupplierMasterCatalog(undefined, branchId);
        if (!cancelled) {
          setCatalog(rows.map(masterToSupplierRecord));
          setReady(true);
        }
      } catch {
        if (!cancelled) {
          setCatalog([]);
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [branchId]);

  const supplierDirectory = useMemo(() => {
    const rows = [...orderRows];
    if (linkedPo && !rows.some((o) => o.id === linkedPo.id)) rows.push(linkedPo);
    return mergeSupplierRecords(buildSupplierDirectory(catalog, rows), catalog);
  }, [catalog, linkedPo, orderRows]);

  const saveSupplier = useCallback(
    async (draft: SaveDraft): Promise<SupplierRecord> => {
      const paymentTerms = draft.paymentTerms as PurchaseSupplierMaster['paymentTerms'] | undefined;
      const master = await purchaseService.upsertSupplierMaster(
        {
          name: draft.name.trim(),
          supplierCode: draft.supplierCode?.trim() || undefined,
          gstin: draft.gstin?.trim() || undefined,
          phone: draft.phone?.trim() || undefined,
          email: draft.email?.trim() || undefined,
          contactPerson: draft.contactPerson?.trim() || undefined,
          paymentTerms,
        },
        branchId
      );
      const record = masterToSupplierRecord(master);
      setCatalog((prev) => mergeSupplierRecords([prev], [record]));
      return record;
    },
    [branchId]
  );

  const saveSupplierRecord = useCallback(
    async (record: SupplierRecord): Promise<SupplierRecord> => {
      return saveSupplier({
        name: record.name,
        supplierCode: record.id?.trim() || undefined,
        gstin: record.gstin !== '—' ? record.gstin : undefined,
        email: record.email,
        phone: record.phone,
        contactPerson: record.contactPerson,
        paymentTerms: paymentLabelToValue(record.paymentTermsLabel),
      });
    },
    [saveSupplier]
  );

  return { catalog, supplierDirectory, ready, refreshCatalog, saveSupplier, saveSupplierRecord };
}
