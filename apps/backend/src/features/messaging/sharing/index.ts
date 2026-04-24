export { ShareService, collectShareReferences, type ValidateAndRecordSharesParams } from "./service"
export { SharedMessageRepository, type SharedMessage, type InsertSharedMessageParams } from "./repository"
export {
  crossesPrivacyBoundary,
  type PrivacyBoundaryResult,
  type SharingStream,
  type FindStreamForSharing,
  type IsAncestorStream,
} from "./access-check"
export { invalidatePointersForEvent, POINTER_INVALIDATED_EVENT } from "./outbox-handler"
export {
  hydrateSharedMessages,
  hydrateSharedMessageIds,
  collectSharedMessageIds,
  type HydratedSharedMessage,
} from "./hydration"
