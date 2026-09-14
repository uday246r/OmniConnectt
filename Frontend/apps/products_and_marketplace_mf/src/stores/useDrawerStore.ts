import { create } from "zustand";

export type DrawerType =
  | "product-details"
  | "product-form"
  | "apply-now"
  | "application-details"
  | "category-form"
  | "category-details"
  | "promotion-form"
  | "promotion-details"
  | "audit-log-details"
  | "product-type-form"
  | "product-type-details"
  | "field-form"
  | "field-details"
  | "document-form"
  | "document-details"
  | "status-config-form"
  | "status-config-details"
  | "employment-type-form"
  | "employment-type-details";

export interface DrawerState {
  isOpen: boolean;
  type: DrawerType | null;
  payload: Record<string, unknown> | null;
  open: (type: DrawerType, payload?: Record<string, unknown>) => void;
  close: () => void;
}

export const useDrawerStore = create<DrawerState>((set) => ({
  isOpen: false,
  type: null,
  payload: null,
  open: (type, payload) => set({ isOpen: true, type, payload: payload ?? null }),
  close: () => set({ isOpen: false, type: null, payload: null }),
}));
