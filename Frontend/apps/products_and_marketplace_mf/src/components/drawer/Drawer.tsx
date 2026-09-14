import type { ReactNode } from "react";
import { useEffect } from "react";
import { Icon, type IconName } from "../common/Icon";
import "./Drawer.css";

export function Drawer({
  isOpen,
  onClose,
  title,
  subtitle,
  icon,
  badge,
  width = "min(700px, 94vw)",
  footer,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  width?: number | string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="pm-drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside
        className="pm-drawer"
        style={{
          width: typeof width === "number" ? `${width}px` : width,
        }}
        role="dialog"
        aria-modal="true"
      >
        <header className="pm-drawer-header">
          {/* Background decorative glass circles */}
          <div className="pm-drawer-header-circle" />

          <div className="pm-drawer-header-main">
            {icon && <div className="pm-drawer-icon">{icon}</div>}
            <div className="pm-drawer-heading">
              <div className="pm-drawer-title-row">
                <h2>{title}</h2>
                {badge}
              </div>
              {subtitle && <p>{subtitle}</p>}
            </div>
          </div>
          <button className="pm-drawer-close-btn" onClick={onClose} aria-label="Close" title="Close">
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className="pm-drawer-body">{children}</div>
        {footer && <footer className="pm-drawer-footer">{footer}</footer>}
      </aside>
    </div>
  );
}

export function DrawerSection({
  title,
  icon,
  children,
  action,
}: {
  title?: string;
  icon?: IconName | ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="pm-drawer-section">
      {title && (
        <div className="pm-drawer-section-title">
          <div className="pm-drawer-section-pill">
            {icon && typeof icon === "string" ? (
              <Icon name={icon as IconName} size={13} />
            ) : (
              icon
            )}
            <h3>{title}</h3>
          </div>
          {action}
        </div>
      )}
      <div className="pm-drawer-section-content">{children}</div>
    </section>
  );
}

