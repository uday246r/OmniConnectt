import type { ReactNode } from "react";
import { DetailSection, DetailSections, Drawer as SharedDrawer } from "@omniconnect/ui";
import { Icon, type IconName } from "../common/Icon";
import "./DrawerContent.css";

/**
 * The platform drawer, with the two props this app's nineteen drawers are written against.
 *
 * Products used to ship its own drawer — its own overlay, header, close button, animation and 220
 * lines of CSS — so it looked and behaved unlike every other drawer on the platform. The chrome now
 * comes entirely from `@omniconnect/ui`'s `Drawer` (one close control, Escape to close, in-tree
 * rendering so the `#products-mf-scope` prefix still matches). This adapter only keeps the call
 * sites' vocabulary: `isOpen` is the shared `open`, and `badge` — which the shared header has no slot
 * for — is shown as the first line of the body.
 */
export function Drawer({
  isOpen,
  onClose,
  title,
  subtitle,
  icon,
  badge,
  width,
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
  return (
    <SharedDrawer
      open={isOpen}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      icon={icon}
      width={typeof width === "number" ? `${width}px` : width}
      footer={footer}
    >
      <DetailSections>
        {badge ? <div className="pm-drawer-badge-row">{badge}</div> : null}
        {children}
      </DetailSections>
    </SharedDrawer>
  );
}

/** A titled block inside a drawer body — the platform `DetailSection`, plus an optional header action. */
export function DrawerSection({
  title,
  icon,
  children,
  action,
}: {
  title?: string;
  icon?: IconName;
  children: ReactNode;
  action?: ReactNode;
}) {
  const content = (
    <>
      {action ? <div className="pm-drawer-section-action">{action}</div> : null}
      {children}
    </>
  );
  if (!title) return <section className="pm-drawer-section-plain">{content}</section>;
  return (
    <DetailSection title={title} icon={icon ? <Icon name={icon} size={12} /> : undefined}>
      {content}
    </DetailSection>
  );
}
