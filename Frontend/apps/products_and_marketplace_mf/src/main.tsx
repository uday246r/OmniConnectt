import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

/*
 * Standalone entry, for previewing screens on this remote's own dev server.
 *
 * The real entry point is `./App` loaded by the host through Module Federation, which supplies the
 * signed-in session, the sidebar and the page to show. There is deliberately no fake login or fake
 * user here: the API refuses every call without a platform token, so screens rendered standalone show
 * their empty and error states — which is exactly what they should do outside the platform.
 *
 * `?page=` picks the screen, and it is read again on back/forward (and on a `popstate` dispatched by
 * hand), so one tab can move between screens without a reload — the same behaviour as lead_mf's
 * standalone entry.
 */
const readPage = () => new URLSearchParams(window.location.search).get('page') ?? undefined;

function Standalone() {
  const [page, setPage] = useState(readPage);

  useEffect(() => {
    const onPop = () => setPage(readPage());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return <App page={page} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Standalone />
  </StrictMode>,
);
