import { HubConnectionBuilder, HubConnectionState, LogLevel, type HubConnection } from "@microsoft/signalr";
import { API_ORIGIN } from "./httpClient";
import type { AuditLog } from "../types/domain";

let connection: HubConnection | null = null;
let startPromise: Promise<void> | null = null;

function getConnection(): HubConnection {
  if (!connection) {
    connection = new HubConnectionBuilder()
      .withUrl(`${API_ORIGIN}/hubs/audit-log`, { withCredentials: true })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();
  }
  return connection;
}

/**
 * Subscribes to the real-time audit log feed. Returns an unsubscribe function.
 * Connects lazily and is safe to call from multiple components; the underlying
 * SignalR connection is shared across the app and never torn down on unmount
 * (only the message handler is), so events broadcast while no page is
 * listening are simply dropped rather than triggering a reconnect storm.
 */
export function subscribeToAuditLogs(onCreated: (entry: AuditLog) => void, onConnectionChange?: (connected: boolean) => void): () => void {
  const conn = getConnection();
  conn.on("AuditLogCreated", onCreated);

  conn.onreconnecting(() => onConnectionChange?.(false));
  conn.onreconnected(() => onConnectionChange?.(true));
  conn.onclose(() => onConnectionChange?.(false));

  if (conn.state === HubConnectionState.Connected) {
    onConnectionChange?.(true);
  } else if (conn.state === HubConnectionState.Disconnected) {
    startPromise = conn
      .start()
      .then(() => onConnectionChange?.(true))
      .catch((err) => {
        console.warn("Audit log real-time connection failed:", err);
        onConnectionChange?.(false);
      });
  } else {
    startPromise?.then(() => onConnectionChange?.(conn.state === HubConnectionState.Connected));
  }

  return () => {
    conn.off("AuditLogCreated", onCreated);
  };
}
