import { create } from "zustand";
import { statusConfigApi } from "../services/statusConfigApi";
import type { StatusConfig, StatusConfigCreateInput, StatusConfigInput, StatusEntityType, StatusTone } from "../types/domain";

function key(entityType: string, value: string) {
  return `${entityType}:${value}`;
}

interface StatusConfigState {
  configs: StatusConfig[];
  loaded: boolean;
  loading: boolean;
  error: string | null;

  fetchAll: () => Promise<void>;
  createConfig: (input: StatusConfigCreateInput) => Promise<void>;
  updateConfig: (id: string, input: StatusConfigInput) => Promise<void>;
  removeConfig: (id: string) => Promise<void>;

  /** Display label for (entityType, value); falls back to the raw value if not configured yet. */
  getLabel: (entityType: StatusEntityType, value: string) => string;
  /** Badge tone for (entityType, value); falls back to "neutral" if not configured yet. */
  getTone: (entityType: StatusEntityType, value: string) => StatusTone;
  /** Whether this status is currently offered for new selection. Defaults to true (never hides an
   * option just because config hasn't loaded yet - only an explicit Enabled=false hides it). */
  isEnabled: (entityType: StatusEntityType, value: string) => boolean;
}

export const useStatusConfigStore = create<StatusConfigState>((set, get) => ({
  configs: [],
  loaded: false,
  loading: false,
  error: null,

  fetchAll: async () => {
    if (get().loaded || get().loading) return;
    set({ loading: true, error: null });
    try {
      const configs = await statusConfigApi.list();
      set({ configs, loaded: true, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  createConfig: async (input) => {
    const created = await statusConfigApi.create(input);
    set({ configs: [...get().configs, created] });
  },

  updateConfig: async (id, input) => {
    const updated = await statusConfigApi.update(id, input);
    set({ configs: get().configs.map((c) => (c.id === id ? updated : c)) });
  },

  removeConfig: async (id) => {
    await statusConfigApi.remove(id);
    set({ configs: get().configs.filter((c) => c.id !== id) });
  },

  getLabel: (entityType, value) => {
    const found = get().configs.find((c) => key(c.entityType, c.value) === key(entityType, value));
    return found?.label ?? value;
  },

  getTone: (entityType, value) => {
    const found = get().configs.find((c) => key(c.entityType, c.value) === key(entityType, value));
    return found?.color ?? "neutral";
  },

  isEnabled: (entityType, value) => {
    const found = get().configs.find((c) => key(c.entityType, c.value) === key(entityType, value));
    return found?.enabled ?? true;
  },
}));
