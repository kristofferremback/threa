import type { Message } from "../../repositories/message-repository"
import type { ConversationStatus } from "@threa/types"

export interface ConversationSummary {
  id: string
  topicSummary: string | null
  messageCount: number
  lastMessagePreview: string
  participantIds: string[]
  completenessScore: number
}

export interface ExtractionContext {
  newMessage: Message
  recentMessages: Message[]
  activeConversations: ConversationSummary[]
  streamType: string
  /** For threads: conversations containing the parent message (in the parent channel) */
  parentMessageConversations?: ConversationSummary[]
}

export interface CompletenessUpdate {
  conversationId: string
  score: number
  status: ConversationStatus
}

export interface ExtractionResult {
  conversationId: string | null
  newConversationTopic?: string
  completenessUpdates?: CompletenessUpdate[]
  confidence: number
}

export interface BoundaryExtractor {
  extract(context: ExtractionContext): Promise<ExtractionResult>
}
