import { Icon } from '@omniconnect/ui';
import { useToastStore, type ToastType } from '../stores/useToastStore';
import styles from './Toasts.module.css';

const GLYPHS: Record<ToastType, typeof Icon.Info> = {
  success: Icon.CheckCircle,
  danger: Icon.AlertCircle,
  warning: Icon.AlertTriangle,
  info: Icon.Info,
};

/** Transient messages: what just happened, or who has to approve it. Announced politely, never trapping focus. */
export function Toasts() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismissToast);

  return (
    <div className={styles.region} role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((toast) => {
        const Glyph = GLYPHS[toast.type];
        return (
          <div key={toast.id} className={`${styles.toast} ${styles[toast.type]}`} role={toast.type === 'danger' ? 'alert' : 'status'}>
            <Glyph className={styles.glyph} />
            <div className={styles.text}>
              <strong>{toast.title}</strong>
              {toast.message && <span>{toast.message}</span>}
            </div>
            <button type="button" className={styles.close} aria-label={`Dismiss: ${toast.title}`} onClick={() => dismiss(toast.id)}>
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
