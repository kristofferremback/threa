import type { Pool } from "pg"
import { withTransaction } from "../../db"
import { linkPreviewId } from "../../lib/id"
import type { LinkPreviewSummary } from "@threa/types"
import { LinkPreviewRepository, type LinkPreview, type UpdateLinkPreviewParams } from "./repository"
import { OutboxRepository } from "../../lib/outbox"
import { extractUrls, normalizeUrl, detectContentType } from "./url-utils"
import { MAX_PREVIEWS_PER_MESSAGE } from "./config"

export interface LinkPreviewServiceDeps {
  pool: Pool
}

export class LinkPreviewService {
  constructor(private deps: LinkPreviewServiceDeps) {}

  /**
   * Extract URLs from message content and create pending link preview records.
   * Returns the preview IDs and URLs that need to be fetched.
   */
  async extractAndCreatePending(
    workspaceId: string,
    messageId: string,
    contentMarkdown: string
  ): Promise<Array<{ id: string; url: string }>> {
    const urls = extractUrls(contentMarkdown).slice(0, MAX_PREVIEWS_PER_MESSAGE)
    if (urls.length === 0) return []

    return withTransaction(this.deps.pool, async (client) => {
      const results: Array<{ id: string; url: string }> = []

      for (let i = 0; i < urls.length; i++) {
        const url = urls[i]
        const normalized = normalizeUrl(url)
        const contentType = detectContentType(url)

        const preview = await LinkPreviewRepository.insert(client, {
          id: linkPreviewId(),
          workspaceId,
          url,
          normalizedUrl: normalized,
          contentType,
        })

        await LinkPreviewRepository.linkToMessage(client, workspaceId, messageId, preview.id, i)
        results.push({ id: preview.id, url: preview.url })
      }

      return results
    })
  }

  /**
   * Replace link previews for an edited message.
   * Clears old junction rows then creates pending records for new URLs (INV-6: service owns transaction).
   */
  async replacePreviewsForMessage(
    workspaceId: string,
    messageId: string,
    contentMarkdown: string
  ): Promise<Array<{ id: string; url: string }>> {
    const urls = extractUrls(contentMarkdown).slice(0, MAX_PREVIEWS_PER_MESSAGE)

    return withTransaction(this.deps.pool, async (client) => {
      // Clear old message-preview links
      await LinkPreviewRepository.unlinkAllFromMessage(client, workspaceId, messageId)

      if (urls.length === 0) return []

      const results: Array<{ id: string; url: string }> = []

      for (let i = 0; i < urls.length; i++) {
        const url = urls[i]
        const normalized = normalizeUrl(url)
        const contentType = detectContentType(url)

        const preview = await LinkPreviewRepository.insert(client, {
          id: linkPreviewId(),
          workspaceId,
          url,
          normalizedUrl: normalized,
          contentType,
        })

        await LinkPreviewRepository.linkToMessage(client, workspaceId, messageId, preview.id, i)
        results.push({ id: preview.id, url: preview.url })
      }

      return results
    })
  }

  /**
   * Publish a link_preview:ready event with an empty previews array.
   * Used when an edited message no longer contains any URLs.
   */
  async publishEmptyPreviews(workspaceId: string, streamId: string, messageId: string): Promise<void> {
    await OutboxRepository.insert(this.deps.pool, "link_preview:ready", {
      workspaceId,
      streamId,
      messageId,
      previews: [],
    })
  }

  /**
   * Check if a preview is already completed (cached from another message).
   */
  async isCompleted(workspaceId: string, id: string): Promise<boolean> {
    const existing = await LinkPreviewRepository.findById(this.deps.pool, workspaceId, id)
    return existing?.status === "completed"
  }

