/**
 * Repository layer for database operations.
 *
 * Design principles:
 * - Repositories accept PoolClient as first parameter (enables transaction control from service)
 * - Return raw database rows (services handle mapping to domain types)
 * - No side effects (no outbox events, no external calls)
 * - Uses explicit field selection (no SELECT *)
 * - Single responsibility: each method does one database operation
 * - Composable: services compose multiple repository calls within transactions
 */

export { ReactionRepository, type ReactionRow, type InsertReactionParams } from "./reaction-repository"

export {
  NotificationRepository,
  type NotificationRow,
  type NotificationWithDetailsRow,
  type InsertNotificationParams,
} from "./notification-repository"

export {
  TextMessageRepository,
  type TextMessageRow,
  type InsertTextMessageParams,
} from "./text-message-repository"

export {
  StreamRepository,
  type StreamRow,
  type DiscoverableStreamRow,
  type InsertStreamParams,
  type UpdateStreamTypeParams,
  type UpdateStreamMetadataParams,
} from "./stream-repository"

export {
  StreamMemberRepository,
  type StreamMemberRow,
  type StreamMemberWithUserRow,
  type InsertMemberParams,
  type UpsertMemberParams,
  type UpsertMemberWithReadCursorParams,
} from "./stream-member-repository"

export {
  StreamEventRepository,
  type StreamEventRow,
  type EventWithStreamRow,
  type EventWithContentRow,
  type StreamEventWithDetailsRow,
  type InsertEventParams,
  type FindEventsParams,
} from "./stream-event-repository"

export { MessageRevisionRepository, type InsertRevisionParams } from "./message-revision-repository"

export { SharedRefRepository, type InsertSharedRefParams } from "./shared-ref-repository"
