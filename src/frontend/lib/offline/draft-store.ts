/**
 * Draft Store - Persist message drafts per stream
 *
 * Automatically saves drafts as users type, restores them when reopening streams,
 * and clears them after successful send.
 */

import type { Mention } from "../../types"
import {
  saveDraft as dbSaveDraft,
  getDraft as dbGetDraft,
  deleteDraft as dbDeleteDraft,
  getAllDrafts as dbGetAllDrafts,
  isIndexedDBAvailable,
  type Draft,
} from "./db"

export type { Draft }

// Maximum draft age before cleanup (30 days)
const MAX_DRAFT_AGE_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Save a draft for a stream
 */
export async function saveDraft(streamId: string, content: string, mentions: Mention[]): Promise<void> {
  if (!isIndexedDBAvailable()) return

  // Don't save empty drafts
  if (!content.trim()) {
    await clearDraft(streamId)
    return
  }

  try {
    await dbSaveDraft({
      streamId,
      content,
      mentions,
      updatedAt: Date.now(),
    })
  } catch (err) {
    console.warn("[DraftStore] Failed to save draft:", err)
  }
}

/**
 * Get a draft for a stream
 */
export async function getDraft(streamId: string): Promise<{ content: string; mentions: Mention[] } | null> {
  if (!isIndexedDBAvailable()) return null

  try {
    const draft = await dbGetDraft(streamId)
    if (!draft) return null

    // Check if draft is too old
    if (Date.now() - draft.updatedAt > MAX_DRAFT_AGE_MS) {
      await clearDraft(streamId)
      return null
    }

    return {
      content: draft.content,
      mentions: draft.mentions,
    }
  } catch (err) {
    console.warn("[DraftStore] Failed to get draft:", err)
    return null
  }
}

/**
 * Clear a draft for a stream (e.g., after successful send)
 */
export async function clearDraft(streamId: string): Promise<void> {
  if (!isIndexedDBAvailable()) return

  try {
    await dbDeleteDraft(streamId)
  } catch (err) {
    console.warn("[DraftStore] Failed to clear draft:", err)
  }
}

/**
 * Get all drafts (for debugging or UI purposes)
 */
export async function getAllDrafts(): Promise<Draft[]> {
  if (!isIndexedDBAvailable()) return []

  try {
    return await dbGetAllDrafts()
  } catch (err) {
    console.warn("[DraftStore] Failed to get all drafts:", err)
    return []
  }
}

/**
 * Prune old drafts
 */
export async function pruneOldDrafts(): Promise<number> {
  if (!isIndexedDBAvailable()) return 0

  try {
    const drafts = await dbGetAllDrafts()
    const cutoff = Date.now() - MAX_DRAFT_AGE_MS
    let deleted = 0

    for (const draft of drafts) {
      if (draft.updatedAt < cutoff) {
        await dbDeleteDraft(draft.streamId)
        deleted++
      }
    }

    return deleted
  } catch (err) {
    console.warn("[DraftStore] Failed to prune old drafts:", err)
    return 0
  }
}

/**
 * Check if a stream has a draft
 */
export async function hasDraft(streamId: string): Promise<boolean> {
  if (!isIndexedDBAvailable()) return false

  try {
    const draft = await dbGetDraft(streamId)
    return draft !== null && draft.content.trim().length > 0
  } catch {
    return false
  }
}