  /**
   * Update fetched metadata and publish outbox event for completed previews.
   * Called by the worker after network fetches complete (INV-6: service owns transaction).
   */
  async completePreviewsAndPublish(
    workspaceId: string,
    streamId: string,
    messageId: string,
    fetchResults: Array<{ id: string; metadata?: UpdateLinkPreviewParams; skipped: boolean }>,
    options?: { forcePublish?: boolean }
  ): Promise<void> {
    await withTransaction(this.deps.pool, async (client) => {
      const completedPreviews: LinkPreviewSummary[] = []
      let hasNewWrites = false

      for (const { id, metadata, skipped } of fetchResults) {
        if (skipped) {
          const existing = await LinkPreviewRepository.findById(client, workspaceId, id)
          if (existing) {
            completedPreviews.push(toLinkPreviewSummary(existing, completedPreviews.length))
          }
          continue
        }

        if (!metadata) continue
        const updated = await LinkPreviewRepository.updateMetadata(client, workspaceId, id, metadata)
        if (updated && updated.status === "completed") {
          hasNewWrites = true
          completedPreviews.push(toLinkPreviewSummary(updated, completedPreviews.length))
        } else if (!updated) {
          // Row already completed by a concurrent worker (WHERE status='pending' didn't match)
          const existing = await LinkPreviewRepository.findById(client, workspaceId, id)
          if (existing?.status === "completed") {
            completedPreviews.push(toLinkPreviewSummary(existing, completedPreviews.length))
          }
        }
      }

      // Publish if this worker wrote at least one row, or if forced (edit flow where
      // the set of previews changed even though individual preview metadata was already cached).
      if (completedPreviews.length > 0 && (hasNewWrites || options?.forcePublish)) {
        await OutboxRepository.insert(client, "link_preview:ready", {
          workspaceId,
          streamId,
          messageId,
          previews: completedPreviews,
        })
      } else if (completedPreviews.length === 0 && options?.forcePublish) {
        // All fetches failed on an edit — DB junction rows are already cleared,
        // but frontend still shows stale previews. Emit empty set to clear them.
        await OutboxRepository.insert(client, "link_preview:ready", {
          workspaceId,
          streamId,
          messageId,
          previews: [],
        })
      }
    })
  }

  /**
   * Get link preview summaries for a message.
   * Filters out failed/pending previews.
   */
  async getPreviewsForMessage(workspaceId: string, messageId: string): Promise<LinkPreviewSummary[]> {
    const previews = await LinkPreviewRepository.findByMessageId(this.deps.pool, workspaceId, messageId)
    return previews.filter((p) => p.status === "completed").map((p, i) => toLinkPreviewSummary(p, i))
  }

  /**
   * Get link preview summaries for multiple messages (batch).
   */
  async getPreviewsForMessages(workspaceId: string, messageIds: string[]): Promise<Map<string, LinkPreviewSummary[]>> {
    const previewMap = await LinkPreviewRepository.findByMessageIds(this.deps.pool, workspaceId, messageIds)
    const result = new Map<string, LinkPreviewSummary[]>()

    for (const [msgId, previews] of previewMap) {
      const completed = previews.filter((p) => p.status === "completed").map((p, i) => toLinkPreviewSummary(p, i))
      if (completed.length > 0) {
        result.set(msgId, completed)
      }
    }

    return result
  }

  /**
   * Dismiss a link preview for a user and notify other sessions via outbox (INV-4).
   */
  async dismiss(workspaceId: string, userId: string, messageId: string, linkPreviewId: string): Promise<void> {
    await withTransaction(this.deps.pool, async (client) => {
      const inserted = await LinkPreviewRepository.dismiss(client, workspaceId, userId, messageId, linkPreviewId)
      if (inserted) {
        await OutboxRepository.insert(client, "link_preview:dismissed", {
          workspaceId,
          authorId: userId,
          messageId,
          linkPreviewId,
        })
      }
    })
  }

  /**
   * Get dismissed preview keys for a user across multiple messages.
   */
  async getDismissals(workspaceId: string, userId: string, messageIds: string[]): Promise<Set<string>> {
    return LinkPreviewRepository.findDismissals(this.deps.pool, workspaceId, userId, messageIds)
  }
}

function toLinkPreviewSummary(preview: LinkPreview, position: number): LinkPreviewSummary {
  return {
    id: preview.id,
    url: preview.url,
    title: preview.title,
    description: preview.description,
    imageUrl: preview.imageUrl,
    faviconUrl: preview.faviconUrl,
    siteName: preview.siteName,
    contentType: preview.contentType,
    position,
  }
}
