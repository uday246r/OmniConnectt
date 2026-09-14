/**
 * Current-user seam for this remote.
 *
 * This module never authenticates anyone - the Host App owns identity, roles and permissions. It
 * exists so every consumer (the shell header, the actor headers sent with each mutation) reads the
 * user from ONE place, and integration becomes a single call to `setCurrentUser` from the Host App
 * rather than a hunt for hardcoded names across the UI.
 *
 * Until the Host App injects a real user, a clearly-labelled development identity is used, and only
 * in development builds. See the backend's HttpAuditContext for the matching server-side rule: the
 * actor headers this identity produces are trusted only in development, and an authenticated Host
 * principal always takes precedence over them.
 */
export interface CurrentUser {
  name: string;
  email: string;
}

/** The identity used when the app runs standalone, outside the Host App. */
const developmentUser: CurrentUser = {
  name: "Super Admin",
  email: "admin@omniconnect.bank",
};

let injectedUser: CurrentUser | null = null;

/**
 * Called by the Host App during mount to hand this remote the authenticated user.
 * Passing null clears it and falls back to the development identity.
 */
export function setCurrentUser(user: CurrentUser | null): void {
  injectedUser = user;
}

export function getCurrentUser(): CurrentUser {
  return injectedUser ?? developmentUser;
}

/**
 * Whether the identity in use is a real Host-App-supplied one rather than the development fallback.
 * Useful for hiding or flagging identity-dependent affordances before integration.
 */
export function hasHostIdentity(): boolean {
  return injectedUser !== null;
}

/**
 * @deprecated Kept so existing imports keep working; prefer `getCurrentUser()`, which reflects a
 * Host-App-supplied identity once one has been set.
 */
export const mockCurrentUser: CurrentUser = developmentUser;
