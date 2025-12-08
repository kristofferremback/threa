# Stream Service Refactoring Plan

This document maps each service method to the repository operations it requires and outlines the refactoring approach.

> **Related Documents**:
> - [01-stream-service-exploration.md](./01-stream-service-exploration.md) - Analysis of current implementation
> - [02-domain-operations.md](./02-domain-operations.md) - Repository operations with explicit SQL and field lists

---

## Proposed Repository Structure

```
src/server/repositories/
├── stream-repository.ts       # Stream CRUD operations
├── stream-member-repository.ts # Membership operations
├── stream-event-repository.ts  # Event operations
├── text-message-repository.ts  # Message content operations
├── reaction-repository.ts      # Reaction operations
├── notification-repository.ts  # Notification operations
└── index.ts                    # Re-exports
```

Each repository:
- Accepts `PoolClient` as first parameter
- Returns database rows (not mapped types)
- Has no side effects (no outbox, no external calls)
- **MUST use explicit field selection** (no `SELECT *`)

---

## Service Method → Repository Calls Mapping

### Bootstrap

#### `bootstrap(workspaceId, userId)`
**Repository calls:**
1. `WorkspaceRepo.findWorkspaceWithUserRole(client, workspaceId, userId)`
2. `StreamRepo.findUserStreamsWithUnreadCounts(client, workspaceId, userId)`
3. `UserRepo.findWorkspaceMembers(client, workspaceId)`
4. `UserRepo.findUserWorkspaceProfile(client, workspaceId, userId)`

**Notes:** All 4 queries run in parallel, no transaction needed. Consider creating a dedicated `BootstrapRepository` that combines these.

---

### Stream Operations

#### `createStream(params)`
**Repository calls (within transaction):**
1. `StreamRepo.slugExists(client, workspaceId, slug)` - if slug provided
2. `StreamRepo.insertStream(client, params)`
3. `StreamMemberRepo.insertMember(client, {streamId, userId: creatorId, role: 'owner'})`
4. If top-level stream:
   - `StreamEventRepo.insertEvent(client, {type: 'stream_created', ...})`
   - `StreamMemberRepo.updateReadCursor(client, streamId, creatorId, eventId)`

**Service responsibilities:**
- Generate IDs
- Create slug from name
- Publish outbox events
- Log creation

---

#### `getStream(streamId)`
**Repository calls:**
1. `StreamRepo.findStreamById(client, streamId)`

---

#### `findExistingDM(workspaceId, participantIds)`
**Repository calls:**
1. `StreamRepo.findExistingDM(client, workspaceId, participantIds)`

---

#### `createDM(workspaceId, creatorId, participantIds)`
**Repository calls (within transaction):**
1. `StreamRepo.findExistingDM(client, workspaceId, participantIds)` - reuse existing
2. `UserRepo.findUsersByIds(client, participantIds)` - for name generation
3. `StreamRepo.insertStream(client, {type: 'dm', ...})`
4. For each participant:
   - `StreamMemberRepo.insertMember(client, {...})`

**Service responsibilities:**
- Generate DM name from participant names
- Publish outbox events

---

#### `getStreamBySlug(workspaceId, slug)`
**Repository calls:**
1. `StreamRepo.findStreamBySlug(client, workspaceId, slug)`

---

#### `getAncestorChain(streamId)`
**Repository calls (iterative, max 10):**
For each level:
1. `StreamRepo.findStreamById(client, currentStreamId)`
2. `StreamEventRepo.findEventWithDetails(client, branchedFromEventId)`

**Optimization opportunity:** Replace with recursive CTE in single query.

---

#### `createThreadFromEvent(eventId, creatorId)`
**Repository calls (within transaction):**
1. `StreamEventRepo.findEventWithStreamAndContent(client, eventId)`
2. `StreamRepo.findStreamByBranchedFromEventId(client, eventId)` - check existing
3. `StreamRepo.insertStream(client, {type: 'thread', ...})`
4. `StreamMemberRepo.insertMember(client, {...})`
5. `StreamRepo.updateStreamName(client, streamId, name)` - if auto-named
6. `StreamEventRepo.insertEvent(client, {type: 'thread_started', ...})`

