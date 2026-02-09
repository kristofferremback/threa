// Handlers
export { createStreamHandlers } from "./handlers"

// Service
export { StreamService } from "./service"
export type { CreateScratchpadParams, CreateChannelParams, CreateThreadParams } from "./service"

// Naming
export { StreamNamingService } from "./naming-service"
export type { GenerateNameResult } from "./naming-service"
export { StubStreamNamingService } from "./naming-service.stub"
export { createNamingWorker } from "./naming-worker"
export type { StreamNamingServiceLike, NamingWorkerDeps } from "./naming-worker"
export { NamingHandler } from "./naming-outbox-handler"
export type { NamingHandlerConfig } from "./naming-outbox-handler"

// Naming config (INV-44)
export {
  STREAM_NAMING_MODEL_ID,
  STREAM_NAMING_TEMPERATURE,
  MAX_MESSAGES_FOR_NAMING,
  MAX_EXISTING_NAMES,
  buildNamingSystemPrompt,
} from "./naming-config"

// Repositories
export { StreamRepository } from "./repository"
export type {
  Stream,
  InsertStreamParams,
  UpdateStreamParams,
  StreamWithPreview,
  LastMessagePreview,
} from "./repository"

export { StreamEventRepository } from "./event-repository"
export type { StreamEvent, InsertEventParams } from "./event-repository"

export { StreamMemberRepository } from "./member-repository"
export type { StreamMember, UpdateStreamMemberParams } from "./member-repository"

export { StreamStateRepository } from "./state-repository"
export type { MemoStreamState, StreamReadyToProcess } from "./state-repository"

// Display name utilities
export { getEffectiveDisplayName, formatParticipantNames, needsAutoNaming } from "./display-name"
export type { DisplayNameSource, DisplayNameContext, EffectiveDisplayName } from "./display-name"
