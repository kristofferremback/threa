import type { Stream, StreamEvent } from "@threa/types"

export interface AttachmentSummary {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
}

export interface CreateOptimisticBootstrapParams {
  stream: Stream
  message: {
    id: string
    createdAt: string
  }
  content: string
  contentFormat: "markdown" | "plaintext"
  attachments?: AttachmentSummary[]
}

export interface OptimisticBootstrap {
  stream: Stream
  events: StreamEvent[]
  members: []
  membership: null
  latestSequence: string
}

/**
 * Creates an optimistic bootstrap cache for a newly created stream.
 * Used when promoting drafts (scratchpads or threads) to real streams
 * to enable instant navigation without waiting for server fetch.
 */
export function createOptimisticBootstrap({
  stream,
  message,
  content,
  contentFormat,
  attachments,
}: CreateOptimisticBootstrapParams): OptimisticBootstrap {
  const event: StreamEvent = {
    id: message.id,
    streamId: stream.id,
    sequence: "1",
    eventType: "message_created",
    payload: {
      messageId: message.id,
      content,
      contentFormat,
      ...(attachments && attachments.length > 0 && { attachments }),
    },
    actorId: stream.createdBy,
    actorType: "user",
    createdAt: message.createdAt,
  }

  return {
    stream,
    events: [event],
    members: [],
    membership: null,
    latestSequence: "1",
  }
}
