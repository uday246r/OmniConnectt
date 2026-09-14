/*
 * One CSV download for the whole platform.
 *
 * There were four before, and each was wrong in a different way. The host's two bypassed the shared
 * fetch wrapper — deliberately, because that wrapper always parses JSON — and in doing so lost its
 * 401-refresh-and-retry, so exporting on a token that had just expired failed with a bare error
 * instead of refreshing. The two remotes did not call a server at all: they serialised whatever rows
 * were on screen and saved the file under a name claiming to be the whole log.
 *
 * All four also had the same silent flaw, which the servers have now fixed and this half surfaces: a
 * capped export returned a partial file with a 200 and a filename, and nothing told the operator
 * that anything was missing.
 */

export class CsvExportError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'CsvExportError'
    this.status = status
  }
}

export interface CsvDownloadRequest {
  url: string
  /**
   * Resolves a bearer token. Called once with `false`; called a second time with `true` only after a
   * 401, which is the caller's cue to force a refresh.
   *
   * A provider rather than a token because the three apps get theirs differently — the host from its
   * auth store, the remotes through the host bridge — and this package cannot import any of them
   * without inverting the dependency.
   */
  getAccessToken: (forceRefresh: boolean) => Promise<string | null>
  /** Used only when the server sends no `Content-Disposition`. */
  filename?: string
  signal?: AbortSignal
}

export interface CsvDownloadResult {
  filename: string
  /** Rows actually written, from `X-Export-Row-Count`. */
  rowCount: number | null
  /** Rows that MATCHED. Larger than `rowCount` when the export hit its cap. */
  matchCount: number | null
  truncated: boolean
  /** The server's cap, so a message can say what it was. */
  rowLimit: number | null
}

const ROW_COUNT_HEADER = 'X-Export-Row-Count'
const MATCH_COUNT_HEADER = 'X-Export-Match-Count'
const ROW_LIMIT_HEADER = 'X-Export-Row-Limit'
const TRUNCATED_HEADER = 'X-Export-Truncated'

/**
 * Fetches a CSV, saves it, and reports what the server left out.
 *
 * @remarks
 * The truncation headers are invisible to `fetch` unless the server lists them in its CORS
 * `WithExposedHeaders`. Every service that serves an export does; if one is ever added that does
 * not, the download still works and `truncated` silently reads `false` — which is the original bug
 * with extra steps, so it is worth knowing that is the failure mode.
 */
export async function downloadCsv(request: CsvDownloadRequest): Promise<CsvDownloadResult> {
  const { url, getAccessToken, filename, signal } = request

  let response = await send(await getAccessToken(false))

  /*
   * Refresh once on a 401, then replay — the behaviour the shared JSON wrapper has always had and
   * these downloads never did. Exactly once: a second 401 after a fresh token means the caller is
   * genuinely not allowed, and retrying again would loop.
   */
  if (response.status === 401) {
    response = await send(await getAccessToken(true))
  }

  if (!response.ok) {
    throw new CsvExportError(response.status, await describeFailure(response))
  }

  const blob = await response.blob()
  const resolvedName = filenameFrom(response) ?? filename ?? 'export.csv'
  save(blob, resolvedName)

  const matchCount = numberFrom(response, MATCH_COUNT_HEADER)
  const rowCount = numberFrom(response, ROW_COUNT_HEADER)

  return {
    filename: resolvedName,
    rowCount,
    matchCount,
    rowLimit: numberFrom(response, ROW_LIMIT_HEADER),
    // Prefer the server's own verdict; fall back to comparing the counts, so an older service that
    // reports counts but not the flag still produces a correct warning.
    truncated:
      response.headers.get(TRUNCATED_HEADER) === 'true' ||
      (matchCount !== null && rowCount !== null && matchCount > rowCount),
  }

  function send(token: string | null) {
    return fetch(url, {
      // Carries the httpOnly refresh cookie, matching every other call the platform makes.
      credentials: 'include',
      headers: {
        Accept: 'text/csv',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal,
    })
  }
}

/**
 * A sentence an operator can act on, for a truncated export — naming the cap and what to do about
 * it, rather than only reporting a number.
 */
export function describeTruncation(result: CsvDownloadResult): string | null {
  if (!result.truncated) return null

  const written = result.rowCount?.toLocaleString() ?? 'some'
  const matched = result.matchCount?.toLocaleString() ?? 'more'
  return `Exported the newest ${written} of ${matched} matching rows. Narrow the date range to export the rest.`
}

async function describeFailure(response: Response): Promise<string> {
  try {
    const problem = (await response.json()) as { title?: string; detail?: string }
    return problem.title ?? problem.detail ?? response.statusText
  } catch {
    // Not JSON — an HTML error page from a proxy, or an empty body.
    return response.statusText || `Request failed with status ${response.status}`
  }
}

function numberFrom(response: Response, header: string): number | null {
  const raw = response.headers.get(header)
  if (raw === null) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function filenameFrom(response: Response): string | null {
  const disposition = response.headers.get('Content-Disposition')
  if (!disposition) return null
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)
  return match ? decodeURIComponent(match[1]) : null
}

function save(blob: Blob, filename: string) {
  // Guarded so a server-rendered or test environment gets the result object without crashing on a
  // missing document.
  if (typeof document === 'undefined') return

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
