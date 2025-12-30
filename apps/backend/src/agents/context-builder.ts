import type { PoolClient } from "pg"
import type { StreamType } from "@threa/types"
import { StreamTypes } from "@threa/types"
import type { Stream } from "../repositories/stream-repository"
import { StreamRepository } from "../repositories/stream-repository"
import { StreamMemberRepository } from "../repositories/stream-member-repository"
import { MessageRepository, type Message } from "../repositories/message-repository"
import { UserRepository, type User } from "../repositories/user-repository"

/**
 * A participant in a stream (user or persona).
 */
export interface Participant {
  id: string
  name: string
  role?: string
}

/**
 * Info about a message in the thread hierarchy.
 */
export interface AnchorMessage {
  id: string
  content: string
  authorName: string
}

/**
 * Position in thread hierarchy for nested threads.
 */
export interface ThreadPathEntry {
  streamId: string
  displayName: string | null
  anchorMessage: AnchorMessage | null
}

/**
 * Context about the stream for the companion agent.
 * Different stream types populate different fields.
 */
export interface StreamContext {
  streamType: StreamType
  streamInfo: {
    name: string | null
    description: string | null
    slug: string | null
  }
  /** Participants in the stream (for channels, DMs). Scratchpads don't need this. */
  participants?: Participant[]
  /** Conversation history - messages in chronological order */
  conversationHistory: Message[]
  /** For threads: path from current thread up to root channel */
  threadContext?: {
    depth: number
    path: ThreadPathEntry[]
  }
}

const MAX_CONTEXT_MESSAGES = 20

/**
 * Build stream context for the companion agent.
 * Returns stream-type-specific context for enriching the system prompt.
 */
export async function buildStreamContext(client: PoolClient, stream: Stream): Promise<StreamContext> {
  switch (stream.type) {
    case StreamTypes.SCRATCHPAD:
      return buildScratchpadContext(client, stream)

    case StreamTypes.CHANNEL:
      return buildChannelContext(client, stream)

    case StreamTypes.THREAD:
      return buildThreadContext(client, stream)

    case StreamTypes.DM:
      return buildDmContext(client, stream)

    default:
      return buildScratchpadContext(client, stream)
  }
}

/**
 * Scratchpad context: personal, solo-first. Conversation history is primary context.
 */
async function buildScratchpadContext(client: PoolClient, stream: Stream): Promise<StreamContext> {
  const messages = await MessageRepository.list(client, stream.id, { limit: MAX_CONTEXT_MESSAGES })

  return {
    streamType: stream.type,
    streamInfo: {
      name: stream.displayName,
      description: stream.description,
      slug: stream.slug,
    },
    conversationHistory: messages,
  }
}

/**
 * Channel context: collaborative. Includes members, slug, and conversation.
 */
async function buildChannelContext(client: PoolClient, stream: Stream): Promise<StreamContext> {
  const [messages, members] = await Promise.all([
    MessageRepository.list(client, stream.id, { limit: MAX_CONTEXT_MESSAGES }),
    StreamMemberRepository.list(client, { streamId: stream.id }),
  ])

  const participants = await resolveParticipants(
    client,
    members.map((m) => m.userId)
  )

  return {
    streamType: stream.type,
    streamInfo: {
      name: stream.displayName,
      description: stream.description,
      slug: stream.slug,
    },
    participants,
    conversationHistory: messages,
  }
}

/**
 * DM context: two-party. Like channels but focused.
 */
async function buildDmContext(client: PoolClient, stream: Stream): Promise<StreamContext> {
  const [messages, members] = await Promise.all([
    MessageRepository.list(client, stream.id, { limit: MAX_CONTEXT_MESSAGES }),
    StreamMemberRepository.list(client, { streamId: stream.id }),
  ])

  const participants = await resolveParticipants(
    client,
    members.map((m) => m.userId)
  )

  return {
    streamType: stream.type,
    streamInfo: {
      name: stream.displayName,
      description: stream.description,
      slug: stream.slug,
    },
    participants,
    conversationHistory: messages,
  }
}

/**
 * Thread context: nested discussions. Traverses hierarchy to root.
 */
async function buildThreadContext(client: PoolClient, stream: Stream): Promise<StreamContext> {
  const messages = await MessageRepository.list(client, stream.id, { limit: MAX_CONTEXT_MESSAGES })

  // Build thread path from current thread up to root
  const threadPath = await buildThreadPath(client, stream)

  return {
    streamType: stream.type,
    streamInfo: {
      name: stream.displayName,
      description: stream.description,
      slug: stream.slug,
    },
    conversationHistory: messages,
    threadContext: {
      depth: threadPath.length,
      path: threadPath,
    },
  }
}

/**
 * Build the path from a thread up to its root (channel/scratchpad).
 * Returns entries in order from root to current thread.
 */
async function buildThreadPath(client: PoolClient, stream: Stream): Promise<ThreadPathEntry[]> {
  const path: ThreadPathEntry[] = []
  let current: Stream | null = stream

  while (current) {
    let anchorMessage: AnchorMessage | null = null

    // If this is a thread spawned from a message, get that message
    if (current.parentMessageId) {
      const message = await MessageRepository.findById(client, current.parentMessageId)
      if (message) {
        const authorName = await resolveAuthorName(client, message.authorId, message.authorType)
        anchorMessage = {
          id: message.id,
          content: message.content.slice(0, 200), // Truncate for context
          authorName,
        }
      }
    }

    path.unshift({
      streamId: current.id,
      displayName: current.displayName,
      anchorMessage,
    })

    // Traverse up
    if (current.parentStreamId) {
      current = await StreamRepository.findById(client, current.parentStreamId)
    } else {
      current = null
    }
  }

  return path
}

/**
 * Resolve user IDs to participant info.
 */
async function resolveParticipants(client: PoolClient, userIds: string[]): Promise<Participant[]> {
  const participants: Participant[] = []

  for (const userId of userIds) {
    const user = await UserRepository.findById(client, userId)
    if (user) {
      participants.push({
        id: user.id,
        name: user.name,
      })
    }
  }

  return participants
}

/**
 * Resolve author name for a message.
 */
async function resolveAuthorName(
  client: PoolClient,
  authorId: string,
  authorType: "user" | "persona"
): Promise<string> {
  if (authorType === "user") {
    const user = await UserRepository.findById(client, authorId)
    return user?.name ?? "Unknown"
  }

  // For personas, we'd need to look up the persona
  // For now, return a placeholder
  return "Assistant"
}
