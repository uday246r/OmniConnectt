import React, { createContext, useContext } from 'react';

/**
 * How this remote asks the host to navigate.
 *
 * In-app links (a customer row, a product card) used to call setActivePage on this remote's own
 * store, which changed the page without changing the URL — so the address bar always read /apps/lead
 * whatever you were looking at, and a refresh went back to the dashboard.
 *
 * The host now owns routing, so those links hand it a page name and it navigates. The remote still
 * never reads or constructs a URL: it says where it wants to go, not how the host should get there.
 */
export type NavigateToPage = (page: string) => void;

const HostNavigationContext = createContext<NavigateToPage | undefined>(undefined);

export const HostNavigationProvider = HostNavigationContext.Provider;

/**
 * Returns a navigate function. Falls back to a no-op when the remote is rendered standalone
 * (`vite preview`, a preview deployment) rather than throwing — a dead button is a much better
 * standalone experience than a blank screen.
 */
export function useHostNavigate(): NavigateToPage {
  return useContext(HostNavigationContext) ?? (() => {});
}
