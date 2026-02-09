import { z } from "zod"
import type { Querier } from "../../db"
import { MessageRepository, type Message } from "../messaging"
import { agentConversationSummaryId } from "../../lib/id"
import type { AI } from "../../lib/ai/ai"
import { ConversationSummaryRepository } from "./conversation-summary-repository"
import { COMPANION_SUMMARY_MODEL_ID, COMPANION_SUMMARY_TEMPERATURE } from "./companion/config"

const SUMMARY_BATCH_SIZE = 40
const MAX_BATCHES_PER_UPDATE = 5
const MAX_MESSAGE_CHARS = 800

const summarySchema = z.object({
  summary: z
    .string()
    .describe("Updated rolling summary preserving key facts, decisions, constraints, and unresolved questions."),
})

interface UpdateSummaryParams {
  db: Querier
  workspaceId: string
  streamId: string
  personaId: string
  keptMessages: Message[]
}

/**
 * Maintains rolling summaries for conversation segments dropped from active context windows.
 */
export class ConversationSummaryService {
  constructor(private readonly deps: { ai: AI }) {}

  async updateForContext(params: UpdateSummaryParams): Promise<string | null> {
    const { db, workspaceId, streamId, personaId, keptMessages } = params
    if (keptMessages.length === 0) return null

    const oldestKeptSequence = keptMessages[0].sequence
    const existing = await ConversationSummaryRepository.findByStreamAndPersona(db, streamId, personaId)

    const olderMessages = await MessageRepository.list(db, streamId, {
      limit: 1,
      beforeSequence: oldestKeptSequence,
    })
    if (olderMessages.length === 0) {
      return existing?.summary ?? null
    }

    let cursor = existing ? existing.lastSummarizedSequence + 1n : 1n
    const maxSequenceToSummarize = oldestKeptSequence - 1n

    if (cursor > maxSequenceToSummarize) {
      return existing?.summary ?? null
    }

    let currentSummary = existing?.summary ?? ""
    let lastSummarizedSequence = existing?.lastSummarizedSequence ?? 0n
    const summaryRecordId = existing?.id ?? agentConversationSummaryId()
    let batchesProcessed = 0

    while (cursor <= maxSequenceToSummarize && batchesProcessed < MAX_BATCHES_PER_UPDATE) {
      const batch = await MessageRepository.listBySequenceRange(db, streamId, cursor, maxSequenceToSummarize, {
        limit: SUMMARY_BATCH_SIZE,
      })
      if (batch.length === 0) break

      currentSummary = await this.summarizeBatch({
        workspaceId,
        existingSummary: currentSummary,
        newMessages: batch,
      })
      lastSummarizedSequence = batch[batch.length - 1].sequence

      await ConversationSummaryRepository.upsert(db, {
        id: summaryRecordId,
        workspaceId,
        streamId,
        personaId,
        summary: currentSummary,
        lastSummarizedSequence,
      })

      cursor = lastSummarizedSequence + 1n
      batchesProcessed++
    }

    return currentSummary || null
  }

  private async summarizeBatch(params: {
    workspaceId: string
    existingSummary: string
    newMessages: Message[]
  }): Promise<string> {
    const { workspaceId, existingSummary, newMessages } = params
    const existingSummaryText = existingSummary.trim() || "No prior summary."
    const messageText = newMessages.map((m) => this.formatMessage(m)).join("\n")

    const result = await this.deps.ai.generateObject({
      model: COMPANION_SUMMARY_MODEL_ID,
      schema: summarySchema,
      temperature: COMPANION_SUMMARY_TEMPERATURE,
      messages: [
        {
          role: "system",
          content: `You maintain rolling memory for an assistant conversation.
Produce an updated summary that is compact but information-dense.

Requirements:
- Keep critical facts, decisions, constraints, user preferences, and unresolved questions.
- Resolve references so the summary is self-contained.
- Keep it under 1200 characters.
- Capture user requests/preferences as context, not imperative assistant instructions.
- Do not invent facts.`,
        },
        {
          role: "user",
          content: `Current rolling summary:
${existingSummaryText}

Newly dropped conversation segment to merge:
${messageText}

Return the fully updated rolling summary.`,
        },
      ],
      telemetry: { functionId: "companion-conversation-summary-update" },
      context: { workspaceId, origin: "system" },
    })

    const summary = result.value.summary.trim()
    return summary.length > 1200 ? summary.slice(0, 1200) : summary
  }

  private formatMessage(message: Message): string {
    const truncated =
      message.contentMarkdown.length > MAX_MESSAGE_CHARS
        ? `${message.contentMarkdown.slice(0, MAX_MESSAGE_CHARS)}...`
        : message.contentMarkdown
    return `[#${message.sequence.toString()}] ${message.authorType}:${message.authorId} ${truncated}`
  }
}