**Service responsibilities:**
- Call `generateAutoName` (external)
- Publish outbox events
- Queue enrichment (external)

---

#### `getThreadForEvent(eventId)`
**Repository calls:**
1. `StreamRepo.findStreamByBranchedFromEventId(client, eventId)`

---

#### `replyToEvent(params)`
**Repository calls (within transaction):**
1. `StreamEventRepo.findEventWithStreamAndContentForUpdate(client, eventId)` - with lock
2. `StreamRepo.findStreamByBranchedFromEventIdForUpdate(client, eventId)` - with lock
3. If no thread exists:
   - `StreamRepo.insertStream(client, {...})`
   - `StreamMemberRepo.copyParentMembership(client, parentStreamId, threadStreamId)`
   - `StreamRepo.updateStreamName(client, streamId, name)` - if auto-named
4. `StreamEventRepo.findEventByClientMessageId(client, streamId, clientMessageId)` - idempotency
5. `TextMessageRepo.insertTextMessage(client, {...})`
6. `StreamEventRepo.insertEvent(client, {...})`
7. For each mention:
   - `UserRepo.findUserById(client, actorId)` - for notification
   - `NotificationRepo.insertNotification(client, {...})`
8. `StreamMemberRepo.upsertMemberWithReadCursor(client, {...})`

**Service responsibilities:**
- Generate IDs
- Call `generateAutoName` (external)
- Publish outbox events (stream.created, event.created, notification.created, read_cursor.updated)
- Queue classification (external)

---

#### `promoteStream(params)`
**Repository calls (within transaction):**
1. `StreamRepo.findStreamById(client, streamId)`
2. `StreamRepo.slugExists(client, workspaceId, slug)`
3. `StreamRepo.updateStreamType(client, streamId, {...})`
4. `StreamEventRepo.insertEvent(client, {type: 'thread_started', ...})` - in parent

**Service responsibilities:**
- Validate stream type
- Generate slug
- Publish outbox events

---

#### `archiveStream(streamId, archivedByUserId)`
**Repository calls (within transaction):**
1. `StreamRepo.findStreamById(client, streamId)` - for workspace_id
2. `StreamRepo.archiveStream(client, streamId)`

**Service responsibilities:**
- Publish outbox event

---

#### `unarchiveStream(streamId, unarchivedByUserId)`
**Repository calls (within transaction):**
1. `StreamRepo.findStreamById(client, streamId)` - for workspace_id
2. `StreamRepo.unarchiveStream(client, streamId)`

**Service responsibilities:**
- Publish outbox event

---

#### `updateStream(streamId, updates, updatedByUserId)`
**Repository calls (within transaction):**
1. `StreamRepo.findStreamById(client, streamId)` - for validation
2. `StreamRepo.updateStreamMetadata(client, streamId, updates)`

**Service responsibilities:**
- Publish outbox event

---

### Event Operations

#### `createEvent(params)`
**Repository calls (within transaction):**
1. `StreamEventRepo.findEventByClientMessageId(client, streamId, clientMessageId)` - idempotency
2. `TextMessageRepo.insertTextMessage(client, {...})` - if message
3. `SharedRefRepo.insertSharedRef(client, {...})` - if shared
4. `StreamEventRepo.insertEvent(client, {...})`
5. `StreamRepo.findStreamById(client, streamId)` - for notifications
6. `StreamRepo.updateStreamName(client, streamId, name)` - if thinking space auto-naming
7. For each user mention:
   - `NotificationRepo.insertNotification(client, {...})`
   - `UserRepo.findUserById(client, actorId)` - for notification details
8. For each crosspost:
   - `SharedRefRepo.insertSharedRef(client, {...})`
   - `StreamEventRepo.insertEvent(client, {...})`
9. `StreamMemberRepo.updateReadCursor(client, streamId, actorId, eventId)`

**Service responsibilities:**
- Generate IDs
- Call `generateAutoName` (external)
- Publish outbox events (many!)
- Queue classification (external)
- Handle duplicate key error (race condition)

