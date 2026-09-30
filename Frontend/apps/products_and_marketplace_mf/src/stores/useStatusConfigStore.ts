import { useMemo } from 'react';
import { create } from 'zustand';
import { statusConfigApi } from '../services/statusConfigApi';
import type { StatusConfig, StatusConfigCreateInput, StatusConfigInput, StatusEntityType, StatusTone } from '../types/domain';

const keyOf = (entityType: string, value: string) => `${entityType}:${value}`;

const indexOf = (configs: StatusConfig[]) => Object.fromEntries(configs.map((c) => [keyOf(c.entityType, c.value), c]));

interface StatusConfigState {
  configs: StatusConfig[];
  /** The same rows keyed by "EntityType:Value", so one badge subscribes to one row and not to the whole list. */
  byKey: Record<string, StatusConfig>;
  loaded: boolean;
  loading: boolean;
  error: string | null;

  fetchAll: (options?: { force?: boolean }) => Promise<void>;
  createConfig: (input: StatusConfigCreateInput) => Promise<void>;
  updateConfig: (id: string, input: StatusConfigInput) => Promise<void>;
  removeConfig: (id: string) => Promise<void>;
}

/**
 * The statuses defined in Setup: their labels, colours, and which of them make a record live.
 *
 * This store is the only place the app learns what a status means. It never compares a status to a
 * literal, because which values exist, what they are called and which count as live are all
 * administrator decisions, changeable without a deployment.
 */
export const useStatusConfigStore = create<StatusConfigState>((set, get) => ({
  configs: [],
  byKey: {},
  loaded: false,
  loading: false,
  error: null,

  fetchAll: async ({ force = false } = {}) => {
    if (!force && (get().loaded || get().loading)) return;
    set({ loading: true, error: null });
    try {
      const configs = await statusConfigApi.list();
      set({ configs, byKey: indexOf(configs), loaded: true, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  createConfig: async (input) => {
    const created = await statusConfigApi.create(input);
    const configs = [...get().configs, created];
    set({ configs, byKey: indexOf(configs) });
  },

  updateConfig: async (id, input) => {
    const updated = await statusConfigApi.update(id, input);
    const configs = get().configs.map((c) => (c.id === id ? updated : c));
    set({ configs, byKey: indexOf(configs) });
  },

  removeConfig: async (id) => {
    await statusConfigApi.remove(id);
    const configs = get().configs.filter((c) => c.id !== id);
    set({ configs, byKey: indexOf(configs) });
  },
}));

export interface ResolvedStatus {
  /** What Setup calls it — or the raw value until Setup has loaded, or if the row is gone. */
  label: string;
  tone: StatusTone;
  /** Whether a record holding it is live. False while unknown: an unrecognised status is never assumed to show. */
  isLive: boolean;
  known: boolean;
}

const UNKNOWN_TONE: StatusTone = 'neutral';

/** How to draw a status, and what it means. Re-renders only when this one status changes in Setup. */
export function useStatus(entityType: StatusEntityType, value: string): ResolvedStatus {
  const config = useStatusConfigStore((s) => s.byKey[keyOf(entityType, value)]);
  return config
    ? { label: config.label, tone: config.color, isLive: config.isLive, known: true }
    : { label: value, tone: UNKNOWN_TONE, isLive: false, known: false };
}

/** The statuses of one kind of record that can still be chosen, in Setup's order — for a select. */
export function useStatusOptions(entityType: StatusEntityType, { includeDisabled = false } = {}): StatusConfig[] {
  const configs = useStatusConfigStore((s) => s.configs);
  return useMemo(
    () => configs.filter((c) => c.entityType === entityType && (includeDisabled || c.enabled)).sort((a, b) => a.sortOrder - b.sortOrder),
    [configs, entityType, includeDisabled],
  );
}

/** The kinds of record that have statuses, in the order the server lists them — for Setup's tabs. */
export function useStatusEntityTypes(): StatusEntityType[] {
  const configs = useStatusConfigStore((s) => s.configs);
  return useMemo(() => [...new Set(configs.map((c) => c.entityType))], [configs]);
}
