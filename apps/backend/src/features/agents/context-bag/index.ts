// Public API for the context-bag feature.
// External consumers import from here (INV-52).
export { ContextBagRepository } from "./repository"
export type { InsertContextBagParams } from "./repository"
export { SummaryRepository } from "./summary-repository"
export type { StoredSummary, UpsertSummaryParams } from "./summary-repository"
export { getIntentConfig, getResolver } from "./registry"
export { ThreadResolver } from "./resolvers/thread-resolver"
export { DiscussThreadIntent } from "./intents/discuss-thread"
export { diffInputs } from "./diff"
export type { DiffResult } from "./diff"
export { renderStable, renderDelta, buildSnapshot } from "./render"
export { fingerprintContent, fingerprintManifest } from "./fingerprint"
export { summarizeThread } from "./summarizer"
export { resolveBagForStream, persistSnapshot } from "./resolve"
export type { ResolvedBag, ResolveBagDeps } from "./resolve"
export type {
  StoredContextBag,
  SummaryInput,
  LastRenderedSnapshot,
  RenderableMessage,
  ResolvedRef,
  Resolver,
  IntentConfig,
  SummarizerDeps,
} from "./types"
