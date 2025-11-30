import { Pool } from "pg"
import { sql } from "../lib/db"
import { logger } from "../lib/logger"
import { memoId, retrievalLogId, expertiseSignalId } from "../lib/id"
import { generateEmbedding } from "../lib/ai-providers"
import { getMemoEmbeddingTable } from "../lib/embedding-tables"
import { generateAutoName } from "../lib/ollama"

/**
 * MemoService - Manages memos in the GAM-inspired memory system.
 *
 * Memos are lightweight pointers to valuable conversations. They don't contain
 * the full content - instead they summarize what can be found and link to the
 * source messages. Ariadne retrieves the actual conversations at query time.
 */
export class MemoService {
  private embeddingTable: string

  constructor(private pool: Pool) {
    this.embeddingTable = getMemoEmbeddingTable()
  }

  // ==========================================================================
  // Memo CRUD
  // ==========================================================================

  /**
   * Create a new memo from an anchor event (or set of anchor events).
   */
  async createMemo(params: CreateMemoParams): Promise<Memo> {
    const id = memoId()

    // Generate summary if not provided
    let summary = params.summary
    if (!summary && params.anchorEventIds.length > 0) {
      const content = await this.getContentForEvents(params.anchorEventIds)
      if (content) {
        const nameResult = await generateAutoName(content.slice(0, 2000))
        summary = nameResult.success ? nameResult.name : "Conversation"
      } else {
        summary = "Conversation"
      }
    }

    // Extract topics from summary if not provided
    const topics = params.topics || []

    // Get context window from anchor events
    const contextWindow = await this.getContextWindow(params.anchorEventIds)

    // Get participants from the context
    const participants = await this.getParticipants(params.streamId, contextWindow.startEventId, contextWindow.endEventId)

    // Determine visibility from source stream
    const visibility = await this.getVisibilityFromStream(params.streamId)

    // Insert the memo
    await this.pool.query(
      sql`INSERT INTO memos (
        id, workspace_id, summary, topics,
        anchor_event_ids, context_stream_id,
        context_start_event_id, context_end_event_id,
        participant_ids, primary_answerer_id,
        confidence, source, created_by, visibility,
        visible_to_stream_ids
      ) VALUES (
        ${id}, ${params.workspaceId}, ${summary}, ${topics},
        ${params.anchorEventIds}, ${params.streamId},
        ${contextWindow.startEventId}, ${contextWindow.endEventId},
        ${participants.ids}, ${participants.primaryAnswerer},
        ${params.confidence ?? 0.5}, ${params.source}, ${params.createdBy || null},
        ${visibility.type}, ${visibility.streamIds}
      )`,
    )

    // Generate and store embedding
    if (summary) {
      const embeddingResult = await generateEmbedding(summary + " " + topics.join(" "))
      await this.pool.query(
        sql`INSERT INTO ${sql.raw(this.embeddingTable)} (memo_id, embedding, model)
          VALUES (${id}, ${JSON.stringify(embeddingResult.embedding)}::vector, ${embeddingResult.model})`,
      )
    }

    const memo = await this.getMemo(id)
    if (!memo) {
      throw new Error("Failed to create memo")
    }

    logger.info({ memoId: id, workspaceId: params.workspaceId, source: params.source }, "Memo created")
    return memo
  }

  /**
   * Get a memo by ID.
   */
  async getMemo(id: string): Promise<Memo | null> {
    const result = await this.pool.query<MemoRow>(
      sql`SELECT * FROM memos WHERE id = ${id}`,
    )
    return result.rows[0] ? this.mapMemoRow(result.rows[0]) : null
  }

  /**
   * Get memos for a workspace.
   */
  async getMemos(
    workspaceId: string,
    options: { limit?: number; offset?: number; topics?: string[] } = {},
  ): Promise<Memo[]> {
    const limit = options.limit ?? 50
    const offset = options.offset ?? 0

    // Use separate queries since squid/pg sql tags can't be composed
    const result = options.topics && options.topics.length > 0
      ? await this.pool.query<MemoRow>(
          sql`SELECT * FROM memos
            WHERE workspace_id = ${workspaceId}
              AND archived_at IS NULL
              AND topics && ${options.topics}
            ORDER BY confidence DESC, created_at DESC
            LIMIT ${limit} OFFSET ${offset}`,
        )
      : await this.pool.query<MemoRow>(
          sql`SELECT * FROM memos
            WHERE workspace_id = ${workspaceId}
              AND archived_at IS NULL
            ORDER BY confidence DESC, created_at DESC
            LIMIT ${limit} OFFSET ${offset}`,
        )

    return result.rows.map(this.mapMemoRow)
  }

