import { Pool } from "pg"
import { sql } from "../lib/db"
import { logger } from "../lib/logger"
import { generateContextualHeader, ContextMessage } from "../lib/ollama"
import { generateEmbedding } from "../lib/ai-providers"
import { getTextMessageEmbeddingTable } from "../lib/embedding-tables"
import { EnrichmentSignals } from "../lib/job-queue"

/**
 * EnrichmentService handles the contextual enrichment of messages.
 *
 * Messages are enriched in tiers:
 * - Tier 0: No processing (very short, trivial messages)
 * - Tier 1: Basic embedding only
 * - Tier 2: Contextual header generated + re-embedded with context
 *
 * Enrichment is triggered by signals:
 * - Reactions (2+ reactions)
 * - Replies (2+ replies)
 * - Retrieval by Ariadne (message was useful in answering a question)
 */
export class EnrichmentService {
  private embeddingTable: string

  constructor(private pool: Pool) {
    this.embeddingTable = getTextMessageEmbeddingTable()
  }

  /**
   * Check if a message should be enriched based on accumulated signals.
   */
  shouldEnrich(signals: EnrichmentSignals): boolean {
    // Any of these signals triggers enrichment
    return (
      (signals.reactions ?? 0) >= 2 ||
      (signals.replies ?? 0) >= 2 ||
      signals.retrieved === true
    )
  }

  /**
   * Enrich a message with contextual header and update embedding.
   * Returns true if enrichment was successful.
   */
  async enrichMessage(
    textMessageId: string,
    eventId: string,
    signals: EnrichmentSignals,
  ): Promise<boolean> {
    logger.info({ textMessageId, eventId }, "📝 Fetching message with context...")

    // Get the message and its context
    const messageData = await this.getMessageWithContext(textMessageId, eventId)
    if (!messageData) {
      logger.warn({ textMessageId, eventId }, "❌ Message not found for enrichment")
      return false
    }

    logger.info(
      {
        textMessageId,
        streamName: messageData.streamName,
        streamType: messageData.streamType,
        authorName: messageData.authorName,
        contentLength: messageData.content.length,
        contextCount: messageData.context.length,
        currentTier: messageData.enrichmentTier,
      },
      "📄 Message data retrieved",
    )

    // Skip if already enriched
    if (messageData.enrichmentTier >= 2) {
      logger.info({ textMessageId }, "⏭️ Message already enriched (tier >= 2), skipping")
      return true
    }

    // Generate contextual header
    const targetMessage: ContextMessage = {
      author: messageData.authorName,
      content: messageData.content,
      isTarget: true,
    }

    const contextMessages: ContextMessage[] = messageData.context.map((c) => ({
      author: c.authorName,
      content: c.content,
    }))

    logger.info(
      { textMessageId, contextMessageCount: contextMessages.length },
      "🤖 Generating contextual header...",
    )

    const headerResult = await generateContextualHeader(
      targetMessage,
      contextMessages,
      {
        name: messageData.streamName,
        topic: messageData.streamTopic,
        type: messageData.streamType,
      },
    )

    if (!headerResult.success) {
      logger.warn({ textMessageId }, "❌ Failed to generate contextual header")
      // Still mark as processed to avoid retrying indefinitely
      await this.updateEnrichmentStatus(textMessageId, 1, signals, null)
      return false
    }

    logger.info(
      { textMessageId, headerLength: headerResult.header.length, headerPreview: headerResult.header.slice(0, 100) },
      "✅ Contextual header generated",
    )

    // Re-embed with contextual header prepended
    const enrichedContent = `${headerResult.header}\n\n${messageData.content}`
    logger.info({ textMessageId, enrichedContentLength: enrichedContent.length }, "🔄 Generating new embedding...")
    const embeddingResult = await generateEmbedding(enrichedContent)

    // Update the embedding
    await this.pool.query(
      sql`INSERT INTO ${sql.raw(this.embeddingTable)} (text_message_id, embedding, model)
        VALUES (${textMessageId}, ${JSON.stringify(embeddingResult.embedding)}::vector, ${embeddingResult.model})
        ON CONFLICT (text_message_id) DO UPDATE
        SET embedding = EXCLUDED.embedding, model = EXCLUDED.model, created_at = NOW()`,
    )

    // Update the message with contextual header
    await this.updateEnrichmentStatus(textMessageId, 2, signals, headerResult.header)

    logger.info(
      { textMessageId, headerLength: headerResult.header.length },
      "Message enriched with contextual header",
    )
    return true
  }

