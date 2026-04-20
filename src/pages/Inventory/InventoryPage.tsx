/**
 * Inventory Page - Desktop
 * Unified module header reuses SalesModuleHeader (tabs + actions) for visual parity with Sales.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MovementType } from '@/services/inventory.service';
import { SalesModuleHeader, type SalesTabDef } from '@/features/sales/components/SalesModuleHeader';
import { ItemMaster } from '@/features/inventory/components/ItemMaster';
import { LocationManagement } from '@/features/inventory/components/LocationManagement';
import { MovementManagement } from '@/features/inventory/components/MovementManagement';
import { InventoryReports } from '@/features/inventory/components/InventoryReports';
import { InventorySettings } from '@/features/inventory/components/InventorySettings';
import { useGlobalSearch } from '@/features/inventory/components/GlobalSearch';
import { SerialDetailPanel } from '@/features/inventory/components/SerialDetailPanel';
import {
  ModuleHeaderOutlineButton,
  ModuleHeaderPrimaryButton,
} from '@/shared/components/module-header/ModuleHeaderButton';
import './InventoryPage.css';

type InventoryTab = 'items' | 'locations' | 'movements' | 'reports' | 'settings';

const INVENTORY_TAB_DEFS: readonly SalesTabDef[] = [
  { id: 'items', label: 'Products' },
  { id: 'locations', label: 'Locations' },
  { id: 'movements', label: 'Movements' },
  { id: 'reports', label: 'Reports' },
  { id: 'settings', label: 'Settings' },
] as const;

export const InventoryPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<InventoryTab>('items');
  const isUpdatingTabRef = React.useRef(false);
  const lastTabRef = React.useRef<string | null>(null);
  const { open: openSearch } = useGlobalSearch();

  useEffect(() => {
    if (isUpdatingTabRef.current) return;

    const tab = searchParams.get('tab') as InventoryTab | null;
    const itemId = searchParams.get('itemId');
    const locationId = searchParams.get('locationId');

    const urlKey = `${tab || ''}-${itemId || ''}-${locationId || ''}`;
    if (urlKey === lastTabRef.current) return;
    lastTabRef.current = urlKey;

    if (tab && ['items', 'locations', 'movements', 'reports', 'settings'].includes(tab)) {
      if (activeTab !== tab) {
        isUpdatingTabRef.current = true;
        setActiveTab(tab);
        setTimeout(() => {
          isUpdatingTabRef.current = false;
        }, 0);
      }
      return;
    }

    if (itemId && activeTab !== 'items') {
      isUpdatingTabRef.current = true;
      setActiveTab('items');
      setTimeout(() => {
        isUpdatingTabRef.current = false;
      }, 0);
    } else if (locationId && activeTab !== 'locations') {
      isUpdatingTabRef.current = true;
      setActiveTab('locations');
      setTimeout(() => {
        isUpdatingTabRef.current = false;
      }, 0);
    }
  }, [searchParams.toString(), activeTab]);

  useEffect(() => {
    if (isUpdatingTabRef.current) return;

    const currentTab = searchParams.get('tab');
    const validTabs = ['items', 'locations', 'movements', 'reports', 'settings'];
    const urlHasValidTab = currentTab && validTabs.includes(currentTab);
    if (currentTab !== activeTab && !urlHasValidTab) {
      isUpdatingTabRef.current = true;
      const newParams = new URLSearchParams(searchParams);
      newParams.set('tab', activeTab);
      if (activeTab === 'items') {
        newParams.delete('locationId');
      } else if (activeTab === 'locations') {
        newParams.delete('itemId');
        newParams.delete('variantId');
        newParams.delete('itemSubTab');
      }
      setSearchParams(newParams, { replace: true });
      lastTabRef.current = `${activeTab}-${newParams.get('itemId') || ''}-${newParams.get('locationId') || ''}`;
      setTimeout(() => {
        isUpdatingTabRef.current = false;
      }, 0);
    }
  }, [activeTab, searchParams.toString(), setSearchParams]);

  React.useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'r') {
        e.preventDefault();
        const p = new URLSearchParams(searchParams);
        p.set('tab', 'movements');
        p.set('create', '1');
        p.set('movementType', MovementType.RECEIPT);
        p.set('reasonCode', 'RECEIPT');
        setSearchParams(p);
        setActiveTab('movements');
        window.dispatchEvent(new CustomEvent('quick-receipt'));
      }
      if (e.ctrlKey && e.key === 't') {
        e.preventDefault();
        const p = new URLSearchParams(searchParams);
        p.set('tab', 'movements');
        p.set('create', '1');
        p.set('movementType', MovementType.TRANSFER);
        p.set('reasonCode', 'TRANSFER');
        setSearchParams(p);
        setActiveTab('movements');
        window.dispatchEvent(new CustomEvent('quick-transfer'));
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => {
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, [searchParams, setSearchParams]);

  const goQuickReceipt = useCallback(() => {
    const p = new URLSearchParams(searchParams);
    p.set('tab', 'movements');
    p.set('create', '1');
    p.set('movementType', MovementType.RECEIPT);
    p.set('reasonCode', 'RECEIPT');
    setSearchParams(p);
    setActiveTab('movements');
    window.dispatchEvent(new CustomEvent('quick-receipt'));
  }, [searchParams, setSearchParams]);

  const goQuickTransfer = useCallback(() => {
    const p = new URLSearchParams(searchParams);
    p.set('tab', 'movements');
    p.set('create', '1');
    p.set('movementType', MovementType.TRANSFER);
    p.set('reasonCode', 'TRANSFER');
    setSearchParams(p);
    setActiveTab('movements');
    window.dispatchEvent(new CustomEvent('quick-transfer'));
  }, [searchParams, setSearchParams]);

  const goAddProduct = useCallback(() => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('tab', 'items');
    newParams.delete('locationId');
    newParams.set('addProduct', '1');
    setSearchParams(newParams, { replace: true });
    setActiveTab('items');
  }, [searchParams, setSearchParams]);

  const onInventoryTabChange = useCallback(
    (id: string) => {
      const newParams = new URLSearchParams(searchParams);
      newParams.set('tab', id);
      if (id === 'items') {
        newParams.delete('locationId');
      } else if (id === 'locations') {
        newParams.delete('itemId');
        newParams.delete('variantId');
        newParams.delete('itemSubTab');
      }
      setSearchParams(newParams, { replace: true });
      setActiveTab(id as InventoryTab);
    },
    [searchParams, setSearchParams],
  );

  const headerTrailing = useMemo(
    () => (
      <>
        <ModuleHeaderPrimaryButton onClick={goQuickReceipt} title="Quick Receipt (Ctrl+R)">
          Quick Receipt
        </ModuleHeaderPrimaryButton>
        <ModuleHeaderOutlineButton onClick={goQuickTransfer} title="Quick Transfer (Ctrl+T)">
          Quick Transfer
        </ModuleHeaderOutlineButton>
        <ModuleHeaderOutlineButton onClick={openSearch} title="Global Search (Ctrl+K)">
          🔍 Search
        </ModuleHeaderOutlineButton>
        <ModuleHeaderPrimaryButton onClick={goAddProduct} title="Add product (Ctrl+N in Master list)">
          Add product
        </ModuleHeaderPrimaryButton>
      </>
    ),
    [goAddProduct, goQuickReceipt, goQuickTransfer, openSearch],
  );

  return (
    <div className="inventory-page">
      <SalesModuleHeader
        tabs={INVENTORY_TAB_DEFS}
        activeTab={activeTab}
        onTabChange={onInventoryTabChange}
        tabListAriaLabel="Inventory sections"
        trailing={headerTrailing}
        trailingClassName="sales-module-header__actions--nowrap"
      />

      <div className="inventory-page-content">
        {activeTab === 'items' && <ItemMaster />}
        {activeTab === 'locations' && (
          <LocationManagement locationId={searchParams.get('locationId') || undefined} />
        )}
        {activeTab === 'movements' && <MovementManagement />}
        {activeTab === 'reports' && <InventoryReports />}
        {activeTab === 'settings' && <InventorySettings />}
      </div>

      <SerialDetailPanel
        isOpen={!!searchParams.get('serialNumber')}
        onClose={() => {
          const params = new URLSearchParams(searchParams);
          params.delete('serialNumber');
          setSearchParams(params, { replace: true });
        }}
        serialNumber={searchParams.get('serialNumber')}
      />
    </div>
  );
};
