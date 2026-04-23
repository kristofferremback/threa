// Handlers
export { createAgentSessionHandlers } from "./session-handlers"

// Services & Agents
export { PersonaAgent } from "./persona-agent"
export type { PersonaAgentDeps, PersonaAgentInput, PersonaAgentResult, WithSessionResult } from "./persona-agent"

// Runtime (composable agent loop, observers, tool definitions)
export { defineAgentTool, toVercelToolDefs, AgentRuntime, SessionTraceObserver, OtelObserver } from "./runtime"
export type {
  AgentTool,
  AgentToolConfig,
  AgentToolResult,
  AgentEvent,
  NewMessageInfo,
  AgentObserver,
  AgentRuntimeConfig,
  AgentRuntimeResult,
} from "./runtime"

// Companion agent modules
export { buildAgentContext, buildToolSet, withCompanionSession, truncateMessages, MAX_MESSAGE_CHARS } from "./companion"
export type { ContextDeps, ContextParams, AgentContext, ToolSetConfig } from "./companion"

export { TraceEmitter, SessionTrace, ActiveStep } from "./trace-emitter"

export { SessionAbortRegistry } from "./session-abort-registry"
export type { SessionAbortContext } from "./session-abort-registry"

export { AgentSessionMetricsCollector } from "./session-metrics"

export {
  extractMentions,
  extractMentionSlugs,
  hasMention,
  isValidSlug,
  MENTION_PATTERN,
  SLUG_PATTERN,
} from "./mention-extractor"
export type { ExtractedMention } from "./mention-extractor"

// Outbox handlers
export { CompanionHandler } from "./companion-outbox-handler"
export type { CompanionHandlerConfig } from "./companion-outbox-handler"
export { MentionInvokeHandler } from "./mention-invoke-outbox-handler"
export type { MentionInvokeHandlerConfig } from "./mention-invoke-outbox-handler"
export { AgentMessageMutationHandler } from "./message-mutation-outbox-handler"
export type { AgentMessageMutationHandlerConfig } from "./message-mutation-outbox-handler"
export {
  ContextBagOrientationHandler,
  createContextBagOrientationWorker,
  CONTEXT_BAG_ORIENT_QUEUE,
} from "./context-bag-orientation-handler"
export type {
  ContextBagOrientationHandlerConfig,
  ContextBagOrientationWorkerDeps,
} from "./context-bag-orientation-handler"

// Context-bag primitive
export {
  ContextBagRepository,
  SummaryRepository,
  resolveBagForStream,
  persistSnapshot,
  getIntentConfig,
  getResolver,
  DiscussThreadIntent,
  ThreadResolver,
  fingerprintContent,
  fingerprintManifest,
  diffInputs,
  renderStable,
  renderDelta,
  buildSnapshot,
} from "./context-bag"
export type {
  StoredContextBag,
  SummaryInput,
  LastRenderedSnapshot,
  RenderableMessage,
  ResolvedBag,
  DiffResult,
  IntentConfig,
} from "./context-bag"

// Workers
export { createPersonaAgentWorker, checkForUnseenMessages } from "./persona-agent-worker"
export type { PersonaAgentLike, PersonaAgentWorkerDeps } from "./persona-agent-worker"
export { createOrphanSessionCleanup } from "./orphan-session-cleanup"
export type { OrphanSessionCleanup } from "./orphan-session-cleanup"

// Repositories
export { PersonaRepository } from "./persona-repository"
export type { Persona } from "./persona-repository"

export { AgentSessionRepository, SessionStatuses } from "./session-repository"
export type {
  AgentSession,
  AgentSessionStep,
  SessionStatus,
  StepType,
  InsertSessionParams,
  UpsertStepParams,
} from "./session-repository"

export { StreamPersonaParticipantRepository } from "./stream-persona-participant-repository"
export type { StreamPersonaParticipant } from "./stream-persona-participant-repository"

export { ConversationSummaryRepository } from "./conversation-summary-repository"
export type { AgentConversationSummary, UpsertConversationSummaryParams } from "./conversation-summary-repository"
export { ConversationSummaryService } from "./conversation-summary-service"

// Quote-reply resolution (used by both companion/ and researcher/)
export {
  resolveQuoteReplies,
  renderMessageWithQuoteContext,
  extractAppendedQuoteContext,
  DEFAULT_MAX_QUOTE_DEPTH,
  DEFAULT_MAX_TOTAL_RESOLVED,
} from "./quote-resolver"
export type { ResolveQuoteRepliesInput, ResolveQuoteRepliesResult } from "./quote-resolver"

// Context builder
export { buildStreamContext, enrichMessagesWithAttachments } from "./context-builder"
export type {
  Participant,
  AnchorMessage,
  ThreadPathEntry,
  AttachmentContext,
  MessageWithAttachments,
  StreamContext,
  BuildStreamContextOptions,
  EnrichAttachmentsOptions,
} from "./context-builder"

// Tool trust boundary
export { protectToolOutputText, protectToolOutputBlocks } from "./tool-trust-boundary"
export type { MultimodalContentBlock } from "./tool-trust-boundary"

// Sub-barrels
export { WorkspaceAgent } from "./researcher"
export type { WorkspaceAgentResult, WorkspaceAgentInput, WorkspaceAgentDeps, WorkspaceSourceItem } from "./researcher"
export { computeAgentAccessSpec } from "./researcher"
export type { AgentAccessSpec, ComputeAccessSpecParams } from "./researcher"

// Config (exported for static-config-resolver)
export { COMPANION_MODEL_ID, COMPANION_TEMPERATURE } from "./companion/config"
export { COMPANION_SUMMARY_MODEL_ID, COMPANION_SUMMARY_TEMPERATURE } from "./companion/config"
export { SUPERSEDE_RESPONSE_VALIDATOR_MAX_TOKENS, SUPERSEDE_RESPONSE_VALIDATOR_TEMPERATURE } from "./config"
export { SUPERSEDE_RESPONSE_VALIDATOR_MODEL_ID } from "./config"
export {
  WORKSPACE_AGENT_MODEL_ID,
  WORKSPACE_AGENT_TEMPERATURE,
  WORKSPACE_AGENT_MAX_ITERATIONS,
  WORKSPACE_AGENT_MAX_RESULTS_PER_SEARCH,
  WORKSPACE_AGENT_SYSTEM_PROMPT,
} from "./researcher/config"