  /**
   * Get a message with surrounding context for header generation.
   */
  private async getMessageWithContext(
    textMessageId: string,
    eventId: string,
  ): Promise<MessageWithContext | null> {
    // Get the target message
    const messageResult = await this.pool.query<{
      id: string
      content: string
      enrichment_tier: number
      stream_id: string
      stream_name: string
      stream_topic: string | null
      stream_type: string
      author_name: string
      created_at: Date
    }>(
      sql`SELECT
        tm.id,
        tm.content,
        COALESCE(tm.enrichment_tier, 0) as enrichment_tier,
        s.id as stream_id,
        COALESCE(s.name, s.slug) as stream_name,
        s.topic as stream_topic,
        s.stream_type,
        COALESCE(u.name, u.email) as author_name,
        e.created_at
      FROM text_messages tm
      JOIN stream_events e ON e.content_id = tm.id AND e.content_type = 'text_message'
      JOIN streams s ON e.stream_id = s.id
      LEFT JOIN users u ON e.actor_id = u.id
      WHERE tm.id = ${textMessageId}`,
    )

    if (messageResult.rows.length === 0) {
      return null
    }

    const message = messageResult.rows[0]

    // Get surrounding context (5 before, 2 after)
    const contextResult = await this.pool.query<{
      content: string
      author_name: string
      created_at: Date
    }>(
      sql`SELECT
        tm.content,
        COALESCE(u.name, u.email) as author_name,
        e.created_at
      FROM stream_events e
      JOIN text_messages tm ON e.content_id = tm.id AND e.content_type = 'text_message'
      LEFT JOIN users u ON e.actor_id = u.id
      WHERE e.stream_id = ${message.stream_id}
        AND e.deleted_at IS NULL
        AND e.id != ${eventId}
        AND e.created_at BETWEEN ${message.created_at}::timestamptz - INTERVAL '1 hour' AND ${message.created_at}::timestamptz + INTERVAL '10 minutes'
      ORDER BY e.created_at ASC
      LIMIT 7`,
    )

    return {
      id: message.id,
      content: message.content,
      enrichmentTier: message.enrichment_tier,
      streamId: message.stream_id,
      streamName: message.stream_name,
      streamTopic: message.stream_topic,
      streamType: message.stream_type,
      authorName: message.author_name,
      context: contextResult.rows.map((r) => ({
        content: r.content,
        authorName: r.author_name,
      })),
    }
  }

  /**
   * Update the enrichment status of a message.
   */
  private async updateEnrichmentStatus(
    textMessageId: string,
    tier: number,
    signals: EnrichmentSignals,
    contextualHeader: string | null,
  ): Promise<void> {
    await this.pool.query(
      sql`UPDATE text_messages
        SET enrichment_tier = ${tier},
            enrichment_signals = COALESCE(enrichment_signals, '{}') || ${JSON.stringify(signals)}::jsonb,
            contextual_header = ${contextualHeader},
            header_generated_at = ${contextualHeader ? new Date().toISOString() : null}
        WHERE id = ${textMessageId}`,
    )
  }

  /**
   * Get messages that need enrichment based on signals but haven't been enriched yet.
   * Used for batch processing or catch-up.
   */
  async getMessagesNeedingEnrichment(
    workspaceId: string,
    limit: number = 100,
  ): Promise<Array<{ textMessageId: string; eventId: string; signals: EnrichmentSignals }>> {
    // Find messages with enrichment signals but tier < 2
    const result = await this.pool.query<{
      text_message_id: string
      event_id: string
      reaction_count: string
      reply_count: string
    }>(
      sql`WITH message_signals AS (
        SELECT
          tm.id as text_message_id,
          e.id as event_id,
          COALESCE((
            SELECT COUNT(*)::text FROM message_reactions mr WHERE mr.message_id = e.id
          ), '0') as reaction_count,
          COALESCE((
            SELECT COUNT(*)::text FROM stream_events child
            WHERE child.stream_id IN (
              SELECT id FROM streams WHERE branched_from_event_id = e.id
            )
          ), '0') as reply_count
        FROM text_messages tm
        JOIN stream_events e ON e.content_id = tm.id AND e.content_type = 'text_message'
        JOIN streams s ON e.stream_id = s.id
        WHERE s.workspace_id = ${workspaceId}
          AND COALESCE(tm.enrichment_tier, 0) < 2
          AND e.deleted_at IS NULL
      )
      SELECT * FROM message_signals
      WHERE reaction_count::int >= 2 OR reply_count::int >= 2
      LIMIT ${limit}`,
    )

    return result.rows.map((r) => ({
      textMessageId: r.text_message_id,
      eventId: r.event_id,
      signals: {
        reactions: parseInt(r.reaction_count, 10),
        replies: parseInt(r.reply_count, 10),
      },
    }))
  }

  /**
   * Mark a message as retrieved (triggers enrichment if not already enriched).
   */
  async markAsRetrieved(textMessageId: string, eventId: string, helpful: boolean): Promise<void> {
    // Update signals
    await this.pool.query(
      sql`UPDATE text_messages
        SET enrichment_signals = COALESCE(enrichment_signals, '{}') ||
          ${JSON.stringify({ retrieved: true, helpful })}::jsonb
        WHERE id = ${textMessageId}`,
    )

    // Check current tier
    const result = await this.pool.query<{ enrichment_tier: number }>(
      sql`SELECT COALESCE(enrichment_tier, 0) as enrichment_tier
        FROM text_messages WHERE id = ${textMessageId}`,
    )

    if (result.rows.length > 0 && result.rows[0].enrichment_tier < 2) {
      // Queue for enrichment (will be picked up by the worker)
      logger.debug({ textMessageId }, "Message marked as retrieved, will be enriched")
    }
  }
}

interface MessageWithContext {
  id: string
  content: string
  enrichmentTier: number
  streamId: string
  streamName: string
  streamTopic: string | null
  streamType: string
  authorName: string
  context: Array<{
    content: string
    authorName: string
  }>
}
