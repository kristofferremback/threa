import { Pool } from "pg"
import { sql } from "../lib/db"
import { logger } from "../lib/logger"
import { generateAutoName, suggestTags, classifyMemoCategory, MemoCategory } from "../lib/ollama"
import { tagId } from "../lib/id"

/**
 * MemoScoringService - Evaluates messages for memo-worthiness.
 *
 * Uses content signals (announcements, explanations, decisions) and structural
 * signals to determine if a message should become a memo pointer.
 *
 * This is inspired by GAM's approach: instead of relying solely on engagement
 * metrics, we classify content based on its inherent value as knowledge.
 */

// Patterns that indicate an announcement (company canon)
const ANNOUNCEMENT_PATTERNS = [
  /\b(we('ve|'re| have| are| just)|i('ve| have| just))\s+(implemented|launched|shipped|released|deployed|built|created|added|introduced|finished|completed)/i,
  /\b(introducing|announcing|new feature|just (launched|shipped|released|deployed))/i,
  /\bhey (all|everyone|team|folks),?\s+we/i,
  /\b(fyi|heads up|psa|update):?\s/i,
  /\b(rolling out|going live|now available)/i,
]

// Patterns that indicate an explanation (teaching moment)
const EXPLANATION_PATTERNS = [
  /\b(for those (curious|wondering|interested)|here'?s (how|why|what)|let me explain|the (way|reason) (it|this|we))/i,
  /\b(basically|essentially|in (short|summary|essence)|to (summarize|explain)|this (means|is because))/i,
  /\binspired by\b/i,
  /\bworks by\b/i,
  /\bthe (trick|key|secret) is\b/i,
  /\bhere'?s what (you need|to do|happens)\b/i,
]

// Patterns that indicate a decision
const DECISION_PATTERNS = [
  /\b(we('ve)? decided|the decision (is|was)|going (with|forward with)|the plan is|we('re| are) going to)/i,
  /\b(after (discussing|consideration|review)|based on (feedback|discussion))/i,
  /\bwe'?ll (use|go with|adopt|implement)\b/i,
]

// Patterns that indicate a how-to or guide
const HOWTO_PATTERNS = [
  /\bhow to\b/i,
  /\bstep[s]? to\b/i,
  /\bto (do this|get started|set up)\b/i,
  /\bhere'?s the (process|steps|way)\b/i,
]

// Patterns that indicate a short non-knowledge reply
const TRIVIAL_PATTERNS = [
  /^(thanks|thank you|thx|ty|ok|okay|k|lol|haha|nice|cool|great|awesome|perfect|got it|makes sense|understood|sure|yep|yes|no|nope|agreed|exactly|right|true|same|this|100%|lgtm|\+1|done|fixed|merged|noted|ack)[\s!.]*$/i,
]

// Emojis that often accompany knowledge-sharing
const KNOWLEDGE_EMOJIS = /[📢📣🎉🚀💡📝📖📚✨🔔⚡️🆕]/

export interface ContentSignals {
  length: number
  hasCodeBlock: boolean
  hasInlineCode: boolean
  hasListItems: boolean
  hasLinks: boolean
  lineCount: number
  isAnnouncement: boolean
  isExplanation: boolean
  isDecision: boolean
  isHowTo: boolean
  hasKnowledgeEmoji: boolean
  isTrivial: boolean
  isQuestion: boolean
  hasMentions: boolean
}

export interface MemoWorthinessScore {
  score: number
  shouldCreateMemo: boolean
  reasons: string[]
  suggestedTopics: string[]
  confidence: number
}

export interface MessageContext {
  eventId: string
  textMessageId: string
  workspaceId: string
  streamId: string
  content: string
  authorName: string
  streamName: string
  streamType: string
  isFirstInThread: boolean
  reactionCount: number
  replyCount: number
  isAiGenerated: boolean
}

export class MemoScoringService {
  constructor(private pool: Pool) {}

  /**
   * Extract content signals from message text.
   */
  getContentSignals(content: string): ContentSignals {
    return {
      length: content.length,
      hasCodeBlock: /```[\s\S]*?```/.test(content),
      hasInlineCode: /`[^`]+`/.test(content),
      hasListItems: /^[\s]*[-*•]\s|^[\s]*\d+[.)]\s/m.test(content),
      hasLinks: /https?:\/\/\S+/.test(content),
      lineCount: content.split("\n").filter((l) => l.trim()).length,
      isAnnouncement: ANNOUNCEMENT_PATTERNS.some((p) => p.test(content)),
      isExplanation: EXPLANATION_PATTERNS.some((p) => p.test(content)),
      isDecision: DECISION_PATTERNS.some((p) => p.test(content)),
      isHowTo: HOWTO_PATTERNS.some((p) => p.test(content)),
      hasKnowledgeEmoji: KNOWLEDGE_EMOJIS.test(content),
      isTrivial: TRIVIAL_PATTERNS.some((p) => p.test(content)),
      isQuestion: /\?[\s]*$/.test(content.trim()) && content.length < 200,
      hasMentions: /@\w+/.test(content),
    }
  }

  /**
   * Calculate memo-worthiness score for a message.
   * Returns a score from 0-100 and whether a memo should be created.
   */
  async score(message: MessageContext): Promise<MemoWorthinessScore> {
    const signals = this.getContentSignals(message.content)
    const reasons: string[] = []
    let score = 0

    // Trivial messages are immediately rejected
    if (signals.isTrivial) {
      return {
        score: 0,
        shouldCreateMemo: false,
        reasons: ["Message is trivial (thanks, ok, etc.)"],
        suggestedTopics: [],
        confidence: 0,
      }
    }

    // Content type signals (high value)
    if (signals.isAnnouncement) {
      score += 25
      reasons.push("Announcement (+25)")
    }
    if (signals.isExplanation) {
      score += 20
      reasons.push("Explanation (+20)")
    }
    if (signals.isDecision) {
      score += 20
      reasons.push("Decision (+20)")
    }
    if (signals.isHowTo) {
      score += 15
      reasons.push("How-to guide (+15)")
    }

    // Structural signals
    if (signals.hasCodeBlock) {
      score += 10
      reasons.push("Has code block (+10)")
    }
    if (signals.hasListItems) {
      score += 10
      reasons.push("Has list items (+10)")
    }
    if (signals.hasInlineCode) {
      score += 5
      reasons.push("Has inline code (+5)")
    }
    if (signals.hasLinks) {
      score += 5
      reasons.push("Has links (+5)")
    }
    if (signals.length > 300) {
      score += 10
      reasons.push("Substantial length (+10)")
    } else if (signals.length > 150) {
      score += 5
      reasons.push("Moderate length (+5)")
    }
    if (signals.lineCount > 5) {
      score += 5
      reasons.push("Multi-line content (+5)")
    }

    // Contextual signals
    if (message.isFirstInThread) {
      score += 5
      reasons.push("First message in thread (+5)")
    }
    if (signals.hasKnowledgeEmoji) {
      score += 3
      reasons.push("Has knowledge emoji (+3)")
    }

    // Engagement signals (lower weight - not required)
    const reactionBonus = Math.min(message.reactionCount * 2, 10)
    if (reactionBonus > 0) {
      score += reactionBonus
      reasons.push(`Reactions: ${message.reactionCount} (+${reactionBonus})`)
    }
    const replyBonus = Math.min(message.replyCount * 3, 15)
    if (replyBonus > 0) {
      score += replyBonus
      reasons.push(`Replies: ${message.replyCount} (+${replyBonus})`)
    }

    // Negative signals
    if (signals.isQuestion && !signals.isExplanation) {
      score -= 10
      reasons.push("Appears to be a question (-10)")
    }
    if (signals.length < 50) {
      score -= 10
      reasons.push("Very short content (-10)")
    }

    // Ensure score stays in bounds
    score = Math.max(0, Math.min(100, score))

    // Determine if we should create a memo
    let shouldCreateMemo = false
    let confidence = 0

    // High score always qualifies
    if (score >= 50) {
      shouldCreateMemo = true
      confidence = Math.min(0.9, 0.5 + (score - 50) / 100)
    }
    // Announcements have special treatment - company canon
    else if (signals.isAnnouncement && score >= 30) {
      shouldCreateMemo = true
      confidence = 0.7
      reasons.push("Announcement qualifies at lower threshold")
    }
    // Decisions are also important institutional knowledge
    else if (signals.isDecision && score >= 35) {
      shouldCreateMemo = true
      confidence = 0.6
      reasons.push("Decision qualifies at lower threshold")
    }
    // High engagement can push borderline content over
    else if (score >= 40 && (message.reactionCount >= 3 || message.replyCount >= 2)) {
      shouldCreateMemo = true
      confidence = 0.5
      reasons.push("Engagement pushed score over threshold")
    }

    logger.debug(
      {
        eventId: message.eventId,
        score,
        shouldCreateMemo,
        signals: {
          isAnnouncement: signals.isAnnouncement,
          isExplanation: signals.isExplanation,
          isDecision: signals.isDecision,
          hasCodeBlock: signals.hasCodeBlock,
          length: signals.length,
        },
      },
      "Memo worthiness scored",
    )

    return {
      score,
      shouldCreateMemo,
      reasons,
      suggestedTopics: [], // Topics are now generated via LLM in the worker
      confidence,
    }
  }

  /**
   * Suggest topics/tags for content using LLM with existing tags as context.
   * Falls back to basic extraction if LLM fails.
   */
  async suggestTopics(workspaceId: string, content: string): Promise<string[]> {
    // Get existing workspace tags (sorted by popularity)
    const existingTags = await this.getWorkspaceTags(workspaceId)

    // Try LLM-based tagging
    const result = await suggestTags(content, existingTags)

    if (result.success && result.tags.length > 0) {
      return result.tags
    }

    // Fallback: return empty array (no tags is better than wrong tags)
    return []
  }

  /**
   * Get existing tags for a workspace, sorted by usage count.
   */
  private async getWorkspaceTags(workspaceId: string): Promise<string[]> {
    const result = await this.pool.query<{ name: string }>(
      sql`SELECT name FROM workspace_tags
        WHERE workspace_id = ${workspaceId}
        ORDER BY usage_count DESC
        LIMIT 50`,
    )
    return result.rows.map((r) => r.name)
  }

  /**
   * Record tag usage - creates new tags or increments usage count.
   */
  async recordTagUsage(workspaceId: string, tags: string[]): Promise<void> {
    if (tags.length === 0) return

    for (const tag of tags) {
      const normalizedTag = tag.toLowerCase().trim()
      if (!normalizedTag || normalizedTag.length < 2) continue

      await this.pool.query(
        sql`INSERT INTO workspace_tags (id, workspace_id, name, usage_count, last_used_at)
          VALUES (${tagId()}, ${workspaceId}, ${normalizedTag}, 1, NOW())
          ON CONFLICT (workspace_id, name) DO UPDATE
          SET usage_count = workspace_tags.usage_count + 1,
              last_used_at = NOW()`,
      )
    }
  }

  /**
   * Get message with full context for scoring.
   */
  async getMessageWithContext(eventId: string): Promise<MessageContext | null> {
    const result = await this.pool.query<{
      event_id: string
      text_message_id: string
      workspace_id: string
      stream_id: string
      content: string
      author_name: string
      stream_name: string
      stream_type: string
      reaction_count: string
      reply_count: string
      is_first_in_thread: boolean
      agent_id: string | null
    }>(
      sql`SELECT
        e.id as event_id,
        tm.id as text_message_id,
        s.workspace_id,
        s.id as stream_id,
        tm.content,
        COALESCE(u.name, u.email, 'Unknown') as author_name,
        COALESCE(s.name, s.slug) as stream_name,
        s.stream_type,
        e.agent_id,
        COALESCE((SELECT COUNT(*)::text FROM message_reactions WHERE message_id = e.id), '0') as reaction_count,
        COALESCE((
          SELECT COUNT(*)::text FROM stream_events child
          WHERE child.stream_id IN (SELECT id FROM streams WHERE branched_from_event_id = e.id)
        ), '0') as reply_count,
        (
          SELECT e.id = (
            SELECT MIN(se.id) FROM stream_events se
            WHERE se.stream_id = e.stream_id AND se.deleted_at IS NULL
          )
        ) as is_first_in_thread
      FROM stream_events e
      INNER JOIN text_messages tm ON e.content_id = tm.id AND e.content_type = 'text_message'
      INNER JOIN streams s ON e.stream_id = s.id
      LEFT JOIN users u ON e.actor_id = u.id
      WHERE e.id = ${eventId}
        AND e.deleted_at IS NULL`,
    )

    if (result.rows.length === 0) {
      return null
    }

    const row = result.rows[0]
    return {
      eventId: row.event_id,
      textMessageId: row.text_message_id,
      workspaceId: row.workspace_id,
      streamId: row.stream_id,
      content: row.content,
      authorName: row.author_name,
      streamName: row.stream_name,
      streamType: row.stream_type,
      isFirstInThread: row.is_first_in_thread,
      reactionCount: parseInt(row.reaction_count, 10),
      replyCount: parseInt(row.reply_count, 10),
      isAiGenerated: row.agent_id !== null,
    }
  }

  /**
   * Classify content into a memo category.
   */
  async classifyCategory(content: string): Promise<MemoCategory | null> {
    const result = await classifyMemoCategory(content)
    return result.success ? result.category : null
  }

  /**
   * Generate a summary for a memo using the SLM.
   */
  async generateSummary(content: string, context?: { streamName: string; authorName: string }): Promise<string> {
    const truncated = content.slice(0, 1500)
    const result = await generateAutoName(truncated)

    if (result.success && result.name) {
      return result.name
    }

    // Fallback: use first line or truncated content
    const firstLine = content.split("\n")[0].trim()
    if (firstLine.length > 10 && firstLine.length < 100) {
      return firstLine
    }

    return content.slice(0, 80) + (content.length > 80 ? "..." : "")
  }
}