---

#### `getStreamEvents(streamId, limit, offset)`
**Repository calls:**
1. `StreamEventRepo.findEventsByStreamId(client, streamId, {limit, offset})`
2. `StreamEventRepo.findEventsByIds(client, originalEventIds)` - for shared refs hydration

**Note:** Could be combined into single query with lateral join.

---

#### `getEventWithDetails(eventId)`
**Repository calls:**
1. `StreamEventRepo.findEventWithDetails(client, eventId)`
2. If shared ref: `StreamEventRepo.findEventWithDetails(client, originalEventId)` - recursive

---

#### `editEvent(eventId, userId, newContent)`
**Repository calls (within transaction):**
1. `StreamEventRepo.findEventWithStream(client, eventId)` - for validation
2. `TextMessageRepo.findTextMessageById(client, contentId)` - get old content
3. `MessageRevisionRepo.insertMessageRevision(client, {...})`
4. `TextMessageRepo.updateTextMessageContent(client, contentId, newContent)`
5. `StreamEventRepo.updateEventEditedAt(client, eventId)`

**Service responsibilities:**
- Validate ownership
- Publish outbox event

---

#### `deleteEvent(eventId, userId)`
**Repository calls (within transaction):**
1. `StreamEventRepo.findEventWithStream(client, eventId)` - for validation
2. `StreamEventRepo.softDeleteEvent(client, eventId)`

**Service responsibilities:**
- Validate ownership
- Publish outbox event

---

### Membership Operations

#### `joinStream(streamId, userId)`
**Repository calls (within transaction):**
1. `StreamMemberRepo.upsertMember(client, {streamId, userId, role: 'member'})`
2. `StreamEventRepo.insertEvent(client, {type: 'member_joined', ...})`
3. `StreamMemberRepo.updateReadCursor(client, streamId, userId, eventId)`
4. `StreamRepo.findStreamById(client, streamId)` - for workspace info

**Service responsibilities:**
- Publish outbox events (stream_event.created, stream.member_added)

---

#### `leaveStream(streamId, userId)`
**Repository calls (within transaction):**
1. `StreamMemberRepo.removeMember(client, streamId, userId)`
2. `StreamEventRepo.insertEvent(client, {type: 'member_left', ...})`
3. `StreamRepo.findStreamById(client, streamId)` - for workspace info

**Service responsibilities:**
- Publish outbox events

---

#### `addMember(streamId, userId, addedByUserId, role)`
**Repository calls (within transaction):**
1. `StreamMemberRepo.upsertMember(client, {...})`
2. `StreamEventRepo.insertEvent(client, {type: 'member_joined', ...})`
3. `StreamRepo.findStreamById(client, streamId)` - for workspace info

**Service responsibilities:**
- Publish outbox event

---

#### `removeMember(streamId, userId, removedByUserId)`
**Repository calls (within transaction):**
1. `StreamMemberRepo.removeMember(client, streamId, userId)`
2. `StreamEventRepo.insertEvent(client, {type: 'member_left', ...})`
3. `StreamRepo.findStreamById(client, streamId)` - for workspace info

**Service responsibilities:**
- Publish outbox event

---

#### `getStreamMembers(streamId)`
**Repository calls:**
1. `StreamMemberRepo.findStreamMembers(client, streamId)`

---

### Read State

#### `updateReadCursor(streamId, userId, eventId, workspaceId)`
**Repository calls (within transaction):**
1. `StreamMemberRepo.updateReadCursor(client, streamId, userId, eventId)`

**Service responsibilities:**
- Publish outbox event

---

#### `getReadCursor(streamId, userId)`
**Repository calls:**
1. `StreamMemberRepo.getReadCursor(client, streamId, userId)`

---

### Notifications

#### `getNotificationCount(workspaceId, userId)`
**Repository calls:**
1. `NotificationRepo.countUnreadNotifications(client, workspaceId, userId)`

---

#### `getNotifications(workspaceId, userId, limit)`
**Repository calls:**
1. `NotificationRepo.findNotifications(client, workspaceId, userId, limit)`

---

