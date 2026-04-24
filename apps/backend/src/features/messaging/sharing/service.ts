import type { Querier } from "../../../db"
import { HttpError } from "../../../lib/errors"
import { sharedMessageId } from "../../../lib/id"
import { type JSONContent, ShareFlavors, type ShareFlavor } from "@threa/types"
import { MessageRepository } from "../repository"
import {
  crossesPrivacyBoundary,
  type CountExposedMembers,
  type FindStreamForSharing,
  type IsAncestorStream,
} from "./access-check"
import { SharedMessageRepository } from "./repository"

/**
 * A share-node extracted from a message's contentJson during scanning.
 * Cross-stream only — same-stream quoteReply nodes are the existing in-stream
 * quote behavior and are NOT shares (plan D3, service contract).
 */
interface ShareReference {
  flavor: ShareFlavor
  sourceMessageId: string
  sourceStreamId: string
}

/**
 * Walk a ProseMirror content tree and collect every sharedMessage or cross-stream
 * quoteReply node. Same-stream quoteReply is skipped — it's the existing
 * quote-reply feature, not a share.
 */
export function collectShareReferences(content: JSONContent, targetStreamId: string): ShareReference[] {
  const found: ShareReference[] = []
  walk(content)
  return found

  function walk(node: JSONContent | undefined): void {
    if (!node) return
    if (node.type === "sharedMessage") {
      const attrs = node.attrs as { messageId?: string; streamId?: string } | undefined
      if (attrs?.messageId && attrs.streamId) {
        found.push({
          flavor: ShareFlavors.POINTER,
          sourceMessageId: attrs.messageId,
          sourceStreamId: attrs.streamId,
        })
      }
    } else if (node.type === "quoteReply") {
      const attrs = node.attrs as { messageId?: string; streamId?: string } | undefined
      if (attrs?.messageId && attrs.streamId && attrs.streamId !== targetStreamId) {
        found.push({
          flavor: ShareFlavors.QUOTE,
          sourceMessageId: attrs.messageId,
          sourceStreamId: attrs.streamId,
        })
      }
    }
    if (node.content) {
      for (const child of node.content) {
        walk(child)
      }
    }
  }
}

export interface ValidateAndRecordSharesParams {
  client: Querier
  workspaceId: string
  targetStreamId: string
  shareMessageId: string
  sharerId: string
  contentJson: JSONContent
  /**
   * Stream loader injected by the caller. Avoids importing StreamRepository
   * directly from inside this sub-feature which would create a barrel cycle
   * between messaging and streams.
   */
  findStream: FindStreamForSharing
  /**
   * Ancestor check injected by the caller (same barrel-cycle reason as
   * {@link findStream}). Expected to resolve the chain in the DB layer via
   * a recursive CTE — the sharing service must not walk it app-side.
   */
  isAncestor: IsAncestorStream
  /**
   * Exposed-member count injected by the caller (same barrel-cycle reason).
   * Runs the set-based NOT-EXISTS count in the repository so this service
   * never issues its own SQL (INV-5).
   */
  countExposedMembers: CountExposedMembers
  /**
   * Set when the sharer has acknowledged the privacy warning in the modal.
   * Backend re-runs the check to prevent spoofed confirmations — the flag is
   * only consulted AFTER the cross-boundary condition is independently
   * established server-side.
   */
  confirmedPrivacyWarning?: boolean
}

/**
 * Validates any cross-stream share-nodes in a message's contentJson and
 * writes the corresponding shared_messages rows. Invoked from inside
 * MessageEventService.createMessage's transaction so the share grant is
 * committed atomically with the event-source + projection (INV-7).
 */
export const ShareService = {
  async validateAndRecordShares(params: ValidateAndRecordSharesParams): Promise<void> {
    const references = collectShareReferences(params.contentJson, params.targetStreamId)
    if (references.length === 0) return

    for (const ref of references) {
      const sourceMessage = await MessageRepository.findById(params.client, ref.sourceMessageId)
      if (!sourceMessage) {
        throw new HttpError("Source message not found", {
          status: 400,
          code: "SHARE_SOURCE_MESSAGE_NOT_FOUND",
        })
      }
      if (sourceMessage.streamId !== ref.sourceStreamId) {
        throw new HttpError("Source message does not belong to the referenced stream", {
          status: 400,
          code: "SHARE_SOURCE_STREAM_MISMATCH",
        })
      }

      const sourceStream = await params.findStream(params.client, ref.sourceStreamId)
      if (!sourceStream) {
        throw new HttpError("Source stream not found", {
          status: 400,
          code: "SHARE_SOURCE_STREAM_NOT_FOUND",
        })
      }
      if (sourceStream.workspaceId !== params.workspaceId) {
        throw new HttpError("Cannot share across workspaces", {
          status: 400,
          code: "SHARE_CROSS_WORKSPACE_FORBIDDEN",
        })
      }

      const boundary = await crossesPrivacyBoundary(
        params.client,
        params.findStream,
        params.isAncestor,
        params.countExposedMembers,
        ref.sourceStreamId,
        params.targetStreamId
      )
      if (boundary.triggered && !params.confirmedPrivacyWarning) {
        throw new HttpError("Privacy confirmation required to share this message", {
          status: 409,
          code: "SHARE_PRIVACY_CONFIRMATION_REQUIRED",
        })
      }

      await SharedMessageRepository.insert(params.client, {
        id: sharedMessageId(),
        workspaceId: params.workspaceId,
        shareMessageId: params.shareMessageId,
        sourceMessageId: ref.sourceMessageId,
        sourceStreamId: ref.sourceStreamId,
        targetStreamId: params.targetStreamId,
        flavor: ref.flavor,
        createdBy: params.sharerId,
      })
    }
  },
}
