/**
 * Message Outbox
 *
 * Persistent queue for messages that haven't been confirmed by the server.
 * Messages are stored BEFORE sending and removed only after server confirmation.
 * This ensures messages survive page refreshes and are retried on reconnect.
 */

import type { Mention } from "../types"

export interface OutboxMessage {
  id: string // Temporary ID (temp_xxx)
  workspaceId: string
  streamId: string
  content: string
  mentions?: Mention[]
  actorId: string
  actorEmail: string
  createdAt: string
  status: "pending" | "sending" | "failed"
  lastError?: string
  retryCount: number
  // For pending threads (streamId starts with "event_")
  parentEventId?: string
  parentStreamId?: string
}

const OUTBOX_KEY = "threa-message-outbox"

/**
 * Get all messages in the outbox
 */
export function getOutboxMessages(): OutboxMessage[] {
  try {
    const data = localStorage.getItem(OUTBOX_KEY)
    return data ? JSON.parse(data) : []
  } catch {
    return []
  }
}

/**
 * Get outbox messages for a specific stream
 */
export function getStreamOutboxMessages(workspaceId: string, streamId: string): OutboxMessage[] {
  return getOutboxMessages().filter((m) => m.workspaceId === workspaceId && m.streamId === streamId)
}

/**
 * Save messages to outbox
 */
function saveOutbox(messages: OutboxMessage[]) {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(messages))
  // Dispatch a storage event so same-tab listeners can react
  // (storage events normally only fire for other tabs)
  window.dispatchEvent(new StorageEvent("storage", { key: OUTBOX_KEY }))
}

/**
 * Generate a temporary ID for outbox messages
 */
export function generateTempId(): string {
  return `temp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Add a message to the outbox (called BEFORE sending)
 */
export function addToOutbox(message: Omit<OutboxMessage, "status" | "retryCount">): OutboxMessage {
  const outboxMessage: OutboxMessage = {
    ...message,
    status: "pending",
    retryCount: 0,
  }

  const messages = getOutboxMessages()
  messages.push(outboxMessage)
  saveOutbox(messages)

  return outboxMessage
}

/**
 * Update message status in outbox
 */
export function updateOutboxStatus(id: string, status: OutboxMessage["status"], error?: string): void {
  const messages = getOutboxMessages()
  const index = messages.findIndex((m) => m.id === id)

  if (index >= 0) {
    messages[index] = {
      ...messages[index],
      status,
      lastError: error,
      retryCount: status === "failed" ? messages[index].retryCount + 1 : messages[index].retryCount,
    }
    saveOutbox(messages)
  }
}

/**
 * Mark a message as sending
 */
export function markAsSending(id: string): void {
  updateOutboxStatus(id, "sending")
}

/**
 * Mark a message as failed
 */
export function markAsFailed(id: string, error?: string): void {
  updateOutboxStatus(id, "failed", error)
}

/**
 * Remove a message from the outbox (called AFTER server confirmation)
 */
export function removeFromOutbox(id: string): void {
  const messages = getOutboxMessages().filter((m) => m.id !== id)
  saveOutbox(messages)
}

/**
 * Check if a message ID is in the outbox
 */
export function isInOutbox(id: string): boolean {
  return getOutboxMessages().some((m) => m.id === id)
}

/**
 * Get pending/failed messages that should be retried
 */
export function getRetryableMessages(): OutboxMessage[] {
  return getOutboxMessages().filter((m) => m.status === "pending" || m.status === "failed")
}

/**
 * Reset any "sending" messages to "pending" status.
 * Called on page load to handle messages that were sending when the page closed.
 * We can't know if they were delivered, so we reset to pending and let the
 * server's idempotency check handle duplicates.
 */
export function resetSendingMessages(): void {
  const messages = getOutboxMessages()
  let changed = false

  for (const msg of messages) {
    if (msg.status === "sending") {
      msg.status = "pending"
      changed = true
    }
  }

  if (changed) {
    saveOutbox(messages)
  }
}

/**
 * Clear all messages from outbox (for testing/reset)
 */
export function clearOutbox(): void {
  localStorage.removeItem(OUTBOX_KEY)
}
