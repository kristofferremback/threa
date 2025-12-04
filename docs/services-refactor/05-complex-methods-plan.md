# Phase 3 Completion - Complex Methods Refactoring Plan

This document provides detailed implementation guidance for completing the `StreamService` refactoring by converting the remaining complex methods to use the repository layer.

## Summary

**Completed in this session:**
- Stream write operations: `archiveStream`, `unarchiveStream`, `updateStream`
- Membership mutations: `joinStream`, `leaveStream`, `addMember`, `removeMember`, `updateReadCursor`

**Remaining to refactor:**
1. Event query methods (simpler)
2. Event mutations (medium complexity)
3. Stream creation methods (higher complexity)

---

## 1. Event Query Methods (Simpler)

### 1.1 `getStreamEvents()` (lines 1537-1600)

**Current state:** Uses inline SQL with LEFT JOINs for user/agent info, text messages, shared refs.

**Repository operations needed:**
- `StreamEventRepository.findEventsByStreamId()` - already exists
- `StreamEventRepository.findEventsByIds()` - already exists (for hydrating shared refs)

**Refactoring approach:**
```typescript
async getStreamEvents(streamId: string, limit = 50, offset = 0): Promise<StreamEventWithDetails[]> {
  const client = await this.pool.connect()
  try {
    const rows = await StreamEventRepository.findEventsByStreamId(client, streamId, { limit, offset })

    // Reverse for chronological order
    const events = rows.reverse()

    // Hydrate shared refs
    const sharedEvents = events.filter(e => e.content_type === 'shared_ref' && e.original_event_id)
    if (sharedEvents.length > 0) {
      const originalIds = sharedEvents.map(e => e.original_event_id!)
      const originals = await StreamEventRepository.findEventsByIds(client, originalIds)
      const originalMap = new Map(originals.map(o => [o.id, o]))
      for (const event of sharedEvents) {
        const original = originalMap.get(event.original_event_id!)
        if (original) {
          (event as any).original_event = this.mapEventRow(original)
        }
      }
    }

    return events.map(row => this.mapEventRow(row))
  } finally {
    client.release()
  }
}
```

**Notes:**
- The repository method already joins all necessary tables
- Hydration of shared refs stays in service (composition logic)

### 1.2 `getEventWithDetails()` (lines 1602-1641)

**Current state:** Uses inline SQL with all the same joins as `getStreamEvents`.

**Repository operations needed:**
- `StreamEventRepository.findEventWithDetails()` - already exists

**Refactoring approach:**
```typescript
async getEventWithDetails(eventId: string): Promise<StreamEventWithDetails | null> {
  const client = await this.pool.connect()
  try {
    const row = await StreamEventRepository.findEventWithDetails(client, eventId)
    if (!row) return null

    // Hydrate shared ref if needed (recursive call is OK - it uses pool.connect)
    if (row.content_type === 'shared_ref' && row.original_event_id) {
      const original = await this.getEventWithDetails(row.original_event_id)
      if (original) {
        (row as any).original_event = original
      }
    }

    return this.mapEventRow(row)
  } finally {
    client.release()
  }
}
```

---

## 2. Event Mutations (Medium Complexity)

### 2.1 `editEvent()` (lines 1643-1690)

**Current state:** Transaction with event lookup, authorization check, revision creation, content update, outbox event.

**Repository operations needed:**
- `StreamEventRepository.findEventWithStream()` - already exists
- `TextMessageRepository.findTextMessageById()` - needs to be added
- `TextMessageRepository.updateTextMessageContent()` - needs to be added
- `StreamEventRepository.updateEventEditedAt()` - already exists
- Add: `MessageRevisionRepository.insertRevision()` (new repository)

**New repository needed: `message-revision-repository.ts`**

```typescript
// src/server/repositories/message-revision-repository.ts
export interface InsertRevisionParams {
  id: string
  messageId: string
  content: string
}

export const MessageRevisionRepository = {
  async insertRevision(client: PoolClient, params: InsertRevisionParams): Promise<void> {
    await client.query(
      sql`INSERT INTO message_revisions (id, message_id, content)
          VALUES (${params.id}, ${params.messageId}, ${params.content})`
    )
  }
}
```

