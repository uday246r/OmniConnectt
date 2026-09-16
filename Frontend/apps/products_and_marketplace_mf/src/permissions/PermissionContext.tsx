import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { hasCapability } from '../api/hostBridge';
import { parsePermission, type PermissionKey } from './permissions';

export interface PermissionContextValue {
  /** Whether the signed-in user holds this permission. */
  has: (permission: PermissionKey) => boolean;
  hasAll: (permissions: PermissionKey[]) => boolean;
  hasAny: (permissions: PermissionKey[]) => boolean;
}

/**
 * Answers from the host bridge — the signed-in user's real permissions.
 *
 * The default value is that same answer, so a component rendered without the provider (a test, a
 * storybook-style preview) still asks the host rather than silently granting everything.
 */
const fromHost: PermissionContextValue = {
  has: (permission) => {
    const { module, capability } = parsePermission(permission);
    return hasCapability(module, capability);
  },
  hasAll: (permissions) => permissions.every((p) => fromHost.has(p)),
  hasAny: (permissions) => permissions.some((p) => fromHost.has(p)),
};

const PermissionContext = createContext<PermissionContextValue>(fromHost);

export function PlatformPermissionProvider({ children }: { children: ReactNode }) {
  const value = useMemo(() => fromHost, []);
  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

/** A fixed grant set, for tests only. */
export function FixedPermissionProvider({ children, granted }: { children: ReactNode; granted: PermissionKey[] }) {
  const value = useMemo<PermissionContextValue>(() => {
    const set = new Set<string>(granted);
    return {
      has: (p) => set.has(p),
      hasAll: (ps) => ps.every((p) => set.has(p)),
      hasAny: (ps) => ps.some((p) => set.has(p)),
    };
  }, [granted]);
  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

export function usePermissions(): PermissionContextValue {
  return useContext(PermissionContext);
}
