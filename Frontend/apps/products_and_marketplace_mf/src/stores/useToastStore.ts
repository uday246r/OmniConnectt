import { create } from "zustand";

export type ToastType = "success" | "danger" | "warning" | "info";

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastState {
  toasts: ToastItem[];
  showToast: (toast: Omit<ToastItem, "id">) => void;
  success: (title: string, message?: string) => void;
  danger: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  dismissToast: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  showToast: (toast) => {
    const id = Math.random().toString(36).substring(2, 9);
    const newToast: ToastItem = { id, duration: 4000, ...toast };
    set((state) => ({ toasts: [...state.toasts, newToast] }));

    if (newToast.duration && newToast.duration > 0) {
      setTimeout(() => {
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
      }, newToast.duration);
    }
  },
  success: (title, message) => {
    useToastStore.getState().showToast({ type: "success", title, message });
  },
  danger: (title, message) => {
    useToastStore.getState().showToast({ type: "danger", title, message });
  },
  warning: (title, message) => {
    useToastStore.getState().showToast({ type: "warning", title, message });
  },
  info: (title, message) => {
    useToastStore.getState().showToast({ type: "info", title, message });
  },
  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));