**Add to TextMessageRepository:**
```typescript
async findTextMessageById(client: PoolClient, messageId: string): Promise<{ content: string } | null> {
  const result = await client.query<{ content: string }>(
    sql`SELECT content FROM text_messages WHERE id = ${messageId}`
  )
  return result.rows[0] ?? null
}

async updateTextMessageContent(client: PoolClient, messageId: string, content: string): Promise<void> {
  await client.query(
    sql`UPDATE text_messages SET content = ${content} WHERE id = ${messageId}`
  )
}
```

**Refactoring approach:**
```typescript
async editEvent(eventId: string, userId: string, newContent: string): Promise<StreamEventWithDetails> {
  await withTransaction(this.pool, async (client) => {
    const eventRow = await StreamEventRepository.findEventWithStream(client, eventId)
    if (!eventRow) throw new Error("Event not found")
    if (eventRow.actor_id !== userId) throw new Error("Can only edit your own events")
    if (eventRow.event_type !== "message") throw new Error("Can only edit message events")
    if (!eventRow.content_id) throw new Error("Event has no content to edit")

    const oldContent = await TextMessageRepository.findTextMessageById(client, eventRow.content_id)

    const revisionId = generateId("rev")
    await MessageRevisionRepository.insertRevision(client, {
      id: revisionId,
      messageId: eventRow.content_id,
      content: oldContent?.content || "",
    })

    await TextMessageRepository.updateTextMessageContent(client, eventRow.content_id, newContent)
    await StreamEventRepository.updateEventEditedAt(client, eventId)

    await publishOutboxEvent(client, OutboxEventType.STREAM_EVENT_EDITED, {
      event_id: eventId,
      stream_id: eventRow.stream_id,
      workspace_id: eventRow.workspace_id,
      content: newContent,
      edited_at: new Date().toISOString(),
    })
  })

  return (await this.getEventWithDetails(eventId))!
}
```

### 2.2 `deleteEvent()` (lines 1692-1716)

**Current state:** Transaction with event lookup, authorization check, soft delete, outbox event.

**Repository operations needed:**
- `StreamEventRepository.findEventWithStream()` - already exists
- `StreamEventRepository.softDeleteEvent()` - already exists

**Refactoring approach:**
```typescript
async deleteEvent(eventId: string, userId: string): Promise<void> {
  await withTransaction(this.pool, async (client) => {
    const eventRow = await StreamEventRepository.findEventWithStream(client, eventId)
    if (!eventRow) throw new Error("Event not found")
    if (eventRow.actor_id !== userId) throw new Error("Can only delete your own events")

    await StreamEventRepository.softDeleteEvent(client, eventId)

    await publishOutboxEvent(client, OutboxEventType.STREAM_EVENT_DELETED, {
      event_id: eventId,
      stream_id: eventRow.stream_id,
      workspace_id: eventRow.workspace_id,
    })
  })
}
```

---

## 3. Stream Creation Methods (Higher Complexity)

### 3.1 `createStream()` (lines 364-461)

**Current state:** Transaction with slug check, stream insert, member insert, conditional event creation, multiple outbox events.

**Repository operations needed:**
- `StreamRepository.slugExists()` - already exists
- `StreamRepository.insertStream()` - already exists
- `StreamMemberRepository.insertMember()` - already exists
- `StreamEventRepository.insertEvent()` - already exists
- `StreamMemberRepository.updateReadCursor()` - already exists

