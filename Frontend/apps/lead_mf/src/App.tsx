import React from 'react';
import { MainLayout } from './components/layout/MainLayout';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { HostNavigationProvider, type NavigateToPage } from './navigation/HostNavigation';
// Standalone fallback tokens. Imported BEFORE this app's own stylesheet so index.css's aliases
// (--brand-primary: var(--omni-color-primary-600, ...)) resolve against real values when the remote
// runs outside the host — `vite preview`, a Vercel preview URL, or any standalone render. Inside the
// host shell this file is inert: it is wrapped in a cascade layer, and the host's unlayered :root
// always wins, so the host stays the single source of truth for the live theme.
import '@omniremit/ui/tokens.css';
import './index.css';

export interface LeadAppProps {
  /**
   * Which page to render. The host resolves this from the URL (/apps/lead/view-lead → "view-lead")
   * and passes it in, which is what makes those URLs refresh-safe and linkable.
   *
   * This remote deliberately does not read the URL itself. Doing so would couple it to the host's
   * route shape and leave navigation state owned in two places — the arrangement that produced a
   * sidebar neither app fully controlled.
   */
  page?: string;

  /** Lets in-app links ask the host to navigate, so the URL always matches what is on screen. */
  onNavigate?: NavigateToPage;
}

export const App: React.FC<LeadAppProps> = ({ page, onNavigate }) => {
  return (
    <ErrorBoundary>
      <HostNavigationProvider value={onNavigate ?? (() => {})}>
        <div id="lead-mf-scope">
          <MainLayout page={page} />
        </div>
      </HostNavigationProvider>
    </ErrorBoundary>
  );
};

export default App;
