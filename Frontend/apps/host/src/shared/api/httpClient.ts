export class ApiError extends Error {
  status: number
  /** Field-level validation errors from ASP.NET ValidationProblemDetails `errors` dictionary. */
  errors: Record<string, string[]> | null
  /**
   * Any additional members the server attached to the ProblemDetails body beyond the standard
   * title/status/errors — ASP.NET serialises `ProblemDetails.Extensions` inline at the top level.
   *
   * Used today by the maker-checker duplicate-request refusal, which returns a `pendingRequest`
   * object describing the request that blocked this one (who raised it, which checker holds it,
   * since when) so the UI can explain the block instead of showing a bare "conflict".
   */
  extensions: Record<string, unknown>

  constructor(
    status: number,
    message: string,
    errors: Record<string, string[]> | null = null,
    extensions: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.errors = errors
    this.extensions = extensions
  }
}

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  accessToken?: string
  /** Internal: set when a call is already a post-refresh retry, so a second 401 cannot loop. */
  _isRetry?: boolean
}

/**
 * True when a rejection is a deliberate abort rather than a failure worth reporting.
 *
 * Anything that cancels a request — an effect cleanup, a component unmounting, a newer keystroke
 * superseding an older search — surfaces as a rejected promise indistinguishable in shape from a
 * network failure. Without this check every cancelled request would light up an error banner saying
 * something went wrong, when in fact the caller asked for exactly what happened.
 *
 * Covers `AbortSignal.timeout()` too, which rejects with a TimeoutError rather than an AbortError;
 * that is a genuine failure the caller usually DOES want to report, so it is deliberately not
 * included here.
 */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

/**
 * Hooks the auth layer into this module without importing it.
 *
 * httpClient is the lowest layer and is imported by every API client; authStore imports those
 * clients. Importing authStore here would close that cycle, so authStore registers its handlers at
 * startup instead.
 */
interface AuthHooks {
  /** Force a token refresh. Resolves with a fresh access token, or rejects if the session is gone. */
  refresh: () => Promise<string>
  /** Tear down the session and send the user to /login with a reason. */
  onSessionExpired: (reason: string) => void
}

let authHooks: AuthHooks | null = null

export function registerAuthHooks(hooks: AuthHooks) {
  authHooks = hooks
}

/** Deduped across concurrent 401s so ten parallel requests trigger exactly one refresh, not ten. */
let inFlightRefresh: Promise<string> | null = null

function refreshOnce(): Promise<string> {
  if (!authHooks) {
    return Promise.reject(new ApiError(401, 'Session expired.'))
  }
  inFlightRefresh ??= authHooks.refresh().finally(() => {
    inFlightRefresh = null
  })
  return inFlightRefresh
}

/**
 * Thin fetch wrapper shared by every API client (AuthService). Always sends
 * credentials so the httpOnly refresh cookie travels with same-site requests, JSON-encodes a
 * plain object body, and throws ApiError with the server's ProblemDetails title on non-2xx so
 * callers can branch on `.status` instead of re-parsing responses everywhere.
 *
 * On a 401 it transparently refreshes once and replays the request. Previously there was NO 401
 * handling anywhere in the app: leave a tab open past the access-token lifetime (or sleep the
 * laptop, which throttles the proactive refresh timer) and every subsequent read failed into a
 * generic "Could not load…" banner. The user was never redirected to /login and no amount of
 * clicking Refresh recovered it — only a full browser reload did, because that re-ran hydrate().
 */
export async function apiFetch<T>(url: string, options: ApiFetchOptions = {}): Promise<T> {
  const { body, accessToken, headers, _isRetry, ...rest } = options

  const response = await fetch(url, {
    ...rest,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (response.status === 401 && !_isRetry && accessToken && authHooks) {
    try {
      const freshToken = await refreshOnce()
      return await apiFetch<T>(url, { ...options, accessToken: freshToken, _isRetry: true })
    } catch {
      // The refresh token is gone or rejected — this session is genuinely over. Tear it down and
      // route to /login rather than surfacing an unrecoverable error banner on the current page.
      authHooks.onSessionExpired('Your session expired. Please sign in again.')
      throw new ApiError(401, 'Your session expired. Please sign in again.')
    }
  }

  if (!response.ok) {
    const { title, errors, extensions } = await readErrorBody(response)
    throw new ApiError(response.status, title, errors, extensions)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

/** RFC 7807 members ASP.NET always emits; anything else in the body is a ProblemDetails extension. */
const STANDARD_PROBLEM_MEMBERS = new Set(['type', 'title', 'status', 'detail', 'instance', 'errors', 'traceId'])

async function readErrorBody(
  response: Response,
): Promise<{ title: string; errors: Record<string, string[]> | null; extensions: Record<string, unknown> }> {
  try {
    const problem = (await response.json()) as Record<string, unknown> & {
      title?: string
      errors?: Record<string, string[]>
    }

    // Extensions are serialised inline alongside the standard members rather than under a nested
    // key, so they're recovered by subtracting the known ones.
    const extensions: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(problem)) {
      if (!STANDARD_PROBLEM_MEMBERS.has(key)) extensions[key] = value
    }

    return {
      title: problem.title ?? response.statusText,
      errors: problem.errors && Object.keys(problem.errors).length > 0 ? problem.errors : null,
      extensions,
    }
  } catch {
    return {
      title: response.statusText || `Request failed with status ${response.status}`,
      errors: null,
      extensions: {},
    }
  }
}