**Refactoring approach:**
```typescript
async createStream(params: CreateStreamParams): Promise<Stream> {
  const streamId = generateId("stream")
  const slug = params.slug || (params.name ? createValidSlug(params.name).slug : null)

  const stream = await withTransaction(this.pool, async (client) => {
    if (slug) {
      const exists = await StreamRepository.slugExists(client, params.workspaceId, slug)
      if (exists) {
        throw new Error(`Slug "${slug}" already exists in this workspace`)
      }
    }

    const streamRow = await StreamRepository.insertStream(client, {
      id: streamId,
      workspaceId: params.workspaceId,
      streamType: params.streamType,
      name: params.name ?? null,
      slug,
      description: params.description ?? null,
      visibility: params.visibility ?? "public",
      parentStreamId: params.parentStreamId ?? null,
      branchedFromEventId: params.branchedFromEventId ?? null,
      metadata: params.metadata ?? {},
      personaId: params.personaId ?? null,
    })

    await StreamMemberRepository.insertMember(client, {
      streamId,
      userId: params.creatorId,
      role: "owner",
      addedByUserId: params.creatorId,
    })

    // For top-level streams, create stream_created event
    if (!params.parentStreamId) {
      const createdEventId = generateId("event")
      await StreamEventRepository.insertEvent(client, {
        id: createdEventId,
        streamId,
        eventType: "stream_created",
        actorId: params.creatorId,
        payload: { name: params.name, description: params.description },
      })

      await StreamMemberRepository.updateReadCursor(client, streamId, params.creatorId, createdEventId)

      await publishOutboxEvent(client, OutboxEventType.STREAM_EVENT_CREATED, {
        event_id: createdEventId,
        stream_id: streamId,
        workspace_id: params.workspaceId,
        event_type: "stream_created",
        actor_id: params.creatorId,
      })
    }

    await publishOutboxEvent(client, OutboxEventType.STREAM_CREATED, {
      stream_id: streamId,
      workspace_id: params.workspaceId,
      stream_type: params.streamType,
      name: params.name ?? null,
      slug,
      visibility: params.visibility ?? "public",
      creator_id: params.creatorId,
    })

    return this.mapStreamRow(streamRow)
  })

  logger.info({ streamId, type: params.streamType }, "Stream created")
  return stream
}
```

### 3.2 `createDM()` (lines 495-570)

**Current state:** Check existing DM, get user names, create stream, add all participants as members.

**Repository operations needed:**
- `StreamRepository.findExistingDM()` - already exists (called via `findExistingDM` service method)
- `StreamRepository.insertStream()` - already exists
- `StreamMemberRepository.insertMember()` - already exists
- Add: `UserRepository.findUsersByIds()` (new repository or use existing)

**New method needed in a UserRepository:**
```typescript
async findUsersByIds(client: PoolClient, userIds: string[]): Promise<{ id: string; name: string | null; email: string }[]> {
  const result = await client.query<{ id: string; name: string | null; email: string }>(
    sql`SELECT id, name, email FROM users WHERE id = ANY(${userIds})`
  )
  return result.rows
}
```

**Refactoring approach:**
The method should use repositories for:
1. Checking existing DM (already uses service method which uses repository)
2. Fetching user info for name generation (needs UserRepository)
3. Creating stream (StreamRepository.insertStream)
4. Adding members (StreamMemberRepository.insertMember in a loop)
5. Outbox event (publishOutboxEvent)

### 3.3 `createThreadFromEvent()` (lines 617-773)

**Current state:** Most complex thread creation logic with:
- Event lookup with message content (for auto-naming)
- Check if thread already exists
- Create thread stream
- Add thread creator as member
- Auto-name via external call
- Create thread_started event in parent
- Outbox events
- Queue enrichment (external call)

**Repository operations needed:**
- `StreamEventRepository.findEventWithStreamAndContent()` - already exists
- `StreamRepository.findStreamByBranchedFromEventId()` - already exists
- `StreamRepository.insertStream()` - already exists
- `StreamMemberRepository.insertMember()` - already exists
- `StreamRepository.updateStreamName()` - already exists
- `StreamEventRepository.insertEvent()` - already exists

**Key insight:** The method has two paths:
1. Thread exists → return existing (simple lookup)
2. Thread doesn't exist → create (complex creation)

The refactoring is mostly mechanical substitution. External calls (`generateAutoName`, `queueEnrichmentForThreadParent`) stay in service.

### 3.4 `replyToEvent()` (lines 792-1057)

**This is the most complex method.** It does:
1. Event lookup with lock (FOR UPDATE)
2. Thread lookup/creation with lock
3. Copy parent membership (if creating thread)
4. Auto-name thread
5. Idempotency check
6. Create text message
7. Create event
8. Handle mentions → create notifications
9. Update read cursor
10. Multiple outbox events
11. Queue classification (external)

