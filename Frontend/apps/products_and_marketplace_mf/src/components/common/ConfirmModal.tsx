import { Icon } from "./Icon";
import "./ConfirmModal.css";

export interface ConfirmModalDetail {
  label: string;
  value: string | number | undefined | null;
}

export interface ConfirmModalSecondaryAction {
  label: string;
  onClick: () => void;
  variant?: "danger" | "warning" | "primary" | "outline";
}

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  entityName?: string;
  details?: ConfirmModalDetail[];
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning" | "primary";
  isLoading?: boolean;
  errorMessage?: string | null;
  secondaryAction?: ConfirmModalSecondaryAction;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  isOpen,
  title,
  message,
  entityName,
  details,
  confirmText = "Delete",
  variant = "danger",
  isLoading = false,
  errorMessage = null,
  secondaryAction,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <div className="pm-modal-overlay" onClick={onCancel} role="dialog" aria-modal="true">
      <aside className="pm-confirm-drawer" onClick={(e) => e.stopPropagation()}>
        <header className={`pm-confirm-drawer-header ${variant}`}>
          <div className="pm-confirm-header-circle" />
          <div className="pm-confirm-header-main">
            <div className={`pm-confirm-icon ${variant}`}>
              <Icon name={variant === "danger" ? "trash" : "info"} size={22} />
            </div>
            <div className="pm-confirm-heading">
              <div className="pm-confirm-title-row">
                <h2>{title}</h2>
                <span className={`pm-badge ${variant === "danger" ? "pm-badge-danger" : variant === "warning" ? "pm-badge-warning" : "pm-badge-info"}`}>
                  {variant === "danger" ? "Delete Action" : "Review"}
                </span>
              </div>
              <p>Confirmation & Security Review</p>
            </div>
          </div>
          <button className="pm-confirm-close-btn" onClick={onCancel} aria-label="Close" title="Close">
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className="pm-confirm-body">
          <div className="pm-confirm-warning-card">
            <div className="pm-confirm-warning-icon">
              <Icon name="shield" size={20} />
            </div>
            <div className="pm-confirm-warning-content">
              <h4>Deletion Notice</h4>
              <p>{message}</p>
              {entityName && (
                <div className="pm-confirm-target-chip">
                  <Icon name="tag" size={12} />
                  <span>{entityName}</span>
                </div>
              )}
            </div>
          </div>

          {details && details.length > 0 && (
            <div className="pm-confirm-section">
              <div className="pm-confirm-section-head">
                <Icon name="list" size={15} />
                <h3>Verification Summary</h3>
              </div>
              <div className="pm-confirm-details-grid">
                {details.map((d, i) =>
                  d.value !== undefined && d.value !== null && d.value !== "" ? (
                    <div key={i} className="pm-confirm-detail-item">
                      <span className="pm-confirm-detail-label">{d.label}</span>
                      <strong className="pm-confirm-detail-value">{String(d.value)}</strong>
                    </div>
                  ) : null
                )}
              </div>
            </div>
          )}

          <div className="pm-confirm-note">
            <Icon name="info" size={14} />
            <span>This action is logged for audit compliance and cannot be undone.</span>
          </div>

          {errorMessage && (
            <div className="pm-confirm-error-banner">
              <Icon name="close" size={16} />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        <footer className="pm-confirm-footer">
          {secondaryAction && (
            <button
              className={`pm-btn ${
                secondaryAction.variant === "primary"
                  ? "pm-btn-primary"
                  : secondaryAction.variant === "warning"
                  ? "pm-btn-warning"
                  : secondaryAction.variant === "danger"
                  ? "pm-btn-danger"
                  : "pm-btn-outline"
              }`}
              onClick={secondaryAction.onClick}
              disabled={isLoading}
            >
              {secondaryAction.label}
            </button>
          )}
          <button
            className={`pm-btn ${variant === "danger" ? "pm-btn-danger" : variant === "warning" ? "pm-btn-warning" : "pm-btn-primary"}`}
            onClick={onConfirm}
            disabled={isLoading}
          >
            {variant === "danger" && <Icon name="trash" size={14} />}
            {isLoading ? "Processing..." : confirmText}
          </button>
        </footer>
      </aside>
    </div>
  );
}


