'use client';

/**
 * Placeholder hook for WebSocket real-time updates.
 * Will be implemented when the backend WebSocket API Gateway is deployed.
 */
export function useWebSocket(_onMessage?: (data: unknown) => void) {
  // No-op — real implementation will connect to NEXT_PUBLIC_WS_URL
  return { connected: false };
}
