import { useCallback } from "react"
import { db } from "@/db"
import type { JSONContent } from "@threa/types"

function generateDraftId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `draft_${timestamp}${random}`
}

/**
 * Build a ProseMirror document from the shared title, text, and URL.
 * Formats the content as paragraphs with the URL as a clickable link.
 */
function buildSharedContent(title: string | null, text: string | null, url: string | null): JSONContent {
  const nodes: JSONContent[] = []

  // Add title as bold text if present and different from text
  if (title && title !== text) {
    nodes.push({
      type: "paragraph",
      content: [{ type: "text", text: title, marks: [{ type: "bold" }] }],
    })
  }

  // Add text content — split into paragraphs on newlines
  if (text) {
    for (const line of text.split("\n")) {
      const trimmed = line.trim()
      if (trimmed) {
        nodes.push({
          type: "paragraph",
          content: [{ type: "text", text: trimmed }],
        })
      } else {
        nodes.push({ type: "paragraph" })
      }
    }
  }

  // Add URL as a linked paragraph
  if (url) {
    nodes.push({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: url,
          marks: [{ type: "link", attrs: { href: url, target: "_blank" } }],
        },
      ],
    })
  }

  // Fallback if nothing was shared
  if (nodes.length === 0) {
    nodes.push({ type: "paragraph" })
  }

  return { type: "doc", content: nodes }
}

/**
 * Hook for handling PWA Share Target content.
 *
 * Provides two operations:
 * - `createShareDraft`: Creates a new draft scratchpad pre-populated with shared content
 * - `saveShareContent`: Saves shared content as a draft message in an existing stream's composer
 */
export function useShareTarget() {
  const createShareDraft = useCallback(
    async (
      workspaceId: string,
      shared: { title: string | null; text: string | null; url: string | null }
    ): Promise<{ draftId: string; path: string }> => {
      const draftId = generateDraftId()
      const content = buildSharedContent(shared.title, shared.text, shared.url)

      await Promise.all([
        db.draftScratchpads.add({
          id: draftId,
          workspaceId,
          displayName: shared.title || null,
          companionMode: "on",
          createdAt: Date.now(),
        }),
        db.draftMessages.put({
          id: `stream:${draftId}`,
          workspaceId,
          contentJson: content,
          updatedAt: Date.now(),
        }),
      ])

      return { draftId, path: `/w/${workspaceId}/s/${draftId}` }
    },
    []
  )

  const saveShareContent = useCallback(
    async (
      workspaceId: string,
      streamId: string,
      shared: { title: string | null; text: string | null; url: string | null }
    ): Promise<void> => {
      const content = buildSharedContent(shared.title, shared.text, shared.url)

      // Read existing draft to preserve staged attachments (put replaces the full record)
      const existing = await db.draftMessages.get(`stream:${streamId}`)

      await db.draftMessages.put({
        id: `stream:${streamId}`,
        workspaceId,
        contentJson: content,
        attachments: existing?.attachments,
        updatedAt: Date.now(),
      })
    },
    []
  )

  return { createShareDraft, saveShareContent }
}
