// Repository
export { MessageRepository } from "./repository"
export type { Message, InsertMessageParams } from "./repository"

// Version Repository
export { MessageVersionRepository } from "./version-repository"
export type { MessageVersion } from "./version-repository"

// Event Service
export { EventService } from "./event-service"
export type {
  AttachmentSummary,
  MessageCreatedPayload,
  MessageEditedPayload,
  MessageDeletedPayload,
  ReactionPayload,
  ThreadCreatedPayload,
  CreateMessageParams,
  EditMessageParams,
  DeleteMessageParams,
  AddReactionParams,
  RemoveReactionParams,
} from "./event-service"

// Handlers
export { createMessageHandlers } from "./handlers"
export { createMessageSchema, updateMessageSchema, addReactionSchema } from "./handlers"

// Metadata
export {
  messageMetadataSchema,
  messageMetadataFilterSchema,
  MESSAGE_METADATA_MAX_KEYS,
  MESSAGE_METADATA_MAX_KEY_LENGTH,
  MESSAGE_METADATA_MAX_VALUE_LENGTH,
  MESSAGE_METADATA_MAX_SERIALIZED_BYTES,
  MESSAGE_METADATA_RESERVED_PREFIX,
} from "./metadata-schema"
