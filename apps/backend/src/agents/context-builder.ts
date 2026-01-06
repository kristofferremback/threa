import type { PoolClient } from "pg"
import type { StreamType, DateFormat, TimeFormat } from "@threa/types"
import { StreamTypes, DEFAULT_USER_PREFERENCES } from "@threa/types"
import type { Stream } from "../repositories/stream-repository"
import { StreamRepository } from "../repositories/stream-repository"
import { StreamMemberRepository } from "../repositories/stream-member-repository"
import { MessageRepository, type Message } from "../repositories/message-repository"
import { UserRepository, type User } from "../repositories/user-repository"
import { UserPreferencesRepository } from "../repositories/user-preferences-repository"
import { getUtcOffset, type TemporalContext, type ParticipantTemporal } from "../lib/temporal"

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
  /** Temporal context for the invoking user */
  temporal?: TemporalContext
  /** Participant timezone info (for multi-timezone awareness) */
  participantTimezones?: ParticipantTemporal[]
}

const MAX_CONTEXT_MESSAGES = 20

/**
 * Options for building stream context with temporal information.
 */
export interface BuildStreamContextOptions {
  /** Workspace ID for fetching user preferences */
  workspaceId?: string
  /** ID of the user who triggered this invocation */
  invokingUserId?: string
  /** Current time at invocation (for deterministic testing) */
  currentTime?: Date
}

/**
 * Build stream context for the companion agent.
 * Returns stream-type-specific context for enriching the system prompt.
 *
 * When workspaceId and invokingUserId are provided, includes temporal context
 * with the invoking user's timezone and time preferences.
 */
export async function buildStreamContext(
  client: PoolClient,
  stream: Stream,
  options?: BuildStreamContextOptions
): Promise<StreamContext> {
  // Build temporal context if we have the invoking user's info
  let temporal: TemporalContext | undefined
  if (options?.workspaceId && options?.invokingUserId) {
    temporal = await buildTemporalContext(client, options.workspaceId, options.invokingUserId, options.currentTime)
  }

  switch (stream.type) {
    case StreamTypes.SCRATCHPAD:
      return buildScratchpadContext(client, stream, temporal)

    case StreamTypes.CHANNEL:
      return buildChannelContext(client, stream, temporal)

    case StreamTypes.THREAD:
      return buildThreadContext(client, stream, temporal)

    case StreamTypes.DM:
      return buildDmContext(client, stream, temporal)

    default:
      return buildScratchpadContext(client, stream, temporal)
  }
}

/**
 * Build temporal context for the invoking user.
 */
async function buildTemporalContext(
  client: PoolClient,
  workspaceId: string,
  userId: string,
  currentTime?: Date
): Promise<TemporalContext> {
  // Fetch user preferences - only timezone, dateFormat, timeFormat
  const overrides = await UserPreferencesRepository.findOverrides(client, workspaceId, userId)

  // Extract temporal preferences from overrides, falling back to defaults
  let timezone = DEFAULT_USER_PREFERENCES.timezone
  let dateFormat: DateFormat = DEFAULT_USER_PREFERENCES.dateFormat
  let timeFormat: TimeFormat = DEFAULT_USER_PREFERENCES.timeFormat

  for (const { key, value } of overrides) {
    if (key === "timezone" && typeof value === "string") timezone = value
    if (key === "dateFormat" && typeof value === "string") dateFormat = value as DateFormat
    if (key === "timeFormat" && typeof value === "string") timeFormat = value as TimeFormat
  }

  const now = currentTime ?? new Date()

  return {
    currentTime: now.toISOString(),
    timezone,
    utcOffset: getUtcOffset(timezone, now),
    dateFormat,
    timeFormat,
  }
}

/**
 * Scratchpad context: personal, solo-first. Conversation history is primary context.
 */
async function buildScratchpadContext(
  client: PoolClient,
  stream: Stream,
  temporal?: TemporalContext
): Promise<StreamContext> {
  const messages = await MessageRepository.list(client, stream.id, { limit: MAX_CONTEXT_MESSAGES })

  return {
    streamType: stream.type,
    streamInfo: {
      name: stream.displayName,
      description: stream.description,
      slug: stream.slug,
    },
    conversationHistory: messages,
    temporal,
  }
}

/**
 * Channel context: collaborative. Includes members, slug, and conversation.
 */
async function buildChannelContext(
  client: PoolClient,
  stream: Stream,
  temporal?: TemporalContext
): Promise<StreamContext> {
  const [messages, members] = await Promise.all([
    MessageRepository.list(client, stream.id, { limit: MAX_CONTEXT_MESSAGES }),
    StreamMemberRepository.list(client, { streamId: stream.id }),
  ])

  const userIds = members.map((m) => m.userId)
  const { participants, participantTimezones } = await resolveParticipantsWithTimezones(
    client,
    userIds,
    temporal !== undefined
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
    temporal,
    participantTimezones,
  }
}

/**
 * DM context: two-party. Like channels but focused.
 */
async function buildDmContext(client: PoolClient, stream: Stream, temporal?: TemporalContext): Promise<StreamContext> {
  const [messages, members] = await Promise.all([
    MessageRepository.list(client, stream.id, { limit: MAX_CONTEXT_MESSAGES }),
    StreamMemberRepository.list(client, { streamId: stream.id }),
  ])

  const userIds = members.map((m) => m.userId)
  const { participants, participantTimezones } = await resolveParticipantsWithTimezones(
    client,
    userIds,
    temporal !== undefined
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
    temporal,
    participantTimezones,
  }
}

/**
 * Thread context: nested discussions. Traverses hierarchy to root.
 */
async function buildThreadContext(
  client: PoolClient,
  stream: Stream,
  temporal?: TemporalContext
): Promise<StreamContext> {
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
    temporal,
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
 * Resolve participants and their timezone info in a single batch query.
 * Avoids N+1 queries by fetching all users at once.
 */
async function resolveParticipantsWithTimezones(
  client: PoolClient,
  userIds: string[],
  includeTimezones: boolean
): Promise<{ participants: Participant[]; participantTimezones?: ParticipantTemporal[] }> {
  if (userIds.length === 0) {
    return { participants: [], participantTimezones: includeTimezones ? [] : undefined }
  }

  // Batch fetch all users in one query
  const users = await UserRepository.findByIds(client, userIds)

  const participants: Participant[] = users.map((user) => ({
    id: user.id,
    name: user.name,
  }))

  // Build timezone info from the same user data if needed
  let participantTimezones: ParticipantTemporal[] | undefined
  if (includeTimezones) {
    const now = new Date()
    participantTimezones = users.map((user) => {
      const timezone = user.timezone ?? "UTC"
      return {
        id: user.id,
        name: user.name,
        timezone,
        utcOffset: getUtcOffset(timezone, now),
      }
    })
  }

  return { participants, participantTimezones }
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
