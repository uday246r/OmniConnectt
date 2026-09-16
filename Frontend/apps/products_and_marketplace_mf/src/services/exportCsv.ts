import { downloadCsv, type CsvDownloadResult } from '@omniremit/ui';
import { ensureFreshAccessToken, getAccessToken, isRunningInHost } from '../api/hostBridge';
import { API_BASE_URL } from './httpClient';

/**
 * Downloads a CSV that the server builds from the filters on screen.
 *
 * Both exports in this remote used to be assembled in the browser from the one page of rows already
 * loaded, and saved under a name ("audit-logs.csv", "products.csv") that claimed to be the whole list.
 * The server now builds the file from every matching row, records the download in the audit trail, and
 * says when the file had to be capped.
 */
export function downloadServerCsv(
  path: string,
  params: Record<string, string | number | undefined | null>,
  filename: string,
): Promise<CsvDownloadResult> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.append(key, String(value));
  }

  return downloadCsv({
    url: `${API_BASE_URL}${path}${query.size ? `?${query}` : ''}`,
    filename,
    getAccessToken: async (forceRefresh) =>
      forceRefresh && isRunningInHost() ? ensureFreshAccessToken() : getAccessToken(),
  });
}
