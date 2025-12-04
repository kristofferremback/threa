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
