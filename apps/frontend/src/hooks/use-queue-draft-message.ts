import { useCallback } from "react"
import { usePendingMessages } from "@/contexts"
import { useUser } from "@/auth"
import { useWorkspaceUsers } from "@/stores/workspace-store"
import { db, sequenceToNum, type CachedStream, type PendingStreamCreation } from "@/db"
import { serializeToMarkdown } from "@threa/prosemirror"
import { StreamTypes, Visibilities, type JSONContent, type StreamEvent } from "@threa/types"
import { createDraftPanelId } from "@/contexts/panel-context"
import { optimisticReplyCountUpdate } from "@/sync/stream-sync"
import { generateClientId } from "./use-stream-or-draft"
import type { AttachmentSummary } from "./create-optimistic-bootstrap"

export interface QueueDraftMessageInput {
  contentJson: JSONContent
  attachmentIds?: string[]
  attachments?: AttachmentSummary[]
}

export interface QueueDraftMessageParams {
  workspaceId: string
  /** The draft/synthetic streamId used for the optimistic event */
  streamId: string
  /** Stream creation metadata for the background queue */
  streamCreation: PendingStreamCreation
  /** The draft ID to clean up after promotion (may differ from streamId for threads) */
  draftId: string
}

/**
 * Hook that provides a function to queue a draft message for background
 * processing. Writes an optimistic event to IDB and enqueues the message
 * + stream creation for the background queue.
 *
 * This abstracts the IDB writes so components don't need to import @/db directly.
 */
export function useQueueDraftMessage(workspaceId: string) {
  const user = useUser()
  const idbUsers = useWorkspaceUsers(workspaceId)
  const currentUserId = idbUsers.find((u) => u.workosUserId === user?.id)?.id ?? null
  const { markPending, notifyQueue } = usePendingMessages()

  const queueDraftMessage = useCallback(
    async (input: QueueDraftMessageInput, params: QueueDraftMessageParams) => {
      if (!currentUserId) {
        throw new Error("Cannot send message: user identity not resolved yet")
      }

      const clientId = generateClientId()
      const now = new Date().toISOString()
      const contentMarkdown = serializeToMarkdown(input.contentJson)
      const optimisticSequence = Date.now().toString()

      const optimisticEvent: StreamEvent = {
        id: clientId,
        streamId: params.streamId,
        sequence: optimisticSequence,
        eventType: "message_created",
        payload: {
          messageId: clientId,
          contentMarkdown,
          ...(input.attachments && input.attachments.length > 0 ? { attachments: input.attachments } : {}),
        },
        actorId: currentUserId,
        actorType: "user",
        createdAt: now,
      }

      markPending(clientId)

      await db.pendingMessages.add({
        clientId,
        workspaceId: params.workspaceId,
        streamId: params.streamId,
        content: contentMarkdown,
        contentFormat: "markdown",
        contentJson: input.contentJson,
        attachmentIds: input.attachmentIds,
        createdAt: Date.now(),
        retryCount: 0,
        streamCreation: params.streamCreation,
        draftId: params.draftId,
      })

      await db.events.add({
        ...optimisticEvent,
        workspaceId: params.workspaceId,
        _sequenceNum: sequenceToNum(optimisticEvent.sequence),
        _clientId: clientId,
        _status: "pending",
        _cachedAt: Date.now(),
      })

      // Surface the committed draft in the sidebar and quick switcher so the
      // user can navigate back to it even before the real stream exists. The
      // promotion step will replace this entry with the server-assigned one.
      if (params.streamCreation.type === StreamTypes.SCRATCHPAD) {
        const draftScratchpad = await db.draftScratchpads.get(params.draftId)
        const optimisticStream: CachedStream = {
          id: params.streamId,
          workspaceId: params.workspaceId,
          type: StreamTypes.SCRATCHPAD,
          displayName: draftScratchpad?.displayName ?? params.streamCreation.displayName ?? null,
          slug: null,
          description: null,
          visibility: Visibilities.PRIVATE,
          parentStreamId: null,
          parentMessageId: null,
          rootStreamId: null,
          companionMode: params.streamCreation.companionMode ?? "on",
          companionPersonaId: null,
          createdBy: currentUserId,
          createdAt: draftScratchpad ? new Date(draftScratchpad.createdAt).toISOString() : now,
          updatedAt: now,
          archivedAt: null,
          lastMessagePreview: {
            authorId: currentUserId,
            authorType: "user",
            content: contentMarkdown,
            createdAt: now,
          },
          _cachedAt: Date.now(),
        }
        await db.streams.put(optimisticStream)
      }

      // For thread drafts, show a pending reply indicator on the parent message
      // by temporarily setting the parent's threadId to the draft panel ID and
      // bumping its replyCount. The promotion step swaps the threadId to the
      // real thread stream without re-incrementing.
      if (
        params.streamCreation.type === StreamTypes.THREAD &&
        params.streamCreation.parentStreamId &&
        params.streamCreation.parentMessageId
      ) {
        const draftPanelId = createDraftPanelId(
          params.streamCreation.parentStreamId,
          params.streamCreation.parentMessageId
        )
        await optimisticReplyCountUpdate(
          params.streamCreation.parentStreamId,
          params.streamCreation.parentMessageId,
          draftPanelId
        ).catch(() => {})
      }

      notifyQueue()
    },
    [currentUserId, markPending, notifyQueue]
  )

  return { queueDraftMessage, currentUserId }
}
