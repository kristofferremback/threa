// Handlers
export { createAgentSessionHandlers } from "./session-handlers"

// Services & Agents
export { PersonaAgent } from "./persona-agent"
export type { PersonaAgentDeps, PersonaAgentInput, PersonaAgentResult, WithSessionResult } from "./persona-agent"

export { SimulationAgent } from "./simulation-agent"
export type { SimulationAgentDeps, SimulationAgentInput, SimulationAgentResult } from "./simulation-agent"
export { StubSimulationAgent } from "./simulation-agent.stub"

// Companion agent modules
export {
  runAgentLoop,
  buildAgentContext,
  buildToolSet,
  withCompanionSession,
  truncateMessages,
  MAX_MESSAGE_CHARS,
  extractSourcesFromWebSearch,
  parseWorkspaceResearchResult,
  mergeSourceItems,
  toSourceItems,
} from "./companion"
export type {
  AgentLoopInput,
  AgentLoopCallbacks,
  AgentLoopResult,
  RecordStepParams,
  NewMessageInfo,
  ContextDeps,
  ContextParams,
  AgentContext,
  ToolSetConfig,
} from "./companion"

export { TraceEmitter, SessionTrace, ActiveStep } from "./trace-emitter"

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

// Workers
export { createPersonaAgentWorker } from "./persona-agent-worker"
export type { PersonaAgentLike, PersonaAgentWorkerDeps } from "./persona-agent-worker"
export { createSimulationWorker } from "./simulation-worker"
export type { SimulationAgentLike, SimulationWorkerDeps } from "./simulation-worker"
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

// Simulation graph
export { createSimulationGraph, SimulationState, TurnDecisionSchema } from "./simulation-graph"
export type { SimulationMessage, TurnDecision, SimulationGraphCallbacks, SimulationStateType } from "./simulation-graph"

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
export {
  WORKSPACE_AGENT_MODEL_ID,
  WORKSPACE_AGENT_TEMPERATURE,
  WORKSPACE_AGENT_MAX_ITERATIONS,
  WORKSPACE_AGENT_MAX_RESULTS_PER_SEARCH,
  WORKSPACE_AGENT_SYSTEM_PROMPT,
} from "./researcher/config"
