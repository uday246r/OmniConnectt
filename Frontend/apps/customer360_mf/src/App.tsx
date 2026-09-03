import React from 'react';
import { MainLayout } from './components/layout/MainLayout';
import { HostNavigationProvider, type NavigateToPage } from './navigation/HostNavigation';
// Standalone fallback tokens. Imported BEFORE this app's own stylesheet so index.css's aliases
// (--brand-primary: var(--omni-color-primary-600, ...)) resolve against real values when the remote
// runs outside the host — `vite preview`, a Vercel preview URL, or any standalone render. Inside the
// host shell this file is inert: it is wrapped in a cascade layer, and the host's unlayered :root
// always wins, so the host stays the single source of truth for the live theme.
import '@omniremit/ui/tokens.css';
import './index.css';

export interface Customer360AppProps {
  /**
   * Which page to render. The host resolves this from the URL
   * (/apps/customer360/audit-logs → "audit-logs") and passes it in, which is what makes those URLs
   * refresh-safe and linkable.
   *
   * This remote deliberately does not read the URL itself — that would couple it to the host's route
   * shape and leave navigation state owned in two places.
   */
  page?: string;

  /** Lets in-app links ask the host to navigate, so the URL always matches what is on screen. */
  onNavigate?: NavigateToPage;
}

export const App: React.FC<Customer360AppProps> = ({ page, onNavigate }) => {
  return (
    <HostNavigationProvider value={onNavigate ?? (() => {})}>
      <div id="customer360-mf-scope">
        <MainLayout page={page} />
      </div>
    </HostNavigationProvider>
  );
};

export default App;
