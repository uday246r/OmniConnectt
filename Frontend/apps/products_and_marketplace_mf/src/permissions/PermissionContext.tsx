import { createContext, useContext, useMemo, type ReactNode } from "react";
import { ALL_PERMISSIONS, type PermissionKey } from "./permissions";

export interface PermissionContextValue {
  /** Returns true if the current user/session has the given permission. */
  has: (permission: PermissionKey) => boolean;
  /** Returns true if the current user/session has every permission listed. */
  hasAll: (permissions: PermissionKey[]) => boolean;
  /** Returns true if the current user/session has at least one of the permissions listed. */
  hasAny: (permissions: PermissionKey[]) => boolean;
}

const PermissionContext = createContext<PermissionContextValue | null>(null);

/**
 * Standalone/local-dev permission provider. Grants a fixed permission set so every
 * marketplace feature can be built and tested before the Host App is wired up.
 * The Host App will later mount its own provider (same PermissionContextValue shape)
 * higher in the tree, sourced from the logged-in user's real roles/permissions -
 * no change to consuming components will be required.
 */
export function MockPermissionProvider({ children, granted = ALL_PERMISSIONS }: { children: ReactNode; granted?: PermissionKey[] }) {
  const value = useMemo<PermissionContextValue>(() => {
    const grantedSet = new Set(granted);
    return {
      has: (permission) => grantedSet.has(permission),
      hasAll: (permissions) => permissions.every((p) => grantedSet.has(p)),
      hasAny: (permissions) => permissions.some((p) => grantedSet.has(p)),
    };
  }, [granted]);

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

export function usePermissions(): PermissionContextValue {
  const ctx = useContext(PermissionContext);
  if (!ctx) throw new Error("usePermissions must be used within a PermissionProvider (see MockPermissionProvider).");
  return ctx;
}
