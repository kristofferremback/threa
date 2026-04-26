import type { Pool } from "pg"
import type { ModelMessage } from "ai"
import type { UserPreferences } from "@threa/types"
import { AgentTriggers, AuthorTypes, StreamTypes } from "@threa/types"
import type { UserPreferencesService } from "../../user-preferences"
import { MessageRepository, type Message } from "../../messaging"
import { UserRepository } from "../../workspaces"
import type { Persona } from "../persona-repository"
import { resolveActorNames } from "../actor-names"
import { AttachmentRepository } from "../../attachments"
import { StreamRepository, type Stream } from "../../streams"
import { awaitAttachmentProcessing } from "../../attachments"
import { buildStreamContext, type StreamContext } from "../context-builder"
import type { ConversationSummaryService } from "../conversation-summary-service"
import { buildSystemPrompt } from "./prompt/system-prompt"
import { formatMessagesWithTemporal } from "./prompt/message-format"
import { resolveQuoteReplies, renderMessageWithQuoteContext, DEFAULT_MAX_QUOTE_DEPTH } from "../quote-resolver"
import { computeAgentAccessSpec } from "../researcher/access-spec"
import { SearchRepository } from "../../search"
import { logger } from "../../../lib/logger"

export interface ContextDeps {
  db: Pool
  userPreferencesService: UserPreferencesService
  conversationSummaryService: ConversationSummaryService
}

export interface ContextParams {
  workspaceId: string
  streamId: string
  stream: Stream
  messageId: string
  persona: Persona
  trigger?: typeof AgentTriggers.MENTION
}

export interface AgentContext {
  systemPrompt: string
  messages: ModelMessage[]
  triggerMessage: Message | null
  invokingUserId: string | undefined
  preferences: UserPreferences | undefined
  authorNames: Map<string, string>
  streamContext: StreamContext
  /**
   * Streams the invoking user can read. Used for access-scoped quote-reply
   * resolution and downstream workspace tools. `null` when there is no
   * invoking user (bot-initiated turn) — downstream consumers should treat
   * that as "no workspace access" or "current stream only" per their own
   * semantics.
   */
  accessibleStreamIds: Set<string> | null
}

async function resolveScratchpadCustomPrompt(
  db: Pool,
  stream: Stream,
  preferences: UserPreferences | undefined
): Promise<string | null> {
  const customPrompt = preferences?.scratchpadCustomPrompt?.trim()
  if (!customPrompt) {
    return null
  }

  if (stream.type === StreamTypes.SCRATCHPAD) {
    return customPrompt
  }

  if (stream.type !== StreamTypes.THREAD || !stream.rootStreamId) {
    return null
  }

  const rootStream = await StreamRepository.findById(db, stream.rootStreamId)
  return rootStream?.type === StreamTypes.SCRATCHPAD ? customPrompt : null
}

/**
 * Assemble all context the companion agent needs before entering the agent loop.
 * Fetches trigger message, builds stream context, resolves author names,
 * creates system prompt, and formats messages as ModelMessage[].
 */
