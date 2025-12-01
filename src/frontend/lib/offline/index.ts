/**
 * Offline support module
 *
 * Provides IndexedDB-backed caching for:
 * - Stream metadata
 * - Events/messages
 * - Message drafts
 * - Outbox (offline message queue)
 */

// Database operations
export {
  openDB,
  closeDB,
  deleteDB,
  isIndexedDBAvailable,
  pruneCache,
  type CachedStream,
  type CachedEvent,
  type Draft,
  type OutboxMessage,
  type OutboxStatus,
  type SyncState,
} from "./db"

// Draft store
export { saveDraft, getDraft, clearDraft, getAllDrafts, pruneOldDrafts, hasDraft } from "./draft-store"

// Message cache
export {
  cacheStream,
  getCachedStream,
  getCachedStreams,
  removeCachedStream,
  cacheEvents,
  getCachedEvents,
  getCachedEvent,
  mergeEvent,
  updateCachedEvent,
  deleteCachedEvent,
  clearStreamCache,
  getStreamSyncState,
  hasCache,
  getCacheFreshness,
  isCacheStale,
} from "./message-cache"

// Outbox
export {
  addMessage as addToOutbox,
  getMessage as getOutboxMessage,
  getPendingForStream,
  getAllPending as getAllPendingMessages,
  updateStatus as updateOutboxStatus,
  removeMessage as removeFromOutbox,
  clearAll as clearOutbox,
  shouldRetry,
  createOptimisticEvent,
  processMessage,
  processOutbox,
  getPendingCount,
} from "./outbox"
