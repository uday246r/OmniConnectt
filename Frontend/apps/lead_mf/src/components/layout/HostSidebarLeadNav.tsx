import React, { useEffect, useState, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import {
  LayoutDashboard,
  UserPlus,
  Users,
  ShieldCheck,
  Settings,
} from 'lucide-react';
import { useLeadStore } from '../../store/useLeadStore';
import {
  canViewDashboard,
  canViewLeads,
  canCreateLead,
  canViewAuditLogs,
  canManageFieldSettings,
} from '../../api/hostBridge';
import type { NavigationPage } from '../../types/lead';
import styles from './HostSidebarLeadNav.module.css';
import { NavItem } from '@omniremit/ui';

interface SubNavItem {
  id: NavigationPage;
  label: string;
  icon: React.ReactNode;
  visible: boolean;
}

export const HostSidebarLeadNav: React.FC = () => {
  const { activePage, setActivePage, leads, totalRecords } = useLeadStore();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const chevronBtnRef = useRef<HTMLButtonElement | null>(null);

  const userCanViewDashboard = canViewDashboard();
  const userCanViewLeads = canViewLeads();
  const userCanCreateLead = canCreateLead();
  const userCanViewAuditLogs = canViewAuditLogs();
  const userCanManageFieldSettings = canManageFieldSettings();

  const navItems: SubNavItem[] = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: <LayoutDashboard size={15} />,
      visible: userCanViewDashboard,
    },
    {
      id: 'view-lead',
      label: 'View Leads',
      icon: <Users size={15} />,
      visible: userCanViewLeads,
    },
    {
      id: 'create-lead',
      label: 'Create Lead',
      icon: <UserPlus size={15} />,
      visible: userCanCreateLead,
    },
    {
      id: 'audit-logs',
      label: 'Audit Logs',
      icon: <ShieldCheck size={15} />,
      visible: userCanViewAuditLogs,
    },
    {
      id: 'field-settings',
      label: 'Field Settings',
      icon: <Settings size={15} />,
      visible: userCanManageFieldSettings,
    },
  ];

  const visibleItems = navItems.filter((i) => i.visible);

  const toggleExpand = useCallback((e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setIsExpanded((prev) => !prev);
  }, []);

  useEffect(() => {
    // Locate the Lead Management anchor in the host sidebar
    const findLeadLink = (): HTMLAnchorElement | null => {
      const byHref = document.querySelector<HTMLAnchorElement>('a[href*="/apps/lead"], a[href*="/app/lead"]');
      if (byHref) return byHref;

      const allLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('aside nav a, aside a'));
      return (
        allLinks.find((el) => {
          const text = (el.textContent || '').toLowerCase();
          return text.includes('lead management') || text.includes('lead');
        }) || null
      );
    };

    const attachToSidebar = (): boolean => {
      const leadLink = findLeadLink();
      if (!leadLink) return false;

      let container = document.getElementById('lead-host-sidebar-subnav');
      if (!container) {
        container = document.createElement('div');
        container.id = 'lead-host-sidebar-subnav';
        container.className = 'lead-host-sidebar-subnav-wrapper';
        leadLink.insertAdjacentElement('afterend', container);
      }

      // Add styled chevron toggle button inside the Host Lead Management nav item
      let chevronBtn = leadLink.querySelector<HTMLButtonElement>('.lead-sidebar-chevron-btn');
      if (!chevronBtn) {
        chevronBtn = document.createElement('button');
        chevronBtn.type = 'button';
        chevronBtn.className = 'lead-sidebar-chevron-btn';
        chevronBtn.setAttribute('aria-label', 'Toggle Lead Management Sub-Menu');
        chevronBtn.style.cssText = `
          margin-left: auto;
          background: transparent;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          padding: 0;
          color: inherit;
          opacity: 0.75;
          transition: transform 0.18s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.15s ease;
        `;
        chevronBtn.innerHTML = `
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lead-chevron-svg" style="transition: transform 0.18s cubic-bezier(0.4, 0, 0.2, 1);">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        `;

        chevronBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleExpand();
        };

        chevronBtn.onmouseenter = () => {
          chevronBtn!.style.opacity = '1';
        };
        chevronBtn.onmouseleave = () => {
          chevronBtn!.style.opacity = '0.75';
        };

        leadLink.appendChild(chevronBtn);
      }

      chevronBtnRef.current = chevronBtn;
      setPortalTarget(container);
      return true;
    };

    // Immediate attempt
    if (!attachToSidebar()) {
      // Retry for up to 4 seconds in case the host sidebar's app list is still loading
      // asynchronously from ModuleRegistry when this remote mounts — without this, a slightly slow
      // host sidebar meant this sub-menu silently never appeared, with no recovery (matches the fix
      // already applied to customer360_mf's equivalent component).
      const intervalId = setInterval(() => {
        if (attachToSidebar()) {
          clearInterval(intervalId);
        }
      }, 150);

      const timeoutId = setTimeout(() => {
        clearInterval(intervalId);
      }, 4000);

      return () => {
        clearInterval(intervalId);
        clearTimeout(timeoutId);
        const existingContainer = document.getElementById('lead-host-sidebar-subnav');
        if (existingContainer?.parentNode) {
          existingContainer.parentNode.removeChild(existingContainer);
        }
        if (chevronBtnRef.current?.parentNode) {
          chevronBtnRef.current.parentNode.removeChild(chevronBtnRef.current);
        }
      };
    }

    return () => {
      const existingContainer = document.getElementById('lead-host-sidebar-subnav');
      if (existingContainer?.parentNode) {
        existingContainer.parentNode.removeChild(existingContainer);
      }
      if (chevronBtnRef.current?.parentNode) {
        chevronBtnRef.current.parentNode.removeChild(chevronBtnRef.current);
      }
    };
  }, [toggleExpand]);

  // Sync chevron rotation
  useEffect(() => {
    if (chevronBtnRef.current) {
      const svg = chevronBtnRef.current.querySelector<SVGElement>('.lead-chevron-svg');
      if (svg) {
        svg.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)';
      }
    }
  }, [isExpanded]);

  if (!portalTarget || !isExpanded) {
    return null;
  }

  const recordCount = totalRecords > 0 ? totalRecords : leads.length;

  return ReactDOM.createPortal(
    <div
      id="lead-mf-scope"
      className={styles.subnav}
    >
      {visibleItems.map((item) => {
        const isActive = activePage === item.id;
        const count = item.id === 'view-lead' && recordCount > 0 ? recordCount : null;

        return (
          <NavItem
            key={item.id}
            id={`host-subnav-${item.id}`}
            icon={item.icon}
            label={item.label}
            active={isActive}
            trailing={count !== null ? <span className={styles.navCount}>{count}</span> : undefined}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setActivePage(item.id);
            }}
          />
        );
      })}
    </div>,
    portalTarget
  );
};
