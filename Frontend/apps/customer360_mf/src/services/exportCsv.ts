import { downloadCsv, type CsvDownloadResult } from '@omniconnect/ui';
import { getAccessToken, ensureFreshAccessToken, isRunningInHost } from '../api/hostBridge';

/**
 * Downloads a CSV from a Customer360Service export endpoint.
 *
 * @remarks
 * The remote gets its token from the host bridge rather than from a store of its own, which is the
 * only reason this adapter exists — the shared helper takes a token provider precisely so the three
 * apps can supply theirs differently without the shared package knowing about any of them.
 *
 * A useful side effect: the remotes now get refresh-and-retry on export, which they never had. Their
 * JSON client refreshed on a 401; their CSV export was assembled in the browser and never issued a
 * request at all, so the question had not come up.
 */
export function remoteDownloadCsv(
  url: string,
  filename?: string,
  signal?: AbortSignal,
): Promise<CsvDownloadResult> {
  return downloadCsv({
    url,
    filename,
    signal,
    getAccessToken: async (forceRefresh) => {
      // Standalone (a remote's own `vite preview`) there is no bridge and no refresh to ask for.
      if (forceRefresh && isRunningInHost()) {
        return ensureFreshAccessToken();
      }
      return getAccessToken();
    },
  });
}
