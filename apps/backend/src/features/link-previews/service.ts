import type { Pool } from "pg"
import { withClient } from "../../db"
import { linkPreviewId } from "../../lib/id"
import type { LinkPreviewSummary } from "@threa/types"
import { LinkPreviewRepository, type LinkPreview } from "./repository"
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

    return withClient(this.deps.pool, async (client) => {
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

        await LinkPreviewRepository.linkToMessage(client, messageId, preview.id, i)
        results.push({ id: preview.id, url: preview.url })
      }

      return results
    })
  }

  /**
   * Get link preview summaries for a message.
   * Filters out failed/pending previews.
   */
  async getPreviewsForMessage(messageId: string): Promise<LinkPreviewSummary[]> {
    const previews = await LinkPreviewRepository.findByMessageId(this.deps.pool, messageId)
    return previews.filter((p) => p.status === "completed").map((p, i) => toLinkPreviewSummary(p, i))
  }

  /**
   * Get link preview summaries for multiple messages (batch).
   */
  async getPreviewsForMessages(messageIds: string[]): Promise<Map<string, LinkPreviewSummary[]>> {
    const previewMap = await LinkPreviewRepository.findByMessageIds(this.deps.pool, messageIds)
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
   * Dismiss a link preview for a user.
   */
  async dismiss(workspaceId: string, userId: string, messageId: string, linkPreviewId: string): Promise<void> {
    await LinkPreviewRepository.dismiss(this.deps.pool, workspaceId, userId, messageId, linkPreviewId)
  }

  /**
   * Un-dismiss a link preview for a user.
   */
  async undismiss(workspaceId: string, userId: string, messageId: string, linkPreviewId: string): Promise<void> {
    await LinkPreviewRepository.undismiss(this.deps.pool, workspaceId, userId, messageId, linkPreviewId)
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
