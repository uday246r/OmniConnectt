import { downloadCsv, type CsvDownloadResult } from '@omniremit/ui'
import { forceRefreshAccessToken } from './httpClient'

/**
 * Downloads a CSV from an AuthService export endpoint.
 *
 * @remarks
 * A three-line adapter over the shared helper, and the three lines are the whole point: they wire
 * the host's own token source into it, including the deduped refresh that a raw `fetch` would
 * otherwise bypass. Both of the host's exports previously hand-rolled this and neither refreshed, so
 * exporting on a token that had just expired failed while every other request on the page recovered.
 */
export function hostDownloadCsv(
  url: string,
  accessToken: string | null,
  filename?: string,
  signal?: AbortSignal,
): Promise<CsvDownloadResult> {
  return downloadCsv({
    url,
    filename,
    signal,
    getAccessToken: (forceRefresh) =>
      forceRefresh ? forceRefreshAccessToken() : Promise.resolve(accessToken),
  })
}

/**
 * Builds a query string from a filter object, skipping absent and empty values.
 *
 * Duplicated in three API modules before this; kept here because every export now needs it and the
 * three copies had already begun to differ in whether they skipped empty strings.
 */
export function buildExportQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value))
    }
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}
