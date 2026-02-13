import type { Pool } from "pg"
import type { ModelMessage } from "ai"
import type { UserPreferences } from "@threa/types"
import { AgentTriggers, StreamTypes, AuthorTypes } from "@threa/types"
import type { UserPreferencesService } from "../../user-preferences"
import { MessageRepository, type Message } from "../../messaging"
import { MemberRepository } from "../../workspaces"
import { PersonaRepository } from "../persona-repository"
import type { Persona } from "../persona-repository"
import { AttachmentRepository } from "../../attachments"
import { StreamMemberRepository, type Stream } from "../../streams"
import { awaitAttachmentProcessing } from "../../attachments"
import { buildStreamContext, type StreamContext } from "../context-builder"
import type { ConversationSummaryService } from "../conversation-summary-service"
import { buildSystemPrompt } from "./prompt/system-prompt"
import { formatMessagesWithTemporal } from "./prompt/message-format"
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
  invokingMemberId: string | undefined
  preferences: UserPreferences | undefined
  authorNames: Map<string, string>
  dmParticipantIds: string[] | undefined
  streamContext: StreamContext
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
  const invokingMemberId = triggerMessage?.authorType === AuthorTypes.MEMBER ? triggerMessage.authorId : undefined

  let preferences: UserPreferences | undefined
  if (invokingMemberId) {
    preferences = await userPreferencesService.getPreferences(workspaceId, invokingMemberId)
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

  // Build author names from participants + repo lookups
  const authorNames = new Map<string, string>()
  if (streamContext.participants) {
    for (const p of streamContext.participants) {
      authorNames.set(p.id, p.name)
    }
  }

  const memberAuthorIds = [
    ...new Set(
      streamContext.conversationHistory
        .filter((m) => m.authorType === AuthorTypes.MEMBER && !authorNames.has(m.authorId))
        .map((m) => m.authorId)
    ),
  ]
  if (memberAuthorIds.length > 0) {
    const members = await MemberRepository.findByIds(db, memberAuthorIds)
    for (const m of members) authorNames.set(m.id, m.name)
  }

  const personaAuthorIds = [
    ...new Set(
      streamContext.conversationHistory.filter((m) => m.authorType === AuthorTypes.PERSONA).map((m) => m.authorId)
    ),
  ]
  if (personaAuthorIds.length > 0) {
    const personas = await PersonaRepository.findByIds(db, personaAuthorIds)
    for (const p of personas) authorNames.set(p.id, p.name)
  }

  let mentionerName: string | undefined
  if (trigger === AgentTriggers.MENTION && triggerMessage?.authorType === AuthorTypes.MEMBER) {
    const mentioner = await MemberRepository.findById(db, triggerMessage.authorId)
    mentionerName = mentioner?.name ?? undefined
  }

  let dmParticipantIds: string[] | undefined
  if (stream.type === StreamTypes.DM) {
    const members = await StreamMemberRepository.list(db, { streamId })
    dmParticipantIds = members.map((m) => m.memberId)
  }

  const systemPrompt = buildSystemPrompt(
    persona,
    streamContext,
    trigger,
    mentionerName,
    rollingConversationSummary,
    invokingMemberId !== undefined
  )

  const messages = formatMessagesWithTemporal(streamContext.conversationHistory, streamContext)

  return {
    systemPrompt,
    messages,
    triggerMessage,
    invokingMemberId,
    preferences,
    authorNames,
    dmParticipantIds,
    streamContext,
  }
}
