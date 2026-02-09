// Repositories
export { MemoRepository } from "./repository"
export type {
  Memo,
  InsertMemoParams,
  UpdateMemoParams,
  MemoSearchResult,
  SemanticSearchParams,
  FullTextSearchParams,
} from "./repository"

export { PendingItemRepository } from "./pending-item-repository"
export type { PendingMemoItem, QueuePendingItemParams } from "./pending-item-repository"

// AI pipeline
export { MemoClassifier } from "./classifier"
export type { MessageClassification, ConversationClassification, ClassifierContext } from "./classifier"

export { Memorizer } from "./memorizer"
export type { MemoContent, MemorizerContext } from "./memorizer"

// Config (INV-44)
export {
  MEMO_MODEL_ID,
  MEMO_TEMPERATURES,
  messageClassificationSchema,
  conversationClassificationSchema,
  memoContentSchema,
  getMemorizerSystemPrompt,
} from "./config"

export { EMBEDDING_MODEL_ID } from "./embedding-config"

// Services
export { MemoService } from "./service"
export type { MemoServiceLike, MemoServiceConfig, ProcessResult } from "./service"

export { StubMemoService } from "./service.stub"

export { EmbeddingService } from "./embedding-service"
export type { EmbeddingServiceLike, EmbeddingServiceConfig, EmbeddingContext } from "./embedding-service"

export { StubEmbeddingService } from "./embedding-service.stub"

// Outbox handlers
export { MemoAccumulatorHandler } from "./accumulator-outbox-handler"
export type { MemoAccumulatorHandlerConfig } from "./accumulator-outbox-handler"

export { EmbeddingHandler } from "./embedding-outbox-handler"
export type { EmbeddingHandlerConfig } from "./embedding-outbox-handler"

// Workers
export { createMemoBatchCheckWorker, createMemoBatchProcessWorker } from "./batch-worker"
export type { MemoBatchWorkerDeps } from "./batch-worker"

export { createEmbeddingWorker } from "./embedding-worker"
export type { EmbeddingWorkerDeps } from "./embedding-worker"
