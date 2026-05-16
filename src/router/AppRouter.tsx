/**
 * Application Router
 * Optimized with lazy loading for better performance and smaller initial bundle
 */

import React, { useEffect, lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { ProtectedRoute, DashboardRedirect, RequireBranchModule } from '@/shared/components/routing';
import { NavigationFocusHandler } from '@/shared/components/routing/NavigationFocusHandler';
import { AppLayout } from '@/shared/components/layout';
import { UserRole } from '@/types';

// Lazy load pages for code splitting - reduces initial bundle size
const LoginPage = lazy(() => import('@/pages/Login/LoginPage').then(module => ({ default: module.LoginPage })));
const AttendanceLayout = lazy(() =>
  import('@/features/attendance/components/AttendanceLayout').then((module) => ({
    default: module.AttendanceLayout,
  }))
);
const AttendancePage = lazy(() => import('@/pages/Attendance/AttendancePage').then(module => ({ default: module.AttendancePage })));
const EmployeeAttendanceDetailsPage = lazy(() =>
  import('@/pages/Attendance/EmployeeAttendanceDetailsPage').then((module) => ({
    default: module.EmployeeAttendanceDetailsPage,
  }))
);
const CalendarPage = lazy(() => import('@/pages/Calendar/CalendarPage').then(module => ({ default: module.CalendarPage })));
const InventoryPage = lazy(() => import('@/pages/Inventory/InventoryPage').then(module => ({ default: module.InventoryPage })));
const SalesPage = lazy(() => import('@/pages/Sales/SalesPage').then(module => ({ default: module.SalesPage })));
const PurchasesPage = lazy(() => import('@/pages/Purchases/PurchasesPage').then(module => ({ default: module.PurchasesPage })));
const ProductDetailPage = lazy(() => import('@/features/inventory/components/ProductDetailPage').then(module => ({ default: module.ProductDetailPage })));
const SettingsPage = lazy(() => import('@/pages/Settings/SettingsPage').then(module => ({ default: module.SettingsPage })));
const AdminPage = lazy(() => import('@/pages/Admin/AdminPage').then(module => ({ default: module.AdminPage })));
const HRPage = lazy(() => import('@/pages/HR/HRPage').then(module => ({ default: module.HRPage })));
const ManagerPage = lazy(() => import('@/pages/Manager/ManagerPage').then(module => ({ default: module.ManagerPage })));
const EmployeePage = lazy(() => import('@/pages/Employee/EmployeePage').then(module => ({ default: module.EmployeePage })));
const EmployeeDetailsPage = lazy(() => import('@/pages/Employee/EmployeeDetailsPage').then(module => ({ default: module.EmployeeDetailsPage })));

// Loading fallback component
const PageLoader: React.FC = () => (
  <div style={{ 
    display: 'flex', 
    justifyContent: 'center', 
    alignItems: 'center', 
    height: '100vh',
    fontSize: '18px',
    color: '#666'
  }}>
    Loading...
  </div>
);

// Component to handle IPC messages for logs viewer (must be inside Router)
const LogsViewerHandler: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Listen for IPC message from tray menu to open logs viewer
    const handleOpenLogsViewer = () => {
      navigate('/settings#logs');
      // Also trigger a custom event that SettingsPage can listen to
      window.dispatchEvent(new CustomEvent('open-logs-viewer'));
    };

    // Listen for custom event from preload script
    window.addEventListener('open-logs-viewer', handleOpenLogsViewer);

    return () => {
      window.removeEventListener('open-logs-viewer', handleOpenLogsViewer);
    };
  }, [navigate]);

  return null; // This component doesn't render anything
};

export const AppRouter: React.FC = () => {
  return (
    <HashRouter>
      <LogsViewerHandler />
      <NavigationFocusHandler />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<LoginPage />} />

          {/* Protected Routes */}
          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              {/* Dashboard redirects to role-specific dashboard */}
              <Route path="/dashboard" element={<DashboardRedirect />} />
              <Route
                path="/attendance"
                element={
                  <RequireBranchModule module="attendance">
                    <AttendanceLayout />
                  </RequireBranchModule>
                }
              >
                <Route index element={<AttendancePage />} />
                <Route
                  path="employees/:employeeId"
                  element={
                    <ProtectedRoute allowedRoles={[UserRole.HR, UserRole.ADMIN, UserRole.MANAGER]}>
                      <EmployeeAttendanceDetailsPage />
                    </ProtectedRoute>
                  }
                />
              </Route>
              <Route
                path="/calendar"
                element={
                  <RequireBranchModule module="calendar">
                    <CalendarPage />
                  </RequireBranchModule>
                }
              />
              <Route
                path="/inventory"
                element={
                  <RequireBranchModule module="inventory">
                    <InventoryPage />
                  </RequireBranchModule>
                }
              />
              <Route
                path="/sales/*"
                element={
                  <RequireBranchModule module="sales">
                    <SalesPage />
                  </RequireBranchModule>
                }
              />
              <Route
                path="/purchases/*"
                element={
                  <RequireBranchModule module="purchases">
                    <PurchasesPage />
                  </RequireBranchModule>
                }
              />
              <Route
                path="/inventory/products/:id"
                element={
                  <RequireBranchModule module="inventory">
                    <ProductDetailPage />
                  </RequireBranchModule>
                }
              />
              <Route path="/settings" element={<SettingsPage />} />

              {/* Role-specific routes */}
              <Route
                path="/admin"
                element={
                  <ProtectedRoute allowedRoles={[UserRole.ADMIN]}>
                    <AdminPage />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/hr"
                element={
                  <ProtectedRoute allowedRoles={[UserRole.HR]}>
                    <HRPage />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/manager"
                element={
                  <ProtectedRoute allowedRoles={[UserRole.MANAGER]}>
                    <ManagerPage />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/employee"
                element={
                  <ProtectedRoute allowedRoles={[UserRole.EMPLOYEE]}>
                    <EmployeePage />
                  </ProtectedRoute>
                }
              />

              {/* Employee Details (HR/Admin/Manager) */}
              <Route
                path="/employees/:id/details"
                element={
                  <ProtectedRoute allowedRoles={[UserRole.HR, UserRole.ADMIN, UserRole.MANAGER]}>
                    <EmployeeDetailsPage />
                  </ProtectedRoute>
                }
              />

              {/* Default redirect - goes to dashboard which redirects to role-specific */}
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
            </Route>
          </Route>

          {/* Catch all - redirect to login */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    </HashRouter>
  );
};
