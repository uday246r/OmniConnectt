import { Button, DetailField, DetailGrid, Modal } from "@omniremit/ui";
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

/**
 * A confirmation on the platform `Modal`.
 *
 * This was a 140-line bespoke dialog with 340 lines of CSS styled as a side drawer, which offered no
 * Cancel button (only a corner ×), and headed every confirmation "Deletion Notice" even when the
 * action was not a deletion. It keeps its props — eight call sites use it — but renders the shared
 * dialog and buttons, shows an explicit Cancel, and words its notice by what the action is.
 *
 * Details with no value are left out rather than printed empty (the shared `DetailField` rule).
 */
export function ConfirmModal({
  isOpen,
  title,
  message,
  entityName,
  details,
  confirmText = "Delete",
  cancelText = "Cancel",
  variant = "danger",
  isLoading = false,
  errorMessage = null,
  secondaryAction,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const visibleDetails = (details ?? []).filter((d) => d.value !== undefined && d.value !== null && d.value !== "");
  const secondaryVariant = secondaryAction?.variant === "danger" ? "danger" : secondaryAction?.variant === "primary" ? "primary" : "secondary";

  return (
    <Modal
      open={isOpen}
      title={title}
      onClose={() => {
        if (!isLoading) onCancel();
      }}
      actions={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={isLoading}>
            {cancelText}
          </Button>
          {secondaryAction && (
            <Button variant={secondaryVariant} onClick={secondaryAction.onClick} disabled={isLoading}>
              {secondaryAction.label}
            </Button>
          )}
          <Button
            variant={variant === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={isLoading}
            leadingIcon={variant === "danger" ? <Icon name="trash" size={14} /> : undefined}
          >
            {isLoading ? "Processing..." : confirmText}
          </Button>
        </>
      }
    >
      <div className="pm-confirm-body">
        <div className={`pm-confirm-notice pm-confirm-notice-${variant}`}>
          <Icon name={variant === "danger" ? "trash" : "info"} size={18} />
          <div>
            <p className="pm-confirm-message">{message}</p>
            {entityName && <p className="pm-confirm-target">{entityName}</p>}
          </div>
        </div>

        {visibleDetails.length > 0 && (
          <DetailGrid>
            {visibleDetails.map((d) => (
              <DetailField key={d.label} label={d.label}>
                {String(d.value)}
              </DetailField>
            ))}
          </DetailGrid>
        )}

        {variant === "danger" && <p className="pm-confirm-note">This action is recorded in the audit log and cannot be undone.</p>}

        {errorMessage && (
          <div className="pm-confirm-error" role="alert">
            {errorMessage}
          </div>
        )}
      </div>
    </Modal>
  );
}
