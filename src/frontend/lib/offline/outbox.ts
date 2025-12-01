/**
 * Outbox - Queue messages for offline sending
 *
 * Messages are stored in IndexedDB when offline and sent when connectivity returns.
 * Provides optimistic UI updates and retry logic.
 */

import type { Mention, StreamEvent } from "../../types"
import {
  addToOutbox as dbAddToOutbox,
  getOutboxMessage as dbGetOutboxMessage,
  getOutboxForStream as dbGetOutboxForStream,
  getAllPendingOutbox as dbGetAllPending,
  updateOutboxStatus as dbUpdateStatus,
  removeFromOutbox as dbRemoveFromOutbox,
  clearOutbox as dbClearOutbox,
  isIndexedDBAvailable,
  type OutboxMessage,
  type OutboxStatus,
} from "./db"

export type { OutboxMessage, OutboxStatus }

// Maximum retries before giving up
const MAX_RETRIES = 5

// Generate a unique ID for outbox messages
function generateOutboxId(): string {
  return `outbox_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Add a message to the outbox
 */
export async function addMessage(
  workspaceId: string,
  streamId: string,
  content: string,
  mentions: Mention[] = [],
  options: { parentEventId?: string; parentStreamId?: string } = {},
): Promise<OutboxMessage> {
  const message: OutboxMessage = {
    id: generateOutboxId(),
    workspaceId,
    streamId,
    content,
    mentions,
    createdAt: Date.now(),
    status: "pending",
    retryCount: 0,
    parentEventId: options.parentEventId,
    parentStreamId: options.parentStreamId,
  }

  if (isIndexedDBAvailable()) {
    try {
      await dbAddToOutbox(message)
    } catch (err) {
      console.warn("[Outbox] Failed to add message to IndexedDB:", err)
    }
  }

  return message
}

/**
 * Get a specific outbox message
 */
export async function getMessage(id: string): Promise<OutboxMessage | null> {
  if (!isIndexedDBAvailable()) return null

  try {
    return await dbGetOutboxMessage(id)
  } catch (err) {
    console.warn("[Outbox] Failed to get message:", err)
    return null
  }
}

/**
 * Get pending messages for a specific stream
 */
export async function getPendingForStream(streamId: string): Promise<OutboxMessage[]> {
  if (!isIndexedDBAvailable()) return []

  try {
    const messages = await dbGetOutboxForStream(streamId)
    return messages.filter((m) => m.status === "pending" || m.status === "failed")
  } catch (err) {
    console.warn("[Outbox] Failed to get pending for stream:", err)
    return []
  }
}

/**
 * Get all pending messages across all streams
 */
export async function getAllPending(): Promise<OutboxMessage[]> {
  if (!isIndexedDBAvailable()) return []

  try {
    return await dbGetAllPending()
  } catch (err) {
    console.warn("[Outbox] Failed to get all pending:", err)
    return []
  }
}

/**
 * Update message status
 */
export async function updateStatus(id: string, status: OutboxStatus, error?: string): Promise<void> {
  if (!isIndexedDBAvailable()) return

  try {
    await dbUpdateStatus(id, status, error)
  } catch (err) {
    console.warn("[Outbox] Failed to update status:", err)
  }
}

/**
 * Remove a message from the outbox (after successful send)
 */
export async function removeMessage(id: string): Promise<void> {
  if (!isIndexedDBAvailable()) return

  try {
    await dbRemoveFromOutbox(id)
  } catch (err) {
    console.warn("[Outbox] Failed to remove message:", err)
  }
}

/**
 * Clear all messages from the outbox
 */
export async function clearAll(): Promise<void> {
  if (!isIndexedDBAvailable()) return

  try {
    await dbClearOutbox()
  } catch (err) {
    console.warn("[Outbox] Failed to clear outbox:", err)
  }
}

/**
 * Check if a message should be retried
 */
export function shouldRetry(message: OutboxMessage): boolean {
  return message.retryCount < MAX_RETRIES
}

/**
 * Create an optimistic StreamEvent from an outbox message for immediate UI display
 */
export function createOptimisticEvent(
  message: OutboxMessage,
  currentUserId: string,
  currentUserEmail: string,
  currentUserName?: string,
): StreamEvent & { isOptimistic: true; outboxId: string } {
  return {
    id: `optimistic_${message.id}`,
    streamId: message.streamId,
    eventType: "message",
    actorId: currentUserId,
    actorEmail: currentUserEmail,
    actorName: currentUserName,
    content: message.content,
    mentions: message.mentions,
    createdAt: new Date(message.createdAt).toISOString(),
    replyCount: 0,
    isOptimistic: true,
    outboxId: message.id,
  }
}

/**
 * Process a single outbox message - attempt to send it
 */
export async function processMessage(
  message: OutboxMessage,
  sendFn: (message: OutboxMessage) => Promise<{ success: boolean; eventId?: string; error?: string }>,
): Promise<{ success: boolean; eventId?: string }> {
  // Mark as sending
  await updateStatus(message.id, "sending")

  try {
    const result = await sendFn(message)

    if (result.success) {
      // Remove from outbox
      await removeMessage(message.id)
      return { success: true, eventId: result.eventId }
    } else {
      // Mark as failed
      await updateStatus(message.id, "failed", result.error)
      return { success: false }
    }
  } catch (err) {
    // Mark as failed
    const errorMessage = err instanceof Error ? err.message : "Unknown error"
    await updateStatus(message.id, "failed", errorMessage)
    return { success: false }
  }
}

export interface ProcessOutboxResult {
  total: number
  sent: number
  failed: number
  remaining: number
}

/**
 * Process all pending outbox messages
 */
export async function processOutbox(
  sendFn: (message: OutboxMessage) => Promise<{ success: boolean; eventId?: string; error?: string }>,
): Promise<ProcessOutboxResult> {
  const pending = await getAllPending()

  const result: ProcessOutboxResult = {
    total: pending.length,
    sent: 0,
    failed: 0,
    remaining: 0,
  }

  for (const message of pending) {
    if (!shouldRetry(message)) {
      result.failed++
      continue
    }

    const sendResult = await processMessage(message, sendFn)

    if (sendResult.success) {
      result.sent++
    } else {
      result.remaining++
    }
  }

  return result
}

/**
 * Get count of pending messages
 */
export async function getPendingCount(): Promise<number> {
  const pending = await getAllPending()
  return pending.length
}
