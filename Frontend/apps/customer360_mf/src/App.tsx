import React from 'react';
import { MainLayout } from './components/layout/MainLayout';
// Standalone fallback tokens. Imported BEFORE this app's own stylesheet so index.css's aliases
// (--brand-primary: var(--omni-color-primary-600, ...)) resolve against real values when the remote
// runs outside the host — `vite preview`, a Vercel preview URL, or any standalone render. Inside the
// host shell this file is inert: it is wrapped in a cascade layer, and the host's unlayered :root
// always wins, so the host stays the single source of truth for the live theme.
import '@omniremit/ui/tokens.css';
import './index.css';

export const App: React.FC = () => {
  return (
    <div id="customer360-mf-scope">
      <MainLayout />
    </div>
  );
};

export default App;