#### `markNotificationAsRead(notificationId, userId)`
**Repository calls:**
1. `NotificationRepo.markNotificationRead(client, notificationId, userId)`

---

#### `markAllNotificationsAsRead(workspaceId, userId)`
**Repository calls:**
1. `NotificationRepo.markAllNotificationsRead(client, workspaceId, userId)`

---

### Utility Methods

#### `getUserEmail(userId)`
**Repository calls:**
1. `UserRepo.findUserEmail(client, userId)`

---

#### `checkSlugExists(workspaceId, slug, excludeStreamId?)`
**Repository calls:**
1. `StreamRepo.slugExists(client, workspaceId, slug, excludeStreamId)`

---

#### `checkStreamAccess(streamId, userId)`
**Repository calls:**
1. `StreamRepo.findStreamAccessChain(client, streamId, userId)`
2. If thread: `StreamRepo.findCrossPostSources(client, streamId)` - for crosspost access
3. For each crosspost source: recursive `checkStreamAccessDirect`

---

#### `checkEventAccess(eventId, userId)`
**Repository calls:**
1. `StreamEventRepo.findEventStreamId(client, eventId)`
2. Then delegates to `checkStreamAccess`

---

#### `getDiscoverableStreams(workspaceId, userId)`
**Repository calls:**
1. `StreamRepo.findDiscoverableStreams(client, workspaceId, userId)`

---

#### `pinStream(streamId, userId)`
**Repository calls:**
1. `StreamMemberRepo.pinStream(client, streamId, userId)`

---

#### `unpinStream(streamId, userId)`
**Repository calls:**
1. `StreamMemberRepo.unpinStream(client, streamId, userId)`

---

### Reactions

#### `addReaction(eventId, userId, reaction)`
**Repository calls (within transaction):**
1. `StreamEventRepo.findEventWithStream(client, eventId)`
2. `ReactionRepo.insertReaction(client, {...})`
3. `ReactionRepo.countReactionsByEventId(client, eventId)`

**Service responsibilities:**
- Publish outbox event
- Queue enrichment (external)

---

#### `removeReaction(eventId, userId, reaction)`
**Repository calls (within transaction):**
1. `StreamEventRepo.findEventWithStream(client, eventId)`
2. `ReactionRepo.softDeleteReaction(client, eventId, userId, reaction)`
3. `ReactionRepo.countReactionsByEventId(client, eventId)`

**Service responsibilities:**
- Publish outbox event

---

#### `getReactions(eventId)`
**Repository calls:**
1. `ReactionRepo.findReactionsByEventId(client, eventId)`

---

#### `getReactionCount(eventId)`
**Repository calls:**
1. `ReactionRepo.countReactionsByEventId(client, eventId)`

---

## Implementation Order

Recommended order based on isolation and dependencies:

### Phase 1: Low-hanging fruit (simple CRUD, no transactions)
1. `ReactionRepository` - isolated, few methods
2. `NotificationRepository` - isolated, few methods
3. `TextMessageRepository` - isolated, few methods

### Phase 2: Core entities
4. `StreamRepository` - core entity, many methods
5. `StreamMemberRepository` - depends on streams
6. `StreamEventRepository` - depends on streams, members

### Phase 3: Complex methods
7. Refactor simple service methods first (getters, single-repo operations)
8. Refactor complex methods (createEvent, replyToEvent) last

---

## Testing Strategy

1. **Unit tests for repositories**: Test each repository method in isolation
2. **Integration tests for services**: Test service methods with real database
3. **Keep existing tests passing**: Refactor incrementally, don't break behavior

---

## Migration Approach

1. **Create repositories alongside service**: Don't modify service yet
2. **Replace one method at a time**: Start with simple getters
3. **Use feature flags if needed**: Can roll back easily
4. **Keep service interface unchanged**: Callers don't need to change

---

## Notes

- **Outbox events remain in service**: They're part of business logic, not data access
- **ID generation remains in service**: Not repository's concern
- **Type mapping remains in service**: `mapStreamRow`, `mapEventRow` stay in service
- **External calls remain in service**: `generateAutoName`, queue operations
