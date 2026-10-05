import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { createRequestCache } from '@omniconnect/ui';
import { ensureFreshAccessToken, getAccessToken, getCurrentUser, isRunningInHost } from '../api/hostBridge';
import { useToastStore } from '../stores/useToastStore';

export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5266/api';
export const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, '');

export const httpClient = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

/*
 * Every GET goes through one request cache (@omniconnect/ui createRequestCache), installed as the
 * request adapter so no store or page has to change.
 *
 * Several screens asked for the same data at once — the Setup page and its default tab both loaded
 * product types, and StrictMode mounts every effect twice — so each of those requests went out two to
 * four times and queued behind the browser's six connections per origin. Identical GETs now share one
 * request and a success is reused briefly; any write clears the cache so the next read is fresh. Errors
 * reject in the underlying adapter and are therefore never cached. Each caller gets its own copy of the
 * data, so a store that mutates what it received cannot change another caller's result.
 */
const readCache = createRequestCache({ ttlMs: 30_000 });
const REFERENCE_DATA_TTL_MS = 5 * 60_000;
const REFERENCE_DATA = /\/(categories|document-definitions|status-configs)(\?|$)/;
const networkAdapter = axios.getAdapter(httpClient.defaults.adapter);


httpClient.defaults.adapter = async (config) => {
  const method = (config.method ?? 'get').toLowerCase();
  if (method !== 'get') {
    try {
      return await networkAdapter(config);
    } finally {
      // A write changes what the reads would return; nothing cached before it can be trusted after it.
      readCache.clear();
    }
  }

  const url = httpClient.getUri(config);
  // Keyed per user, so a different sign-in in the same tab never reads the previous user's results.
  const key = `${getCurrentUser()?.id ?? 'anonymous'} GET ${url}`;
  const { signal } = config;
  // The shared request must not carry one caller's abort signal, or cancelling one would cancel all.
  const shared = readCache.get(key, () => networkAdapter({ ...config, signal: undefined }), {
    ttlMs: REFERENCE_DATA.test(url) ? REFERENCE_DATA_TTL_MS : undefined,
  });

  const response = await (signal
    ? Promise.race([
        shared,
        new Promise<never>((_, reject) => {
          const abort = () => reject(new axios.CanceledError('canceled', config));
          if (signal.aborted) abort();
          else signal.addEventListener?.('abort', abort, { once: true });
        }),
      ])
    : shared);

  return { ...response, config, data: typeof structuredClone === 'function' ? structuredClone(response.data) : response.data };
};

/**
 * A request the server refused, in words a person can act on.
 *
 * `fieldErrors` is set when the server says which fields broke which rules (field key → message), so a
 * form can mark every one of them instead of showing a single line at the top.
 */
export class ApiError extends Error {
  readonly status: number | undefined;
  readonly fieldErrors: Record<string, string> | undefined;

  constructor(message: string, status?: number, fieldErrors?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

/** The per-field messages of a refused save, if the server gave any. */
export const fieldErrorsOf = (error: unknown): Record<string, string> | undefined =>
  error instanceof ApiError ? error.fieldErrors : undefined;

/** What the server sends back (202) when a change is held for a checker instead of applied. */
export interface ApprovalPending {
  approvalRequestId: string;
  module: string;
  action: string;
  checkerName: string;
  message: string;
}

export function isApprovalPendingBody(value: unknown): value is ApprovalPending {
  return typeof value === 'object' && value !== null && 'approvalRequestId' in value;
}

/**
 * Thrown for a change that was sent for approval rather than applied.
 *
 * It is an error only in the sense that the caller's "saved" path must not run — the screen must not
 * say "Product deleted" about a product that is still there. The request itself succeeded; the user
 * has already been told it is waiting for approval (see the interceptor below).
 */
export class ApprovalPendingError extends Error {
  readonly pending: ApprovalPending;

  constructor(pending: ApprovalPending) {
    super(`Sent for approval. ${pending.checkerName || 'A checker'} needs to approve this change before it takes effect.`);
    this.name = 'ApprovalPendingError';
    this.pending = pending;
  }
}

export const isApprovalPending = (error: unknown): error is ApprovalPendingError => error instanceof ApprovalPendingError;

/**
 * The platform token on every request — and nothing else about who the user is.
 *
 * This used to also send `X-Actor-Name` / `X-Actor-Email`, which the server wrote onto audit rows; the
 * browser chose whose name went in the trail. The server now reads the actor from the token alone.
 */
httpClient.interceptors.request.use((config) => {
  // A retry already carries the token that was just refreshed; do not swap it back for a cached one.
  if ((config as RetriableConfig)._retriedAfterRefresh) return config;
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

type RetriableConfig = InternalAxiosRequestConfig & { _retriedAfterRefresh?: boolean };

httpClient.interceptors.response.use(
  (response: AxiosResponse) => {
    if (response.status === 202 && isApprovalPendingBody(response.data)) {
      const error = new ApprovalPendingError(response.data);
      useToastStore.getState().info('Sent for approval', error.message);
      return Promise.reject(error);
    }
    return response;
  },
  async (error: AxiosError<{ message?: string; title?: string; detail?: string; errors?: Record<string, string> }>) => {
    if (axios.isCancel(error)) return Promise.reject(error);

    // An expired token is refreshed once through the host and the request repeated, as the host's own
    // client does. A second 401 is real.
    const config = error.config as RetriableConfig | undefined;
    if (error.response?.status === 401 && config && !config._retriedAfterRefresh && isRunningInHost()) {
      config._retriedAfterRefresh = true;
      try {
        const token = await ensureFreshAccessToken();
        config.headers.Authorization = `Bearer ${token}`;
        return httpClient.request(config);
      } catch {
        // fall through to the plain-language message below
      }
    }

    const status = error.response?.status;
    const body = error.response?.data;
    const message =
      status === 403
        ? body?.title || "You don't have permission to do this."
        : status === 401
          ? 'Your session has ended. Please sign in again.'
          : body?.message || body?.title || body?.detail || error.message || 'Something went wrong. Please try again.';
    return Promise.reject(new ApiError(message, status, status === 400 ? body?.errors : undefined));
  },
);
