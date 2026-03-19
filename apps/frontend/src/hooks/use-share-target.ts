import { useCallback } from "react"
import { db } from "@/db"
import type { DraftAttachment } from "@/db/database"
import type { JSONContent } from "@threa/types"
import { generateDraftId } from "@/hooks/use-draft-scratchpads"
import { attachmentsApi } from "@/api/attachments"
import { SHARE_TARGET_CACHE } from "@/lib/sw-messages"

/** Data stashed by the service worker from a Web Share Target POST. */
export interface ShareData {
  title: string | null
  text: string | null
  url: string | null
  files: File[]
}

/**
 * Read share data stashed by the service worker in the Cache API.
 * Returns null if no data is available. Does NOT clear the cache — call
 * {@link clearShareTargetCache} after the data has been safely consumed.
 */
export async function readShareTargetCache(): Promise<ShareData | null> {
  try {
    const cache = await caches.open(SHARE_TARGET_CACHE)
    const metaResponse = await cache.match("/_share/meta")
    if (!metaResponse) return null

    const meta = (await metaResponse.json()) as {
      title: string | null
      text: string | null
      url: string | null
      fileCount: number
    }

    const files: File[] = []
    for (let i = 0; i < meta.fileCount; i++) {
      const fileResponse = await cache.match(`/_share/file/${i}`)
      if (fileResponse) {
        const blob = await fileResponse.blob()
        const filename = fileResponse.headers.get("X-Filename") || `file-${i}`
        files.push(new File([blob], filename, { type: blob.type }))
      }
    }

    return { title: meta.title, text: meta.text, url: meta.url, files }
  } catch {
    return null
  }
}

/** Remove stashed share data from the Cache API after it has been consumed. */
export async function clearShareTargetCache(): Promise<void> {
  try {
    await caches.delete(SHARE_TARGET_CACHE)
  } catch {
    // Best-effort cleanup
  }
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
 * Upload shared files and return DraftAttachment entries.
 * Best-effort: failed uploads are skipped so text content is still saved.
 */
async function uploadSharedFiles(workspaceId: string, files: File[]): Promise<DraftAttachment[]> {
  const settled = await Promise.allSettled(
    files.map(async (file) => {
      const attachment = await attachmentsApi.upload(workspaceId, file)
      return {
        id: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
      } satisfies DraftAttachment
    })
  )
  return settled
    .filter((r): r is PromiseFulfilledResult<DraftAttachment> => r.status === "fulfilled")
    .map((r) => r.value)
}

export function useShareTarget() {
  const createShareDraft = useCallback(
    async (workspaceId: string, shared: ShareData): Promise<{ draftId: string; path: string }> => {
      const draftId = generateDraftId()
      const content = buildSharedContent(shared.title, shared.text, shared.url)
      const attachments = shared.files.length > 0 ? await uploadSharedFiles(workspaceId, shared.files) : undefined

      await db.transaction("rw", db.draftScratchpads, db.draftMessages, async () => {
        await db.draftScratchpads.add({
          id: draftId,
          workspaceId,
          displayName: shared.title || null,
          companionMode: "on",
          createdAt: Date.now(),
        })
        await db.draftMessages.put({
          id: `stream:${draftId}`,
          workspaceId,
          contentJson: content,
          attachments,
          updatedAt: Date.now(),
        })
      })

      return { draftId, path: `/w/${workspaceId}/s/${draftId}` }
    },
    []
  )

  const saveShareContent = useCallback(
    async (workspaceId: string, streamId: string, shared: ShareData): Promise<void> => {
      const content = buildSharedContent(shared.title, shared.text, shared.url)
      const uploadedAttachments = shared.files.length > 0 ? await uploadSharedFiles(workspaceId, shared.files) : []

      // Transaction ensures the read-then-put is atomic — a concurrent write
      // between get and put can't silently drop attachments.
      await db.transaction("rw", db.draftMessages, async () => {
        const existing = await db.draftMessages.get(`stream:${streamId}`)
        const mergedAttachments = [...(existing?.attachments ?? []), ...uploadedAttachments]
        await db.draftMessages.put({
          id: `stream:${streamId}`,
          workspaceId,
          contentJson: content,
          attachments: mergedAttachments.length > 0 ? mergedAttachments : undefined,
          updatedAt: Date.now(),
        })
      })
    },
    []
  )

  return { createShareDraft, saveShareContent }
}
