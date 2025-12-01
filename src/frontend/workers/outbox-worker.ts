/**
 * Outbox Worker
 *
 * Background worker that processes pending messages from the outbox.
 * Similar to the backend outbox pattern:
 * - Polls every second for pending messages
 * - Processes messages one at a time (sequential, not parallel)
 * - Can be poked to process immediately (e.g., after adding a new message)
 * - Handles retries with exponential backoff
 *
 * The worker ensures that even if multiple instances somehow run,
 * they won't process the same message twice because:
 * 1. Messages are marked "sending" before the API call
 * 2. Server has idempotency via clientMessageId
 */

import { useMessageStore, type OutboxMessage } from "../stores/message-store"
import { streamApi } from "../../shared/api"

// =============================================================================
// Configuration
// =============================================================================

const POLL_INTERVAL_MS = 1000 // Poll every second
const MAX_RETRY_COUNT = 10
const BASE_RETRY_DELAY_MS = 1000 // 1 second base delay

// Calculate exponential backoff delay
function getRetryDelay(retryCount: number): number {
  // Exponential backoff: 1s, 2s, 4s, 8s, ... capped at 30s
  return Math.min(BASE_RETRY_DELAY_MS * Math.pow(2, retryCount), 30000)
}

// =============================================================================
// Worker State
// =============================================================================

let isProcessing = false
let pollTimeout: ReturnType<typeof setTimeout> | null = null
let isStarted = false

// Track last attempt time per message to implement backoff
const lastAttemptTimes = new Map<string, number>()

// =============================================================================
// Message Processing
// =============================================================================

async function processNextMessage(): Promise<boolean> {
  const store = useMessageStore.getState()
  const message = store.getNextPendingMessage()

  if (!message) {
    return false // Nothing to process
  }

  // Check if we should wait due to backoff
  if (message.status === "failed" && message.retryCount > 0) {
    const lastAttempt = lastAttemptTimes.get(message.id) || 0
    const delay = getRetryDelay(message.retryCount - 1)
    const timeSinceLastAttempt = Date.now() - lastAttempt

    if (timeSinceLastAttempt < delay) {
      // Not ready to retry yet, skip this message for now
      return false
    }
  }

  // Check max retries
  if (message.retryCount >= MAX_RETRY_COUNT) {
    console.warn(`[OutboxWorker] Message ${message.id} exceeded max retries, leaving as failed`)
    return false
  }

  // Mark as sending
  store.updateOutboxStatus(message.id, "sending")
  lastAttemptTimes.set(message.id, Date.now())

  try {
    const result = await sendMessage(message)

    // Success! Remove from outbox
    store.removeFromOutbox(message.id)
    lastAttemptTimes.delete(message.id)

    // If this was a pending thread creation, the server returns the real stream
    if (result.stream) {
      // The socket worker will handle updating the cache when it receives the event
      console.log(`[OutboxWorker] Thread created: ${result.stream.id}`)
    }

    return true
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    console.error(`[OutboxWorker] Failed to send message ${message.id}:`, errorMessage)

    // Mark as failed (will be retried later with backoff)
    store.updateOutboxStatus(message.id, "failed", errorMessage)
    return false
  }
}

async function sendMessage(message: OutboxMessage) {
  // Determine if this is a pending thread (streamId starts with "event_")
  const isPendingThread = message.streamId.startsWith("event_")

  if (isPendingThread) {
    // For pending threads, streamId is actually the parent event ID
    return streamApi.postMessage(message.workspaceId, "pending", {
      content: message.content,
      mentions: message.mentions,
      parentEventId: message.streamId,
      parentStreamId: message.parentStreamId,
      clientMessageId: message.id,
    })
  }

  return streamApi.postMessage(message.workspaceId, message.streamId, {
    content: message.content,
    mentions: message.mentions,
    clientMessageId: message.id,
  })
}

// =============================================================================
// Worker Loop
// =============================================================================

async function processLoop() {
  if (isProcessing) return

  isProcessing = true

  try {
    // Process messages one at a time until none are ready
    let processed = true
    while (processed) {
      processed = await processNextMessage()
    }
  } finally {
    isProcessing = false
  }
}

function schedulePoll() {
  if (pollTimeout) {
    clearTimeout(pollTimeout)
  }

  pollTimeout = setTimeout(() => {
    processLoop().finally(() => {
      if (isStarted) {
        schedulePoll()
      }
    })
  }, POLL_INTERVAL_MS)
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Start the outbox worker.
 * Should be called once when the app initializes.
 */
export function startOutboxWorker() {
  if (isStarted) return

  isStarted = true
  console.log("[OutboxWorker] Started")

  // Load persisted outbox from localStorage
  const store = useMessageStore.getState()
  store.loadOutboxFromStorage()

  // Reset any "sending" messages to "pending" (may have been interrupted)
  store.resetSendingToRetry()

  // Start polling
  schedulePoll()

  // Also process immediately in case there are pending messages
  processLoop()
}

/**
 * Stop the outbox worker.
 */
export function stopOutboxWorker() {
  isStarted = false

  if (pollTimeout) {
    clearTimeout(pollTimeout)
    pollTimeout = null
  }

  console.log("[OutboxWorker] Stopped")
}

/**
 * Poke the worker to process immediately.
 * Call this after adding a new message to the outbox.
 */
export function pokeOutboxWorker() {
  if (!isStarted) {
    console.warn("[OutboxWorker] Worker not started, cannot poke")
    return
  }

  // Process immediately (don't wait for poll interval)
  processLoop()
}

/**
 * Check if the worker is running
 */
export function isOutboxWorkerRunning() {
  return isStarted
}
