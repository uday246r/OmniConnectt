import { useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Icon, type IconName } from "../components/common/Icon";
import { useProductStore } from "../stores/useProductStore";
import { getCurrentUser } from "../permissions/currentUser";
import "./StandaloneShell.css";

const NAV_ITEMS: { to: string; label: string; icon: IconName }[] = [
  { to: "/product-marketplace/dashboard", label: "Dashboard", icon: "dashboard" },
  { to: "/product-marketplace/products", label: "Products", icon: "package" },
  { to: "/product-marketplace/categories", label: "Categories", icon: "grid" },
  { to: "/product-marketplace/promotions", label: "Promotions", icon: "tag" },
  { to: "/product-marketplace/applications", label: "Applications", icon: "file" },
  { to: "/product-marketplace/setup", label: "Setup", icon: "settings" },
  { to: "/product-marketplace/audit-logs", label: "Audit Logs", icon: "info" },
];

/**
 * Minimal local-dev navigation shell for running the Product Marketplace remote standalone.
 * This is NOT the Host App shell - the Host App will provide the real global header/sidebar
 * (auth, notifications, global search) once this remote is mounted via Module Federation.
 * The top bar here exists only for visual parity while developing standalone; the search box
 * is real (it drives the Products page's own search), the bell/help icons are inert placeholders.
 */
export function StandaloneShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const setProductSearch = useProductStore((s) => s.setSearch);
  const [query, setQuery] = useState("");
  const currentUser = getCurrentUser();

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setProductSearch(query.trim());
    navigate("/product-marketplace/products");
  }

  return (
    <div className="pm-shell">
      <aside className="pm-shell-sidebar">
        <div className="pm-shell-brand">
          <div className="pm-shell-brand-icon">
            <Icon name="building" size={18} />
          </div>
          <div>
            <strong>Product Marketplace</strong>
            <span>Remote (standalone dev)</span>
          </div>
        </div>
        <nav className="pm-shell-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `pm-shell-nav-link ${isActive ? "active" : ""}`}>
              <Icon name={item.icon} size={17} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="pm-shell-footer">
          <p>Bank of OmniConnect</p>
          <span>Single-bank product marketplace</span>
        </div>
      </aside>
      <div className="pm-shell-main">
        <header className="pm-shell-topbar">
          <form className="pm-shell-topbar-search" onSubmit={handleSearchSubmit}>
            <Icon name="search" size={16} />
            <input placeholder="Search for products, services, accounts and more..." value={query} onChange={(e) => setQuery(e.target.value)} />
          </form>
          <div className="pm-shell-topbar-actions">
            {/* Notifications and Help are Host App shell concerns. They are rendered disabled rather
                than wired to a no-op handler, so this dev shell never presents a control that looks
                clickable but does nothing. The Host App supplies the real ones after integration. */}
            <button
              className="pm-icon-btn"
              aria-label="Notifications"
              title="Notifications are provided by the Host App"
              disabled
            >
              <Icon name="bell" size={17} />
            </button>
            <button
              className="pm-icon-btn"
              aria-label="Help"
              title="Help is provided by the Host App"
              disabled
            >
              <Icon name="info" size={17} />
            </button>
            <div className="pm-shell-user">
              <div className="pm-shell-user-avatar">{currentUser.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}</div>
              <span>{currentUser.name}</span>
            </div>
          </div>
        </header>
        <div className="pm-main">{children}</div>
      </div>
    </div>
  );
}