  /**
   * Update a memo.
   */
  async updateMemo(id: string, updates: Partial<Pick<Memo, "summary" | "topics" | "confidence">>): Promise<void> {
    const sets: string[] = []
    const values: unknown[] = []

    if (updates.summary !== undefined) {
      sets.push("summary = $" + (values.length + 1))
      values.push(updates.summary)
    }
    if (updates.topics !== undefined) {
      sets.push("topics = $" + (values.length + 1))
      values.push(updates.topics)
    }
    if (updates.confidence !== undefined) {
      sets.push("confidence = $" + (values.length + 1))
      values.push(updates.confidence)
    }

    if (sets.length === 0) return

    values.push(id)
    await this.pool.query(
      `UPDATE memos SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $${values.length}`,
      values,
    )

    // Re-embed if summary or topics changed
    if (updates.summary !== undefined || updates.topics !== undefined) {
      const memo = await this.getMemo(id)
      if (memo) {
        const embeddingResult = await generateEmbedding(memo.summary + " " + memo.topics.join(" "))
        await this.pool.query(
          sql`INSERT INTO ${sql.raw(this.embeddingTable)} (memo_id, embedding, model)
            VALUES (${id}, ${JSON.stringify(embeddingResult.embedding)}::vector, ${embeddingResult.model})
            ON CONFLICT (memo_id) DO UPDATE
            SET embedding = EXCLUDED.embedding, model = EXCLUDED.model, created_at = NOW()`,
        )
      }
    }

    logger.debug({ memoId: id, updates }, "Memo updated")
  }

  /**
   * Archive a memo (soft delete).
   */
  async archiveMemo(id: string): Promise<void> {
    await this.pool.query(
      sql`UPDATE memos SET archived_at = NOW(), updated_at = NOW() WHERE id = ${id}`,
    )
    logger.info({ memoId: id }, "Memo archived")
  }

  // ==========================================================================
  // Retrieval Logging
  // ==========================================================================

  /**
   * Log a retrieval event for evolution tracking.
   */
  async logRetrieval(params: LogRetrievalParams): Promise<string> {
    const id = retrievalLogId()

    await this.pool.query(
      sql`INSERT INTO retrieval_log (
        id, workspace_id, query, query_embedding,
        requester_type, requester_id,
        retrieved_memo_ids, retrieved_event_ids, retrieval_scores,
        session_id, response_event_id, iteration_count
      ) VALUES (
        ${id}, ${params.workspaceId}, ${params.query},
        ${params.queryEmbedding ? JSON.stringify(params.queryEmbedding) + "::vector" : null},
        ${params.requesterType}, ${params.requesterId || null},
        ${params.retrievedMemoIds || []}, ${params.retrievedEventIds || []},
        ${JSON.stringify(params.retrievalScores || {})},
        ${params.sessionId || null}, ${params.responseEventId || null},
        ${params.iterationCount ?? 1}
      )`,
    )

    // Update retrieval counts for memos
    if (params.retrievedMemoIds && params.retrievedMemoIds.length > 0) {
      await this.pool.query(
        sql`UPDATE memos
          SET retrieval_count = retrieval_count + 1,
              last_retrieved_at = NOW()
          WHERE id = ANY(${params.retrievedMemoIds})`,
      )
    }

    return id
  }

  /**
   * Record feedback for a retrieval.
   */
  async recordRetrievalFeedback(retrievalLogId: string, feedback: "positive" | "negative" | "neutral"): Promise<void> {
    await this.pool.query(
      sql`UPDATE retrieval_log
        SET user_feedback = ${feedback}, feedback_at = NOW()
        WHERE id = ${retrievalLogId}`,
    )

    logger.debug({ retrievalLogId, feedback }, "Retrieval feedback recorded")
  }

  // ==========================================================================
  // Expertise Signals
  // ==========================================================================

  /**
   * Record an expertise signal for a user on a topic.
   */
  async recordExpertiseSignal(params: RecordExpertiseParams): Promise<void> {
    const id = expertiseSignalId()

    await this.pool.query(
      sql`INSERT INTO expertise_signals (
        id, workspace_id, user_id, topic,
        questions_answered, answers_cited_by_ariadne,
        positive_reactions_received, answers_marked_helpful
      ) VALUES (
        ${id}, ${params.workspaceId}, ${params.userId}, ${params.topic},
        ${params.questionsAnswered ?? 0}, ${params.answersCitedByAriadne ?? 0},
        ${params.positiveReactionsReceived ?? 0}, ${params.answersMarkedHelpful ?? 0}
      )
      ON CONFLICT (workspace_id, user_id, topic) DO UPDATE SET
        questions_answered = expertise_signals.questions_answered + ${params.questionsAnswered ?? 0},
        answers_cited_by_ariadne = expertise_signals.answers_cited_by_ariadne + ${params.answersCitedByAriadne ?? 0},
        positive_reactions_received = expertise_signals.positive_reactions_received + ${params.positiveReactionsReceived ?? 0},
        answers_marked_helpful = expertise_signals.answers_marked_helpful + ${params.answersMarkedHelpful ?? 0},
        updated_at = NOW()`,
    )
  }

