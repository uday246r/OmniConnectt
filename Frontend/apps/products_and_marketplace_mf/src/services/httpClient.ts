import axios from "axios";
import { getCurrentUser } from "../permissions/currentUser";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5266/api";
export const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");

export const httpClient = axios.create({
  baseURL: API_BASE_URL,
  headers: { "Content-Type": "application/json" },
});

// Read per-request (not at module load) so an identity the Host App injects after mount is picked up
// without rebuilding the client. The server treats these headers as untrusted and honours them only
// in development - an authenticated Host principal always wins. See backend HttpAuditContext.
httpClient.interceptors.request.use((config) => {
  const hostBridge = (window as unknown as {
    __omniremitHost__?: {
      getAccessToken: () => string | null;
      getUser: () => { id: string; name: string; email: string } | null;
    };
  }).__omniremitHost__;

  const token = hostBridge?.getAccessToken?.();
  if (token) {
    config.headers["Authorization"] = `Bearer ${token}`;
  }

  const hostUser = hostBridge?.getUser?.();
  const currentUser = hostUser ? { name: hostUser.name, email: hostUser.email } : getCurrentUser();

  config.headers["X-Actor-Name"] = currentUser.name;
  config.headers["X-Actor-Email"] = currentUser.email;
  return config;
});

httpClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isCancel(error)) return Promise.reject(error);
    const message = error?.response?.data?.message || error?.message || "Something went wrong. Please try again.";
    return Promise.reject(new Error(message));
  }
);
