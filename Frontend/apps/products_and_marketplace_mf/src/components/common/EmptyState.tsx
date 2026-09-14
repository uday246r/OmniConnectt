import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function EmptyState({
  icon = "info",
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="pm-state">
      <div className="pm-state-icon">
        <Icon name={icon} size={26} />
      </div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="pm-state">
      <div className="pm-state-icon" style={{ color: "var(--color-danger)", background: "var(--color-danger-bg)" }}>
        <Icon name="info" size={26} />
      </div>
      <h3>Something went wrong</h3>
      <p>{message}</p>
      {onRetry && (
        <button className="pm-btn pm-btn-outline pm-btn-sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function LoadingSkeletonGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="pm-skeleton-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="pm-card pm-skeleton-card">
          <div className="pm-skeleton" style={{ width: 40, height: 40, borderRadius: 10 }} />
          <div className="pm-skeleton" style={{ width: "70%", height: 16, marginTop: 12 }} />
          <div className="pm-skeleton" style={{ width: "90%", height: 12, marginTop: 8 }} />
          <div className="pm-skeleton" style={{ width: "50%", height: 12, marginTop: 8 }} />
          <div className="pm-skeleton" style={{ width: "100%", height: 32, marginTop: 16, borderRadius: 8 }} />
        </div>
      ))}
    </div>
  );
}

export function LoadingSkeletonRows({ count = 6 }: { count?: number }) {
  return (
    <div className="pm-skeleton-rows">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="pm-skeleton" style={{ width: "100%", height: 44, marginBottom: 8 }} />
      ))}
    </div>
  );
}