  /**
   * Get top experts for a topic.
   */
  async getExperts(
    workspaceId: string,
    topic: string,
    limit: number = 5,
  ): Promise<Array<{ userId: string; score: number }>> {
    const result = await this.pool.query<{ user_id: string; expertise_score: number }>(
      sql`SELECT user_id, expertise_score
        FROM expertise_signals
        WHERE workspace_id = ${workspaceId}
          AND topic = ${topic}
          AND expertise_score > 0
        ORDER BY expertise_score DESC
        LIMIT ${limit}`,
    )

    return result.rows.map((r) => ({
      userId: r.user_id,
      score: r.expertise_score,
    }))
  }

  // ==========================================================================
  // Auto-memo from Ariadne success
  // ==========================================================================

  /**
   * Create a memo from a successful Ariadne response.
   */
  async createFromAriadneSuccess(params: {
    workspaceId: string
    query: string
    citedEventIds: string[]
    responseEventId: string
    sessionId: string
    streamId: string
  }): Promise<Memo | null> {
    if (params.citedEventIds.length === 0) {
      return null
    }

    // Check if a similar memo already exists
    const existing = await this.findSimilarMemo(params.workspaceId, params.query)
    if (existing && existing.score > 0.85) {
      // Boost existing memo instead
      await this.boostMemoConfidence(existing.id, 0.05)
      logger.debug({ memoId: existing.id, query: params.query }, "Boosted existing memo instead of creating new")
      return existing
    }

    // Create new memo
    return this.createMemo({
      workspaceId: params.workspaceId,
      anchorEventIds: params.citedEventIds,
      streamId: params.streamId,
      source: "ariadne",
      summary: params.query, // Use the question as the summary
      confidence: 0.6, // Moderate confidence for auto-created
    })
  }

  /**
   * Find a similar memo by semantic search.
   */
  private async findSimilarMemo(workspaceId: string, query: string): Promise<(Memo & { score: number }) | null> {
    const embedding = await generateEmbedding(query)
    const embeddingJson = JSON.stringify(embedding.embedding)

    const result = await this.pool.query<MemoRow & { similarity: number }>(
      sql`SELECT m.*, 1 - (emb.embedding <=> ${embeddingJson}::vector) as similarity
        FROM memos m
        INNER JOIN ${sql.raw(this.embeddingTable)} emb ON emb.memo_id = m.id
        WHERE m.workspace_id = ${workspaceId}
          AND m.archived_at IS NULL
        ORDER BY emb.embedding <=> ${embeddingJson}::vector
        LIMIT 1`,
    )

    if (result.rows.length === 0) return null

    const row = result.rows[0]
    return {
      ...this.mapMemoRow(row),
      score: row.similarity,
    }
  }

