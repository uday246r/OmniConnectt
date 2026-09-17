import { useToastStore, type ToastType } from "../../stores/useToastStore";
import { Icon, type IconName } from "./Icon";
import { useShallow } from "zustand/react/shallow";
import "./ToastContainer.css";

const ICON_MAP: Record<ToastType, IconName> = {
  success: "check",
  danger: "trash",
  warning: "info",
  info: "info",
};

export function ToastContainer() {
  const { toasts, dismissToast } = useToastStore(useShallow((s) => ({ toasts: s.toasts, dismissToast: s.dismissToast })));

  if (toasts.length === 0) return null;

  return (
    <div className="pm-toast-container" role="region" aria-label="Notifications">
      {toasts.map((toast) => (
        <div key={toast.id} className={`pm-toast-item ${toast.type}`}>
          <div className="pm-toast-icon-wrap">
            <Icon name={ICON_MAP[toast.type]} size={18} />
          </div>
          <div className="pm-toast-content">
            <h4 className="pm-toast-title">{toast.title}</h4>
            {toast.message && <p className="pm-toast-message">{toast.message}</p>}
          </div>
          <button className="pm-toast-close" onClick={() => dismissToast(toast.id)} aria-label="Dismiss notification">
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
