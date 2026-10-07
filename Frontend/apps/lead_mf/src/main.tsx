import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

/**
 * Standalone dev entry. Never part of the Module Federation surface — the host imports `./App`
 * directly and supplies `page`/`onNavigate` itself — so nothing here ships to production.
 *
 * It reads `?page=` and writes it back on navigation purely so a page other than the dashboard can
 * be opened at :5002 without a host session. Without it, every in-app link is a no-op here and the
 * only reachable screen is whichever one App defaults to.
 */
function Standalone() {
  const [page, setPage] = React.useState(
    () => new URLSearchParams(window.location.search).get('page') ?? undefined,
  );

  // Back/forward should move between pages, not leave the URL and the screen disagreeing.
  React.useEffect(() => {
    const onPop = () => setPage(new URLSearchParams(window.location.search).get('page') ?? undefined);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = React.useCallback((target: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('page', target);
    window.history.pushState({}, '', url);
    setPage(target);
  }, []);

  return <App page={page} onNavigate={navigate} />;
}

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <Standalone />
    </React.StrictMode>
  );
}
