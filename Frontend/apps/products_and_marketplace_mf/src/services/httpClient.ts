import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { ensureFreshAccessToken, getAccessToken, isRunningInHost } from '../api/hostBridge';
import { useDrawerStore } from '../stores/useDrawerStore';
import { useToastStore } from '../stores/useToastStore';

export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5266/api';
export const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, '');

export const httpClient = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

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
      useDrawerStore.getState().close();
      useToastStore.getState().info('Sent for approval', error.message);
      return Promise.reject(error);
    }
    return response;
  },
  async (error: AxiosError<{ message?: string; title?: string; detail?: string }>) => {
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
    return Promise.reject(new Error(message));
  },
);