  /**
   * Boost a memo's confidence (capped at 1.0).
   */
  private async boostMemoConfidence(memoId: string, amount: number): Promise<void> {
    await this.pool.query(
      sql`UPDATE memos
        SET confidence = LEAST(confidence + ${amount}, 1.0),
            updated_at = NOW()
        WHERE id = ${memoId}`,
    )
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private async getContentForEvents(eventIds: string[]): Promise<string | null> {
    if (eventIds.length === 0) return null

    const result = await this.pool.query<{ content: string }>(
      sql`SELECT tm.content
        FROM stream_events e
        JOIN text_messages tm ON e.content_id = tm.id AND e.content_type = 'text_message'
        WHERE e.id = ANY(${eventIds})
        ORDER BY e.created_at ASC`,
    )

    return result.rows.map((r) => r.content).join("\n\n")
  }

  private async getContextWindow(
    anchorEventIds: string[],
  ): Promise<{ startEventId: string | null; endEventId: string | null }> {
    if (anchorEventIds.length === 0) {
      return { startEventId: null, endEventId: null }
    }

    // Get the min and max events
    const result = await this.pool.query<{ min_id: string; max_id: string }>(
      sql`WITH anchor_events AS (
        SELECT id, created_at FROM stream_events WHERE id = ANY(${anchorEventIds})
      )
      SELECT
        (SELECT id FROM anchor_events ORDER BY created_at ASC LIMIT 1) as min_id,
        (SELECT id FROM anchor_events ORDER BY created_at DESC LIMIT 1) as max_id`,
    )

    return {
      startEventId: result.rows[0]?.min_id || null,
      endEventId: result.rows[0]?.max_id || null,
    }
  }

  private async getParticipants(
    streamId: string,
    startEventId: string | null,
    endEventId: string | null,
  ): Promise<{ ids: string[]; primaryAnswerer: string | null }> {
    // Get participants from the stream events in the window
    const result = await this.pool.query<{ actor_id: string; message_count: string }>(
      sql`SELECT actor_id, COUNT(*)::text as message_count
        FROM stream_events
        WHERE stream_id = ${streamId}
          AND actor_id IS NOT NULL
          AND deleted_at IS NULL
        GROUP BY actor_id
        ORDER BY message_count DESC`,
    )

    const ids = result.rows.map((r) => r.actor_id)
    const primaryAnswerer = ids.length > 0 ? ids[0] : null

    return { ids, primaryAnswerer }
  }

  private async getVisibilityFromStream(
    streamId: string,
  ): Promise<{ type: "workspace" | "channel" | "private"; streamIds: string[] }> {
    const result = await this.pool.query<{ visibility: string; stream_type: string }>(
      sql`SELECT visibility, stream_type FROM streams WHERE id = ${streamId}`,
    )

    if (result.rows.length === 0) {
      return { type: "workspace", streamIds: [] }
    }

    const { visibility, stream_type } = result.rows[0]

    if (visibility === "public") {
      return { type: "workspace", streamIds: [] }
    } else if (stream_type === "dm" || stream_type === "thinking_space") {
      return { type: "private", streamIds: [streamId] }
    } else {
      return { type: "channel", streamIds: [streamId] }
    }
  }

  private mapMemoRow(row: MemoRow): Memo {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      summary: row.summary,
      topics: row.topics || [],
      anchorEventIds: row.anchor_event_ids || [],
      contextStreamId: row.context_stream_id,
      contextStartEventId: row.context_start_event_id,
      contextEndEventId: row.context_end_event_id,
      participantIds: row.participant_ids || [],
      primaryAnswererId: row.primary_answerer_id,
      confidence: row.confidence,
      retrievalCount: row.retrieval_count,
      lastRetrievedAt: row.last_retrieved_at?.toISOString() || null,
      helpfulnessScore: row.helpfulness_score,
      source: row.source as "user" | "system" | "ariadne",
      createdBy: row.created_by,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      visibility: row.visibility as "workspace" | "channel" | "private",
      visibleToStreamIds: row.visible_to_stream_ids || [],
      archivedAt: row.archived_at?.toISOString() || null,
    }
  }
}

// ==========================================================================
// Types
// ==========================================================================

export interface Memo {
  id: string
  workspaceId: string
  summary: string
  topics: string[]
  anchorEventIds: string[]
  contextStreamId: string | null
  contextStartEventId: string | null
  contextEndEventId: string | null
  participantIds: string[]
  primaryAnswererId: string | null
  confidence: number
  retrievalCount: number
  lastRetrievedAt: string | null
  helpfulnessScore: number
  source: "user" | "system" | "ariadne"
  createdBy: string | null
  createdAt: string
  updatedAt: string
  visibility: "workspace" | "channel" | "private"
  visibleToStreamIds: string[]
  archivedAt: string | null
}

export interface CreateMemoParams {
  workspaceId: string
  anchorEventIds: string[]
  streamId: string
  source: "user" | "system" | "ariadne"
  createdBy?: string
  summary?: string
  topics?: string[]
  confidence?: number
}

export interface LogRetrievalParams {
  workspaceId: string
  query: string
  queryEmbedding?: number[]
  requesterType: "ariadne" | "user" | "system"
  requesterId?: string
  retrievedMemoIds?: string[]
  retrievedEventIds?: string[]
  retrievalScores?: Record<string, number>
  sessionId?: string
  responseEventId?: string
  iterationCount?: number
}

export interface RecordExpertiseParams {
  workspaceId: string
  userId: string
  topic: string
  questionsAnswered?: number
  answersCitedByAriadne?: number
  positiveReactionsReceived?: number
  answersMarkedHelpful?: number
}

interface MemoRow {
  id: string
  workspace_id: string
  summary: string
  topics: string[]
  anchor_event_ids: string[]
  context_stream_id: string | null
  context_start_event_id: string | null
  context_end_event_id: string | null
  participant_ids: string[]
  primary_answerer_id: string | null
  confidence: number
  retrieval_count: number
  last_retrieved_at: Date | null
  helpfulness_score: number
  source: string
  created_by: string | null
  created_at: Date
  updated_at: Date
  visibility: string
  visible_to_stream_ids: string[]
  archived_at: Date | null
}
