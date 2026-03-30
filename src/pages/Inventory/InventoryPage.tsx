/**
 * Inventory Page - Desktop
 */

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/shared/components/ui';
import { MovementType } from '@/services/inventory.service';
import { ItemMaster } from '@/features/inventory/components/ItemMaster';
import { LocationManagement } from '@/features/inventory/components/LocationManagement';
import { MovementManagement } from '@/features/inventory/components/MovementManagement';
import { InventoryReports } from '@/features/inventory/components/InventoryReports';
import { InventorySettings } from '@/features/inventory/components/InventorySettings';
import { useGlobalSearch } from '@/features/inventory/components/GlobalSearch';
import { SerialDetailPanel } from '@/features/inventory/components/SerialDetailPanel';
import './InventoryPage.css';

type InventoryTab = 'items' | 'locations' | 'movements' | 'reports' | 'settings';

export const InventoryPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<InventoryTab>('items');
  const isUpdatingTabRef = React.useRef(false);
  const lastTabRef = React.useRef<string | null>(null);
  const { open: openSearch } = useGlobalSearch();

  useEffect(() => {
    // Prevent loops during tab updates
    if (isUpdatingTabRef.current) return;
    
    // Sync tab with URL - prioritize explicit 'tab' parameter
    const tab = searchParams.get('tab') as InventoryTab | null;
    const itemId = searchParams.get('itemId');
    const locationId = searchParams.get('locationId');
    
    // Create a stable key for comparison to prevent unnecessary re-runs
    const urlKey = `${tab || ''}-${itemId || ''}-${locationId || ''}`;
    if (urlKey === lastTabRef.current) return; // No change, skip
    lastTabRef.current = urlKey;
    
    if (tab && ['items', 'locations', 'movements', 'reports', 'settings'].includes(tab)) {
      if (activeTab !== tab) {
        isUpdatingTabRef.current = true;
        setActiveTab(tab);
        // Reset flag after state update
        setTimeout(() => {
          isUpdatingTabRef.current = false;
        }, 0);
      }
      return; // If explicit tab is set, don't auto-switch based on itemId/locationId
    }
    
    // Only auto-switch if no explicit tab parameter
    // Set activeTab based on URL params (for deep linking)
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
  
  // Update URL when tab changes (but only if tab was changed by user, not by URL sync)
  useEffect(() => {
    // Prevent loops during tab updates
    if (isUpdatingTabRef.current) return;

    const currentTab = searchParams.get('tab');
    const validTabs = ['items', 'locations', 'movements', 'reports', 'settings'];
    const urlHasValidTab = currentTab && validTabs.includes(currentTab);
    if (currentTab !== activeTab && !urlHasValidTab) {
      isUpdatingTabRef.current = true;
      const newParams = new URLSearchParams(searchParams);
      newParams.set('tab', activeTab);
      // Clear conflicting params when switching tabs
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

  return (
    <div className="inventory-page">
      <div className="inventory-page-header">
        <div>
          <h1>Inventory Dashboard</h1>
        </div>
        <div className="quick-actions-header">
          <Button
            variant="primary"
            onClick={() => {
              const p = new URLSearchParams(searchParams);
              p.set('tab', 'movements');
              p.set('create', '1');
              p.set('movementType', MovementType.RECEIPT);
              p.set('reasonCode', 'RECEIPT');
              setSearchParams(p);
              setActiveTab('movements');
              window.dispatchEvent(new CustomEvent('quick-receipt'));
            }}
            title="Quick Receipt (Ctrl+R)"
          >
            Quick Receipt
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              const p = new URLSearchParams(searchParams);
              p.set('tab', 'movements');
              p.set('create', '1');
              p.set('movementType', MovementType.TRANSFER);
              p.set('reasonCode', 'TRANSFER');
              setSearchParams(p);
              setActiveTab('movements');
              window.dispatchEvent(new CustomEvent('quick-transfer'));
            }}
            title="Quick Transfer (Ctrl+T)"
          >
            Quick Transfer
          </Button>
          <Button
            variant="secondary"
            onClick={openSearch}
            title="Global Search (Ctrl+K)"
            style={{ minWidth: 'auto', padding: '8px 12px' }}
          >
            🔍 Search
          </Button>
        </div>
      </div>

      <div className="inventory-page-tabs">
        <button
          className={`inventory-tab ${activeTab === 'items' ? 'active' : ''}`}
          onClick={() => {
            const newParams = new URLSearchParams(searchParams);
            newParams.set('tab', 'items');
            // Clear locationId when switching to items tab to prevent conflicts
            newParams.delete('locationId');
            setSearchParams(newParams, { replace: true });
            setActiveTab('items');
          }}
        >
          Master
        </button>
        <button
          className={`inventory-tab ${activeTab === 'locations' ? 'active' : ''}`}
          onClick={() => {
            const newParams = new URLSearchParams(searchParams);
            newParams.set('tab', 'locations');
            // Clear itemId when switching to locations tab to prevent conflicts
            newParams.delete('itemId');
            newParams.delete('variantId');
            newParams.delete('itemSubTab');
            setSearchParams(newParams, { replace: true });
            setActiveTab('locations');
          }}
        >
          Location Management
        </button>
        <button
          className={`inventory-tab ${activeTab === 'movements' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('movements');
            const newParams = new URLSearchParams(searchParams);
            newParams.set('tab', 'movements');
            setSearchParams(newParams, { replace: true });
          }}
        >
          Stock Movements
        </button>
        <button
          className={`inventory-tab ${activeTab === 'reports' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('reports');
            const newParams = new URLSearchParams(searchParams);
            newParams.set('tab', 'reports');
            setSearchParams(newParams, { replace: true });
          }}
        >
          Reports
        </button>
        <button
          className={`inventory-tab ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('settings');
            const newParams = new URLSearchParams(searchParams);
            newParams.set('tab', 'settings');
            setSearchParams(newParams, { replace: true });
          }}
        >
          Settings
        </button>
      </div>

      <div className="inventory-page-content">
        {activeTab === 'items' && <ItemMaster />}
        {activeTab === 'locations' && (
          <LocationManagement locationId={searchParams.get('locationId') || undefined} />
        )}
        {activeTab === 'movements' && <MovementManagement />}
        {activeTab === 'reports' && <InventoryReports />}
        {activeTab === 'settings' && <InventorySettings />}
      </div>

      {/* Serial Detail Panel - Global, opens from URL param or GlobalSearch */}
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
