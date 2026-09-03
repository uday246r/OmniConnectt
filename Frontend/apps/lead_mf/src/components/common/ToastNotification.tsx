import React, { useEffect } from 'react';
import { X, CheckCircle2, AlertTriangle, AlertCircle, Info } from '@omniremit/ui/icons';
import { useLeadStore } from '../../store/useLeadStore';
import styles from './ToastNotification.module.css';

export const ToastNotification: React.FC = () => {
  const { toast, hideToast } = useLeadStore();

  useEffect(() => {
    if (toast?.show) {
      const timer = setTimeout(() => {
        hideToast();
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [toast, hideToast]);

  if (!toast || !toast.show) return null;

  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return <CheckCircle2 size={20} className={styles.iconSuccess} />;
      case 'warning':
        return <AlertTriangle size={20} className={styles.iconWarning} />;
      case 'error':
        return <AlertCircle size={20} className={styles.iconError} />;
      default:
        return <Info size={20} className={styles.iconInfo} />;
    }
  };

  const getBorderColor = () => {
    switch (toast.type) {
      case 'success':
        return '#bbf7d0';
      case 'warning':
        return '#fef08a';
      case 'error':
        return '#fecaca';
      default:
        return '#bfdbfe';
    }
  };

  const getBgColor = () => {
    switch (toast.type) {
      case 'success':
        return '#f0fdf4';
      case 'warning':
        return '#fffbeb';
      case 'error':
        return '#fef2f2';
      default:
        return '#eff6ff';
    }
  };

  return (
    <div
      className={styles.toastRoot}
      style={{ '--toast-bg': getBgColor(), '--toast-border': getBorderColor() } as React.CSSProperties}
    >
      {getIcon()}

      <div className={styles.body}>
        <div className={styles.title}>
          {toast.title}
        </div>
        {toast.message && (
          <div className={styles.message}>
            {toast.message}
          </div>
        )}
        {toast.errorsList && toast.errorsList.length > 0 && (
          <ul className={styles.detailList}>
            {toast.errorsList.map((err, idx) => (
              <li key={idx} className={styles.titleTight}>
                {err}
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        onClick={hideToast}
        className={styles.dismissBtn}
        aria-label="Close notification"
      >
        <X size={16} />
      </button>
    </div>
  );
};
