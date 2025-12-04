# Phase 3 Progress - Service Methods Refactoring

This document tracks the progress of refactoring `StreamService` methods to use the repository layer.

## Completed

### 1. Repository Imports Added
Added imports for all repositories at the top of `stream-service.ts`:
```typescript
import {
  StreamRepository,
  StreamMemberRepository,
  StreamEventRepository,
  ReactionRepository,
  NotificationRepository,
  TextMessageRepository,
} from "../repositories"
```

### 2. Simple Getter Methods (DONE)
- `getStream()` → `StreamRepository.findStreamById()`
- `getStreamBySlug()` → `StreamRepository.findStreamBySlug()`
- `getThreadForEvent()` → `StreamRepository.findStreamByBranchedFromEventId()`
- `findExistingDM()` → `StreamRepository.findExistingDM()`
- `checkSlugExists()` → `StreamRepository.slugExists()`

### 3. Member Operations (DONE)
- `getStreamMembers()` → `StreamMemberRepository.findStreamMembers()`
- `getReadCursor()` → `StreamMemberRepository.getReadCursor()`
- `pinStream()` → `StreamMemberRepository.pinStream()`
- `unpinStream()` → `StreamMemberRepository.unpinStream()`

### 4. Reaction Methods (DONE)
- `getReactions()` → `ReactionRepository.findReactionsByMessageId()`
- `getReactionCount()` → `ReactionRepository.countReactionsByMessageId()`
- `addReaction()` → Uses `StreamEventRepository.findEventWithStream()`, `ReactionRepository.insertReaction()`, `ReactionRepository.countReactionsByMessageId()`
- `removeReaction()` → Uses `StreamEventRepository.findEventWithStream()`, `ReactionRepository.softDeleteReaction()`, `ReactionRepository.countReactionsByMessageId()`

### 5. Notification Methods (DONE)
- `getNotificationCount()` → `NotificationRepository.countUnreadNotifications()`
- `getNotifications()` → `NotificationRepository.findNotifications()`
- `markNotificationAsRead()` → `NotificationRepository.markNotificationRead()`
- `markAllNotificationsAsRead()` → `NotificationRepository.markAllNotificationsRead()`

### 6. Stream Write Operations (DONE)
- `archiveStream()` → Uses `StreamRepository.findStreamById()` + `StreamRepository.archiveStream()` + `publishOutboxEvent()`
- `unarchiveStream()` → Uses `StreamRepository.findStreamById()` + `StreamRepository.unarchiveStream()` + `publishOutboxEvent()`
- `updateStream()` → Uses `StreamRepository.findStreamById()` + `StreamRepository.updateStreamMetadata()` + `publishOutboxEvent()`

### 7. Membership Mutations (DONE)
- `joinStream()` → Uses `StreamMemberRepository.upsertMember()`, `StreamEventRepository.insertEvent()`, `StreamMemberRepository.updateReadCursor()`, `StreamRepository.findStreamById()`, `publishOutboxEvent()`
- `leaveStream()` → Uses `StreamMemberRepository.removeMember()`, `StreamEventRepository.insertEvent()`, `StreamRepository.findStreamById()`, `publishOutboxEvent()`
- `addMember()` → Uses `StreamMemberRepository.upsertMember()`, `StreamEventRepository.insertEvent()`, `StreamRepository.findStreamById()`, `publishOutboxEvent()`
- `removeMember()` → Uses `StreamMemberRepository.removeMember()`, `StreamEventRepository.insertEvent()`, `StreamRepository.findStreamById()`, `publishOutboxEvent()`
- `updateReadCursor()` → Uses `StreamMemberRepository.updateReadCursor()`, `publishOutboxEvent()`

---

## Remaining Work

See **[05-complex-methods-plan.md](./05-complex-methods-plan.md)** for detailed implementation guidance on the remaining methods.

### 8. Event Query Methods (TODO)
- `getStreamEvents()` - Uses `StreamEventRepository.findEventsByStreamId()` + `StreamEventRepository.findEventsByIds()` for hydration
- `getEventWithDetails()` - Uses `StreamEventRepository.findEventWithDetails()`

### 9. Event Mutations (TODO)
- `editEvent()` - Event lookup, revision creation, content update, event timestamp update
- `deleteEvent()` - Event lookup, soft delete

### 10. Complex Methods (TODO - Last)
These are the most complex methods with multiple repository operations, conditional logic, and external calls. See the detailed plan in `05-complex-methods-plan.md`.

- `createStream()` - Multiple operations: slug check, insert stream, insert member, optionally insert event
- `createDM()` - Check existing, get users, insert stream, insert members
- `createThreadFromEvent()` - Get event with content, check existing thread, create stream, add member, auto-name, create event
- `replyToEvent()` - Most complex: event lookup with lock, thread creation/lookup with lock, idempotency check, message creation, notifications, read cursor
- `promoteStream()` - Stream lookup, slug check, update stream type, create event
- `createEvent()` - Very complex: idempotency check, content creation, event creation, auto-naming, mentions/notifications, read cursor

### 11. Utility Methods (TODO)
- `getAncestorChain()` - Iteratively uses `getStream()` and `getEventWithDetails()` (already refactored indirectly)
- `checkStreamAccess()` - Complex recursive CTE query - consider if repository makes sense
- `checkEventAccess()` - Uses `StreamEventRepository.findEventStreamId()` + `checkStreamAccess()`
- `getDiscoverableStreams()` - Uses `StreamRepository.findDiscoverableStreams()`

### 12. Bootstrap Method (Optional)
The `bootstrap()` method runs 4 parallel queries. Could create a `BootstrapRepository` or leave as-is since it's a special case with complex joins.

---

## Pattern for Refactoring

For simple getters:
```typescript
async getXxx(): Promise<T | null> {
  const client = await this.pool.connect()
  try {
    const row = await XxxRepository.findXxx(client, ...)
    return row ? this.mapXxxRow(row) : null
  } finally {
    client.release()
  }
}
```

For transactional methods with outbox:
```typescript
async doXxx(): Promise<T> {
  return await withTransaction(this.pool, async (client) => {
    // Use repository methods for DB operations
    const row = await XxxRepository.findXxx(client, ...)
    await XxxRepository.updateXxx(client, ...)

    // Keep outbox event publishing in service (business logic)
    await publishOutboxEvent(client, OutboxEventType.XXX, { ... })

    return this.mapXxxRow(row)
  })
}
```

---

## Notes

- The `mapStreamRow()` and `mapEventRow()` private methods stay in the service - they handle domain type mapping
- Outbox event publishing stays in the service - it's business logic, not data access
- External calls (`generateAutoName`, `queueEnrichment*`, etc.) stay in the service
- ID generation (`generateId()`) stays in the service
- Type checking passed for all refactored methods so far (pre-existing type errors in frontend are unrelated)
