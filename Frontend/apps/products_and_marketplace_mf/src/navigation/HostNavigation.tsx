import { createContext, useContext } from 'react';

export type NavigateToPage = (page: string) => void;

const HostNavigationContext = createContext<NavigateToPage | undefined>(undefined);

export const HostNavigationProvider = HostNavigationContext.Provider;

export function useHostNavigate(): NavigateToPage {
  return useContext(HostNavigationContext) ?? (() => {});
}