**Repository operations needed:**
- `StreamEventRepository.findEventWithStreamAndContent()` - needs FOR UPDATE variant
- `StreamRepository.findStreamByBranchedFromEventIdForUpdate()` - already exists
- `StreamRepository.insertStream()` - already exists
- `StreamMemberRepository.copyParentMembership()` - already exists
- `StreamRepository.updateStreamName()` - already exists
- `StreamEventRepository.findEventByClientMessageId()` - already exists
- `TextMessageRepository.insertTextMessage()` - already exists
- `StreamEventRepository.insertEvent()` - already exists
- `NotificationRepository.insertNotification()` - already exists
- `StreamMemberRepository.upsertMemberWithReadCursor()` - already exists

**New repository method needed:**
```typescript
// In StreamEventRepository
async findEventWithStreamAndContentForUpdate(
  client: PoolClient,
  eventId: string,
): Promise<EventWithContentRow | null> {
  // Same as findEventWithStreamAndContent but with FOR UPDATE OF e
}
```

**Approach:**
This method benefits from incremental refactoring. Tackle one section at a time:
1. First pass: Replace event lookup with repository
2. Second pass: Replace thread lookup/creation with repository
3. Third pass: Replace membership operations with repository
4. Fourth pass: Replace message/event creation with repository
5. Fifth pass: Replace notification creation with repository
6. Keep: External calls, outbox events, idempotency logic structure

### 3.5 `promoteStream()` (lines 1059-1133)

**Current state:** Get stream, validate type, check slug, update type, create event, outbox.

**Repository operations needed:**
- `StreamRepository.findStreamById()` - already exists
- `StreamRepository.slugExists()` - already exists
- `StreamRepository.updateStreamType()` - already exists
- `StreamEventRepository.insertEvent()` - already exists

**Refactoring approach:**
```typescript
async promoteStream(params: PromoteStreamParams): Promise<Stream> {
  const streamRow = await withTransaction(this.pool, async (client) => {
    const current = await StreamRepository.findStreamById(client, params.streamId)
    if (!current) throw new Error("Stream not found")
    if (current.stream_type !== "thread") throw new Error("Only threads can be promoted")

    const slug = params.slug || createValidSlug(params.name).slug

    const exists = await StreamRepository.slugExists(client, current.workspace_id, slug)
    if (exists) throw new Error(`Slug "${slug}" already exists in this workspace`)

    const result = await StreamRepository.updateStreamType(client, params.streamId, {
      streamType: params.newType,
      name: params.name,
      slug,
      visibility: params.visibility || current.visibility,
      promotedBy: params.userId,
    })

    if (current.parent_stream_id) {
      const eventId = generateId("event")
      await StreamEventRepository.insertEvent(client, {
        id: eventId,
        streamId: current.parent_stream_id,
        eventType: "thread_started",
        actorId: params.userId,
        payload: {
          promoted_to: params.newType,
          new_name: params.name,
          new_slug: slug,
          stream_id: params.streamId,
        },
      })
    }

    await publishOutboxEvent(client, OutboxEventType.STREAM_PROMOTED, {
      stream_id: params.streamId,
      workspace_id: current.workspace_id,
      new_type: params.newType,
      new_name: params.name,
      new_slug: slug,
      promoted_by: params.userId,
    })

    return result
  })

  logger.info({ streamId: params.streamId, newType: params.newType }, "Stream promoted")
  return this.mapStreamRow(streamRow)
}
```

### 3.6 `createEvent()` (lines 1211-1535)

**This is the second most complex method.** It handles:
1. Validation (actorId or agentId required)
2. Idempotency check
3. Content creation (text_message or shared_ref)
4. Event creation
5. Auto-naming for thinking spaces
6. Mention handling → notifications
7. Crosspost handling → events in other streams
8. Read cursor update
9. Multiple outbox events
10. Post-transaction async work (classification, auto-naming retry)
11. Duplicate key error handling for race conditions

