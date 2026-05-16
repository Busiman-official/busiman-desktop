/**
 * Navbar Component - Minimal, compact navigation bar
 */

import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { authStore } from '@/store/authStore';
import { companyStore } from '@/store/companyStore';
import { useBranchContext } from '@/hooks/useBranchContext';
import { UserRole } from '@/types';
import { BusimanLogo } from './BusimanLogo';
import './Navbar.css';

interface NavItem {
  label: string;
  path: string;
  roles?: string[];
  disabled?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', path: '/dashboard' },
  { label: 'Attendance', path: '/attendance' },
  { label: 'Inventory', path: '/inventory' },
  { label: 'Sales', path: '/sales' },
  { label: 'Purchases', path: '/purchases' },
  { label: 'Calendar', path: '/calendar' },
  { label: 'Settings', path: '/settings' },
];

export const Navbar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = authStore();
  const { company } = companyStore();
  const { departments } = useBranchContext();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    };

    if (userMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [userMenuOpen]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setUserMenuOpen(false);
      }
    };

    if (userMenuOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [userMenuOpen]);

  const getRoleDashboard = (): string => {
    if (!user) return '/dashboard';
    
    const roleDashboards: Record<string, string> = {
      admin: '/admin',
      hr: '/hr',
      manager: '/manager',
      employee: '/employee',
    };
    
    return roleDashboards[user.role] || '/dashboard';
  };

  const handleNavClick = (path: string) => {
    if (path === '/dashboard') {
      navigate(getRoleDashboard());
    } else {
      navigate(path);
    }
  };

  const handleLogoClick = () => {
    navigate(getRoleDashboard());
  };

  const isActive = (path: string): boolean => {
    if (path === '/dashboard') {
      const roleDashboard = getRoleDashboard();
      return (
        location.pathname === roleDashboard ||
        location.pathname === '/dashboard' ||
        Boolean(
          user &&
            ((user.role === UserRole.ADMIN && location.pathname === '/admin') ||
              (user.role === UserRole.HR && location.pathname === '/hr') ||
              (user.role === UserRole.MANAGER && location.pathname === '/manager') ||
              (user.role === UserRole.EMPLOYEE && location.pathname === '/employee') ||
              (user.role === UserRole.INVENTORY_APPROVER && location.pathname === '/employee'))
        )
      );
    }
    if (path === '/calendar') {
      return location.pathname === path || location.pathname.startsWith(path + '/');
    }
    if (path === '/inventory') {
      return location.pathname === path || location.pathname.startsWith(path + '/');
    }
    if (path === '/sales') {
      return location.pathname === path || location.pathname.startsWith(path + '/');
    }
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  const hasModule = (slug: string): boolean => {
    const s = slug.toLowerCase();
    const fromCtx = departments?.some((d) => d.name.toLowerCase() === s);
    if (fromCtx) return true;
    return (user?.branchDepartments ?? []).some((d) => String(d).toLowerCase() === s);
  };

  const visibleNavItems = NAV_ITEMS.filter((item) => {
    if (item.disabled) return false;
    const isAdmin = user?.role === UserRole.ADMIN;
    if (item.path === '/inventory') {
      return hasModule('inventory') || isAdmin;
    }
    if (item.path === '/sales') {
      return hasModule('sales') || isAdmin;
    }
    if (item.path === '/purchases') {
      return hasModule('purchases') || isAdmin;
    }
    if (item.path === '/attendance') {
      return hasModule('attendance') || isAdmin;
    }
    if (item.path === '/calendar') {
      return hasModule('calendar') || isAdmin;
    }
    if (item.roles && user) {
      return item.roles.includes(user.role);
    }
    return true;
  });

  const handleLogout = async () => {
    setUserMenuOpen(false);
    await logout();
    navigate('/login');
  };

  return (
    <nav className="navbar" role="navigation" aria-label="Main navigation">
      <div className="navbar-container">
        <div className="navbar-left">
          <button
            className="navbar-logo"
            onClick={handleLogoClick}
            aria-label="Go to Dashboard"
          >
            {company?.logoUrl ? (
              <img
                src={company.logoUrl}
                alt={`${company.displayName || 'Busiman'} Logo`}
                className="navbar-logo-img"
              />
            ) : (
              <BusimanLogo className="navbar-logo-img" />
            )}
          </button>
        </div>

        <div className="navbar-center">
          <ul className="navbar-nav" role="menubar">
            {visibleNavItems.map((item) => {
              const active = isActive(item.path);
              return (
                <li key={item.path} role="none">
                  <button
                    className={`navbar-nav-item ${active ? 'active' : ''}`}
                    onClick={() => handleNavClick(item.path)}
                    aria-current={active ? 'page' : undefined}
                    role="menuitem"
                    disabled={item.disabled}
                  >
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="navbar-right">
          <div className="navbar-user" ref={menuRef}>
            <button
              className="navbar-user-trigger"
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              aria-expanded={userMenuOpen}
              aria-haspopup="true"
              aria-label="User menu"
            >
              <div className="navbar-user-info">
                <span className="navbar-user-name">
                  {company?.displayName || 'Busiman'}
                </span>
                <span className="navbar-user-role">{user?.role}</span>
              </div>
            </button>

            {userMenuOpen && (
              <div className="navbar-user-menu" role="menu">
                <button
                  className="navbar-menu-item"
                  onClick={() => {
                    setUserMenuOpen(false);
                    navigate('/settings');
                  }}
                  role="menuitem"
                >
                  Settings
                </button>
                {user?.role === UserRole.ADMIN && (
                  <button
                    className="navbar-menu-item"
                    onClick={handleLogout}
                    role="menuitem"
                  >
                    Logout
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};

