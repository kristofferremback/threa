import type { Session } from "./types";

/**
 * In-memory session storage (replace with Redis in production)
 */
export const sessions = new Map<string, Session>();

/**
 * WebSocket clients storage
 */
export const wsClients = new Map<string, any>();