**Repository operations needed:**
- `StreamEventRepository.findEventByClientMessageId()` - already exists
- `TextMessageRepository.insertTextMessage()` - already exists
- Add: `SharedRefRepository.insertSharedRef()` (new repository)
- `StreamEventRepository.insertEvent()` - already exists
- `StreamRepository.findStreamById()` - already exists
- `StreamRepository.updateStreamName()` - already exists
- `NotificationRepository.insertNotification()` - already exists
- Add: `UserRepository.findUserById()` (for actor info in notifications)
- `StreamMemberRepository.updateReadCursor()` - already exists

**New repository needed: `shared-ref-repository.ts`**
```typescript
export interface InsertSharedRefParams {
  id: string
  originalEventId: string
  context: string | null
}

export const SharedRefRepository = {
  async insertSharedRef(client: PoolClient, params: InsertSharedRefParams): Promise<void> {
    await client.query(
      sql`INSERT INTO shared_refs (id, original_event_id, context)
          VALUES (${params.id}, ${params.originalEventId}, ${params.context})`
    )
  }
}
```

**Approach:**
Like `replyToEvent`, this benefits from incremental refactoring:
1. First pass: Replace idempotency check
2. Second pass: Replace content creation
3. Third pass: Replace event creation and stream lookup
4. Fourth pass: Replace mention/notification handling
5. Fifth pass: Replace crosspost handling
6. Sixth pass: Replace read cursor update
7. Keep: External calls, error handling logic, async post-work

---

## 4. Recommended Execution Order

1. **Event query methods** (simplest, quick wins)
   - `getStreamEvents()`
   - `getEventWithDetails()`

2. **Event mutations** (medium, requires small repository additions)
   - Create `MessageRevisionRepository`
   - Add methods to `TextMessageRepository`
   - `editEvent()`
   - `deleteEvent()`

3. **Simpler creation methods**
   - `promoteStream()` (straightforward)
   - `createStream()` (pattern established)

4. **DM and thread creation**
   - Consider adding `UserRepository`
   - `createDM()`
   - `createThreadFromEvent()`

5. **Most complex methods** (last, most risk)
   - Create `SharedRefRepository`
   - `createEvent()` (incremental)
   - `replyToEvent()` (incremental, most complex)

---

## 5. New Repositories Needed

### 5.1 `message-revision-repository.ts`
- `insertRevision(params)` - create revision before edit

### 5.2 `shared-ref-repository.ts`
- `insertSharedRef(params)` - create shared ref for crossposts

### 5.3 `user-repository.ts` (optional, for cleaner code)
- `findUserById(userId)` - get user info
- `findUsersByIds(userIds)` - batch user lookup

---

## 6. Repository Methods to Add

### TextMessageRepository
- `findTextMessageById(messageId)` - get content for revision
- `updateTextMessageContent(messageId, content)` - update after edit

### StreamEventRepository
- `findEventWithStreamAndContentForUpdate(eventId)` - locking variant

---

## 7. Patterns to Remember

1. **Simple reads:** `pool.connect()` → repository call → `client.release()` in finally
2. **Writes with outbox:** `withTransaction()` → repository calls → `publishOutboxEvent()` → return
3. **External calls:** Stay in service, run after transaction or fire-and-forget with `.catch()`
4. **ID generation:** `generateId()` stays in service
5. **Type mapping:** `mapStreamRow()`, `mapEventRow()` stay in service
6. **Logging:** Stays in service

---

## 8. Testing Strategy

After each refactored method:
1. Run TypeScript check: `bunx tsc --noEmit`
2. Run relevant tests (if they exist)
3. Manual smoke test in dev environment if critical path

---

## 9. Files to Update

- `src/server/services/stream-service.ts` - main refactoring
- `src/server/repositories/index.ts` - export new repositories
- `src/server/repositories/text-message-repository.ts` - add methods
- `src/server/repositories/stream-event-repository.ts` - add FOR UPDATE variant
- Create: `src/server/repositories/message-revision-repository.ts`
- Create: `src/server/repositories/shared-ref-repository.ts`
- Optional: `src/server/repositories/user-repository.ts`