export async function buildAgentContext(deps: ContextDeps, params: ContextParams): Promise<AgentContext> {
  const { db, userPreferencesService, conversationSummaryService } = deps
  const { workspaceId, streamId, stream, messageId, persona, trigger } = params

  const triggerMessage = await MessageRepository.findById(db, messageId)
  const invokingUserId = triggerMessage?.authorType === AuthorTypes.USER ? triggerMessage.authorId : undefined

  let preferences: UserPreferences | undefined
  if (invokingUserId) {
    preferences = await userPreferencesService.getPreferences(workspaceId, invokingUserId)
  }

  // Await attachment processing for trigger message so agent can access extracted content
  if (triggerMessage) {
    const triggerAttachments = await AttachmentRepository.findByMessageId(db, messageId)
    const attachmentIds = triggerAttachments.map((a) => a.id)
    if (attachmentIds.length > 0) {
      logger.info(
        { messageId, attachmentCount: attachmentIds.length },
        "Awaiting attachment processing for trigger message"
      )
      const awaitResult = await awaitAttachmentProcessing(db, attachmentIds)
      logger.info(
        {
          messageId,
          completedCount: awaitResult.completedIds.length,
          failedCount: awaitResult.failedOrTimedOutIds.length,
        },
        "Attachment processing await completed"
      )
    }
  }

  // Compute accessible streams once, here — used by both quote-reply resolution
  // below and by the workspace-tool deps wiring in persona-agent.ts. Bot turns
  // (no invoking user) get `null`; downstream consumers decide how to treat it.
  let accessibleStreamIds: Set<string> | null = null
  if (invokingUserId) {
    const accessSpec = await computeAgentAccessSpec(db, { stream, invokingUserId })
    const ids = await SearchRepository.getAccessibleStreamsForAgent(db, accessSpec, workspaceId)
    accessibleStreamIds = new Set(ids)
  }

  const streamContext = await buildStreamContext(db, stream, {
    preferences,
    triggerMessageId: messageId,
    includeAttachments: true,
  })

  const streamScopedMessages = streamContext.conversationHistory.filter((m) => m.streamId === stream.id)
  const rollingConversationSummary = await conversationSummaryService.updateForContext({
    db,
    workspaceId,
    streamId: stream.id,
    personaId: persona.id,
    keptMessages: streamScopedMessages,
  })

  // Build author names from participants + a single batched user+persona lookup.
  // `resolveActorNames` handles the user/persona split (INV-56: batched, never
  // per-row) so we don't reimplement it inline per surface.
  const authorNames = new Map<string, string>()
  if (streamContext.participants) {
    for (const p of streamContext.participants) {
      authorNames.set(p.id, p.name)
    }
  }

  const missingAuthorIds = streamContext.conversationHistory
    .filter((m) => !authorNames.has(m.authorId))
    .map((m) => m.authorId)
  const resolvedNames = await resolveActorNames(db, workspaceId, missingAuthorIds)
  for (const [id, name] of resolvedNames) authorNames.set(id, name)

  let mentionerName: string | undefined
  if (trigger === AgentTriggers.MENTION && triggerMessage?.authorType === AuthorTypes.USER) {
    const mentioner = await UserRepository.findById(db, workspaceId, triggerMessage.authorId)
    mentionerName = mentioner?.name ?? undefined
  }

  // Resolve quote-reply precursors referenced from the conversation history and
  // expand each message's contentMarkdown inline with `<quoted-source>` blocks
  // so the model sees the full source of anything that was quoted, not just
  // the snippet. Bot turns fall back to "current stream only" to avoid leaking
  // cross-stream content when there is no invoking user to gate access.
  const quoteAccessibleStreamIds = accessibleStreamIds ?? new Set([stream.id])
  const { resolved: resolvedQuotes, authorNames: quotedAuthorNames } = await resolveQuoteReplies(db, workspaceId, {
    seedMessages: streamContext.conversationHistory,
    accessibleStreamIds: quoteAccessibleStreamIds,
  })
  for (const [id, name] of quotedAuthorNames) {
    if (!authorNames.has(id)) authorNames.set(id, name)
  }
  if (resolvedQuotes.size > 0) {
    streamContext.conversationHistory = streamContext.conversationHistory.map((m) => {
      const expanded = renderMessageWithQuoteContext(m, resolvedQuotes, authorNames, 0, DEFAULT_MAX_QUOTE_DEPTH)
      if (expanded === m.contentMarkdown) return m
      return { ...m, contentMarkdown: expanded }
    })
  }

  const scratchpadCustomPrompt = await resolveScratchpadCustomPrompt(db, stream, preferences)

  const systemPrompt = buildSystemPrompt(
    persona,
    streamContext,
    scratchpadCustomPrompt,
    trigger,
    mentionerName,
    rollingConversationSummary,
    invokingUserId !== undefined
  )

  const messages = formatMessagesWithTemporal(streamContext.conversationHistory, streamContext)

  return {
    systemPrompt,
    messages,
    triggerMessage,
    invokingUserId,
    preferences,
    authorNames,
    streamContext,
    accessibleStreamIds,
  }
}
