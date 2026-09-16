import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

/*
 * Standalone entry, for previewing screens on this remote's own dev server.
 *
 * The real entry point is `./App` loaded by the host through Module Federation, which supplies the
 * signed-in session, the sidebar and the page to show. There is deliberately no fake login or fake
 * user here: the API refuses every call without a platform token, so screens rendered standalone show
 * their empty and error states — which is exactly what they should do outside the platform.
 */
const page = new URLSearchParams(window.location.search).get('page') ?? undefined;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App page={page} />
  </StrictMode>,
);
