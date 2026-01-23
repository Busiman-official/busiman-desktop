/**
 * App Layout Component - Main application layout wrapper
 */

import React from 'react';
import { Outlet } from 'react-router-dom';
import { Navbar } from './Navbar';
import { GlobalSearchProvider, GlobalSearchModal } from '@/features/inventory/components/GlobalSearch';
import './AppLayout.css';

export const AppLayout: React.FC = () => {
  return (
    <GlobalSearchProvider>
      <div className="app-layout">
        <Navbar />
        <main className="app-main">
          <Outlet />
        </main>
        <GlobalSearchModal />
      </div>
    </GlobalSearchProvider>
  );
};

