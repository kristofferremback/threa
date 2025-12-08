# Stream Service Exploration

This document provides a comprehensive analysis of `src/server/services/stream-service.ts` (2655 lines), explaining each method, its purpose, and database operations.

> **Note**: The SQL examples in this document reflect the *current* implementation, which uses `SELECT *` patterns. The refactored repositories should use explicit field lists as documented in [02-domain-operations.md](./02-domain-operations.md).

---

## Overview

The `StreamService` class is the largest service in the codebase, handling:
- **Streams**: Channels, threads, DMs, thinking spaces
- **Events**: Messages, shares, member joins/leaves
- **Membership**: Join, leave, add, remove members
- **Read State**: Tracking what users have read
- **Notifications**: Mention notifications
- **Reactions**: Message reactions

The service takes a `Pool` (pg) and uses `withTransaction` for multi-step operations.

---

## Types (Lines 15-210)

### Core Types
| Type | Values | Purpose |
|------|--------|---------|
| `StreamType` | channel, thread, dm, incident, thinking_space | Stream classification |
| `StreamVisibility` | public, private, inherit | Access control |
| `StreamStatus` | active, archived, resolved | Lifecycle state |
| `EventType` | message, shared, member_joined, member_left, thread_started, poll, file, agent_thinking | Event classification |
| `NotifyLevel` | all, mentions, muted, default | User notification preference |
| `MemberRole` | owner, admin, member | Permission level |

### Key Interfaces
- `Stream` - Core stream entity with metadata
- `StreamMember` - User membership in a stream
- `StreamEvent` - An event in a stream's timeline
- `StreamEventWithDetails` - Event with joined actor/content data
- `BootstrapStream` - Lightweight stream for initial load
- `StreamAccessResult` - Result of access check with reasons

---

## Bootstrap (Lines 222-350)

### `bootstrap(workspaceId, userId): Promise<BootstrapResult>`

**Purpose**: Load initial data when user enters a workspace - workspace info, streams, users, profile.

**Database Calls** (4 parallel queries):

1. **Workspace + user role**
   ```sql
   SELECT w.id, w.name, w.slug, w.plan_tier, wm.role
   FROM workspaces w
   INNER JOIN workspace_members wm ON w.id = wm.workspace_id
   WHERE w.id = $workspaceId AND wm.user_id = $userId
   ```
   *Purpose*: Get workspace details and verify user is a member.

2. **User's joined streams with unread counts**
   ```sql
   SELECT s.*, sm.last_read_at, sm.pinned_at, sm.notify_level,
          (SELECT COUNT(*) FROM stream_events e
           WHERE e.stream_id = s.id
           AND e.created_at > COALESCE(sm.last_read_at, '1970-01-01')
           AND e.deleted_at IS NULL
           AND e.actor_id != $userId) as unread_count
   FROM streams s
   INNER JOIN stream_members sm ON s.id = sm.stream_id
   WHERE s.workspace_id = $workspaceId
     AND s.archived_at IS NULL
     AND s.stream_type IN ('channel', 'dm', 'thinking_space')
   ORDER BY sm.pinned_at DESC NULLS LAST, s.name
   ```
   *Purpose*: Get all streams user is a member of, with unread counts. Only top-level streams (not threads).

3. **All workspace members**
   ```sql
   SELECT u.id, u.email, COALESCE(wp.display_name, u.name) as name,
          wp.title, wp.avatar_url, wm.role
   FROM users u
   INNER JOIN workspace_members wm ON u.id = wm.user_id
   LEFT JOIN workspace_profiles wp ON ...
   WHERE wm.workspace_id = $workspaceId AND wm.status = 'active'
   ORDER BY name
   ```
   *Purpose*: List all workspace members for @mentions and user lists.

4. **Current user's workspace profile**
   ```sql
   SELECT wp.display_name, wp.title, wp.avatar_url, wp.profile_managed_by_sso
   FROM workspace_members wm
   LEFT JOIN workspace_profiles wp ON ...
   WHERE wm.workspace_id = $workspaceId AND wm.user_id = $userId
   ```
   *Purpose*: Get current user's profile, determine if profile setup is needed.

---

## Stream Operations (Lines 352-1235)

### `createStream(params): Promise<Stream>`

**Purpose**: Create a new stream (channel, thread, DM, etc.)

**Database Calls** (within transaction):

1. **Check slug uniqueness**
   ```sql
   SELECT 1 FROM streams WHERE workspace_id = $workspaceId AND slug = $slug
   ```

2. **Insert stream**
   ```sql
   INSERT INTO streams (id, workspace_id, stream_type, name, slug, ...)
   VALUES (...) RETURNING *
   ```

3. **Add creator as owner**
   ```sql
   INSERT INTO stream_members (stream_id, user_id, role, added_by_user_id)
   VALUES ($streamId, $creatorId, 'owner', $creatorId)
   ```

4. **For top-level streams - create "stream_created" event**
   ```sql
   INSERT INTO stream_events (id, stream_id, event_type, actor_id, payload)
   VALUES (...)
   ```

5. **Mark as read for creator**
   ```sql
   UPDATE stream_members SET last_read_event_id = $eventId, last_read_at = NOW()
   WHERE stream_id = $streamId AND user_id = $creatorId
   ```

6. **Two outbox inserts + NOTIFY** for real-time broadcast

---

### `getStream(streamId): Promise<Stream | null>`

**Purpose**: Fetch a single stream by ID.

**Database Calls**:
```sql
SELECT * FROM streams WHERE id = $streamId
```

---

### `findExistingDM(workspaceId, participantIds): Promise<Stream | null>`

**Purpose**: Find if a DM already exists with exact same participants.

**Database Calls**:
```sql
SELECT s.* FROM streams s
WHERE s.workspace_id = $workspaceId
  AND s.stream_type = 'dm'
  AND s.archived_at IS NULL
  AND (SELECT COUNT(*) FROM stream_members sm WHERE sm.stream_id = s.id AND sm.left_at IS NULL) = $participantCount
  AND NOT EXISTS (
    SELECT 1 FROM unnest($participantIds::text[]) as pid
    WHERE pid NOT IN (SELECT user_id FROM stream_members sm2 WHERE sm2.stream_id = s.id AND sm2.left_at IS NULL)
  )
```
*Uses array operations and subqueries to match exact participant set.*

---

### `createDM(workspaceId, creatorId, participantIds): Promise<{stream, created}>`

**Purpose**: Create a DM or return existing one. Generates display name from participants.

**Database Calls** (within transaction):

1. **Get participant names**
   ```sql
   SELECT id, name, email FROM users WHERE id = ANY($participantIds)
   ```

2. **Insert DM stream** (similar to createStream)

3. **Add all participants as members** (loop)
   ```sql
   INSERT INTO stream_members (stream_id, user_id, role, added_by_user_id)
   VALUES ($streamId, $participantId, $role, $creatorId)
   ```

4. **Outbox event**

---

### `getStreamBySlug(workspaceId, slug): Promise<Stream | null>`

**Purpose**: Fetch stream by slug (URL-friendly name).

**Database Calls**:
```sql
SELECT * FROM streams WHERE workspace_id = $workspaceId AND slug = $slug
```

---

### `getAncestorChain(streamId): Promise<{ancestors, rootStream}>`

**Purpose**: Walk up the parent chain to find all ancestor events and root channel.

**Database Calls**: Iterative (max 10 iterations):
1. `getStream(currentStreamId)` - fetch current stream
2. `getEventWithDetails(stream.branchedFromEventId)` - get branching event

*Note*: This is N+1 queries. Could be optimized with recursive CTE.

---

### `createThreadFromEvent(eventId, creatorId): Promise<{stream, event}>`

**Purpose**: Create a thread from an existing message event.

**Database Calls** (within transaction):

1. **Get original event with message content**
   ```sql
   SELECT e.*, s.workspace_id, s.id as parent_stream_id, tm.content as message_content
   FROM stream_events e
   INNER JOIN streams s ON e.stream_id = s.id
   LEFT JOIN text_messages tm ON e.content_type = 'text_message' AND e.content_id = tm.id
   WHERE e.id = $eventId
   ```

2. **Check if thread already exists**
   ```sql
   SELECT * FROM streams WHERE branched_from_event_id = $eventId
   ```

3. **Insert thread stream**
   ```sql
   INSERT INTO streams (id, workspace_id, stream_type, parent_stream_id, branched_from_event_id, visibility)
   VALUES ($streamId, $workspaceId, 'thread', $parentStreamId, $eventId, 'inherit')
   ```

4. **Add creator as member**
   ```sql
   INSERT INTO stream_members (stream_id, user_id, role, notify_level)
   VALUES ($streamId, $creatorId, 'owner', 'all')
   ON CONFLICT DO NOTHING
   ```

5. **Auto-name via external LLM call** (`generateAutoName`)

6. **Create "thread_started" event in parent stream**
   ```sql
   INSERT INTO stream_events (id, stream_id, event_type, actor_id, payload)
   VALUES ($eventId, $parentStreamId, 'thread_started', $creatorId, ...)
   ```

7. **Outbox event for stream.created**

**Post-transaction**: Queue enrichment for parent message.

---

### `getThreadForEvent(eventId): Promise<Stream | null>`

**Purpose**: Check if a thread exists for an event.

**Database Calls**:
```sql
SELECT * FROM streams WHERE branched_from_event_id = $eventId
```

---

### `replyToEvent(params): Promise<ReplyToEventResult>`

**Purpose**: Reply to a message - atomically creates thread if needed, then posts message.

**Database Calls** (within transaction):

1. **Get original event with FOR UPDATE lock**
   ```sql
   SELECT e.*, s.workspace_id, tm.content as message_content
   FROM stream_events e
   INNER JOIN streams s ON e.stream_id = s.id
   LEFT JOIN text_messages tm ON ...
   WHERE e.id = $eventId
   FOR UPDATE OF e
   ```

2. **Check/lock existing thread**
   ```sql
   SELECT * FROM streams WHERE branched_from_event_id = $eventId FOR UPDATE
   ```

3. **If no thread - create it** (insert + copy parent members)

4. **Idempotency check via client_message_id**
   ```sql
   SELECT ... FROM stream_events se
   WHERE se.client_message_id = $clientMessageId AND se.stream_id = $threadId
   ```

5. **Insert message content**
   ```sql
   INSERT INTO text_messages (id, content, mentions) VALUES (...)
   ```

6. **Insert event**
   ```sql
   INSERT INTO stream_events (id, stream_id, event_type, actor_id, content_type, content_id, client_message_id)
   VALUES (...)
   ```

7. **Outbox event for event.created**

8. **Handle mentions - create notifications** (loop for each mention)
   ```sql
   INSERT INTO notifications (...) VALUES (...)
   ```

9. **Mark as read for sender**
   ```sql
   INSERT INTO stream_members (stream_id, user_id, last_read_event_id, last_read_at)
   VALUES (...) ON CONFLICT DO UPDATE SET ...
   ```

10. **Outbox event for read_cursor.updated**

---

### `promoteStream(params): Promise<Stream>`

**Purpose**: Promote a thread to a full channel or incident.

**Database Calls** (within transaction):

1. **Get current stream** + validate is thread
2. **Check slug uniqueness**
3. **Update stream**
   ```sql
   UPDATE streams SET stream_type = $newType, name = $name, slug = $slug,
          visibility = $visibility, promoted_at = NOW(), promoted_by = $userId
   WHERE id = $streamId RETURNING *
   ```
4. **Create system event in parent stream**
5. **Outbox event**

---

### `archiveStream(streamId, archivedByUserId): Promise<void>`

**Purpose**: Archive a stream (soft delete).

**Database Calls** (within transaction):
1. Get workspace_id
2. `UPDATE streams SET archived_at = NOW() WHERE id = $streamId`
3. Outbox event via `publishOutboxEvent`

---

### `unarchiveStream(streamId, unarchivedByUserId): Promise<void>`

**Purpose**: Restore an archived stream.

**Database Calls** (within transaction):
1. Get workspace_id
2. `UPDATE streams SET archived_at = NULL WHERE id = $streamId`
3. Outbox event

---

### `updateStream(streamId, updates, updatedByUserId): Promise<Stream>`

**Purpose**: Update stream name, description, or topic.

**Database Calls** (within transaction):
1. Get current stream
2. `UPDATE streams SET name = COALESCE($name, name), ... WHERE id = $streamId`
3. Outbox event via `publishOutboxEvent`

---

## Event Operations (Lines 1237-1746)

### `createEvent(params): Promise<StreamEventWithDetails>`

**Purpose**: Create a new event (message, share, etc.) in a stream.

**Database Calls** (within transaction):

1. **Idempotency check**
   ```sql
   SELECT ... FROM stream_events se WHERE se.client_message_id = $clientMessageId
   ```

2. **Create content** (for messages):
   ```sql
   INSERT INTO text_messages (id, content, mentions) VALUES (...)
   ```

3. **Create event**
   ```sql
   INSERT INTO stream_events (id, stream_id, event_type, actor_id, agent_id, content_type, content_id, payload, client_message_id)
   VALUES (...)
   ```

4. **Get stream info**
   ```sql
   SELECT workspace_id, stream_type, parent_stream_id, slug, name FROM streams WHERE id = $streamId
   ```

5. **Auto-name thinking spaces** (if first message + unnamed)
   - `generateAutoName` call
   - `UPDATE streams SET name = $name WHERE id = $streamId`
   - Outbox event for stream.updated

6. **Handle mentions** (loop):
   - Insert notifications
   - Outbox events for each notification

7. **Handle crossposts** (loop):
   - Insert shared_refs
   - Insert stream_events for target streams
   - Outbox events

8. **Main event outbox**

9. **Update read cursor for author**
   ```sql
   UPDATE stream_members SET last_read_event_id = $eventId WHERE stream_id = $streamId AND user_id = $actorId
   ```

10. **Read cursor outbox event**

**Error Handling**: Catches duplicate key on client_message_id (race condition) and returns existing event.

---

### `getStreamEvents(streamId, limit, offset): Promise<StreamEventWithDetails[]>`

**Purpose**: Fetch paginated events for a stream with full details.

**Database Calls**:

1. **Main query with joins**
   ```sql
   SELECT e.*, u.email, COALESCE(wp.display_name, u.name) as actor_name,
          ap.name as agent_name, tm.content, tm.mentions,
          sr.original_event_id, sr.context as share_context,
          (SELECT COUNT(*) FROM stream_events se2
           INNER JOIN streams t ON se2.stream_id = t.id
           WHERE t.branched_from_event_id = e.id
             AND se2.deleted_at IS NULL AND se2.event_type = 'message') as reply_count
   FROM stream_events e
   INNER JOIN streams s ON e.stream_id = s.id
   LEFT JOIN users u ON e.actor_id = u.id
   LEFT JOIN workspace_profiles wp ON ...
   LEFT JOIN agent_personas ap ON e.agent_id = ap.id
   LEFT JOIN text_messages tm ON ...
   LEFT JOIN shared_refs sr ON ...
   WHERE e.stream_id = $streamId AND e.deleted_at IS NULL
   ORDER BY e.created_at DESC
   LIMIT $limit OFFSET $offset
   ```

2. **Hydrate shared refs** - fetch original events for any shares:
   ```sql
   SELECT e.*, u.email, ... FROM stream_events e WHERE e.id = ANY($originalIds)
   ```

*Note*: The reply_count subquery is N+1 for each event. Could be optimized.

---

### `getEventWithDetails(eventId): Promise<StreamEventWithDetails | null>`

**Purpose**: Fetch a single event with all details.

**Database Calls**: Same complex query as `getStreamEvents` but for single event + recursive hydration for shared refs.

---

### `editEvent(eventId, userId, newContent): Promise<StreamEventWithDetails>`

**Purpose**: Edit a message event.

**Database Calls** (within transaction):

1. **Get event + validate ownership**
   ```sql
   SELECT e.*, s.workspace_id FROM stream_events e INNER JOIN streams s ON ... WHERE e.id = $eventId
   ```

2. **Get old content**
   ```sql
   SELECT content FROM text_messages WHERE id = $contentId
   ```

3. **Create revision**
   ```sql
   INSERT INTO message_revisions (id, message_id, content) VALUES (...)
   ```

4. **Update content**
   ```sql
   UPDATE text_messages SET content = $newContent WHERE id = $contentId
   ```

5. **Update event timestamp**
   ```sql
   UPDATE stream_events SET edited_at = NOW() WHERE id = $eventId
   ```

6. **Outbox event for stream_event.edited**

---

### `deleteEvent(eventId, userId): Promise<void>`

**Purpose**: Soft-delete a message event.

**Database Calls** (within transaction):
1. Get event + validate ownership
2. `UPDATE stream_events SET deleted_at = NOW() WHERE id = $eventId`
3. Outbox event for stream_event.deleted

---

## Membership Operations (Lines 1749-1952)

### `joinStream(streamId, userId): Promise<{stream, event}>`

**Purpose**: User joins a stream.

**Database Calls** (within transaction):

1. **Upsert membership**
   ```sql
   INSERT INTO stream_members (stream_id, user_id, role)
   VALUES ($streamId, $userId, 'member')
   ON CONFLICT (stream_id, user_id) DO UPDATE SET left_at = NULL
   ```

2. **Create member_joined event**

3. **Mark as read** (since they just joined)

4. **Get stream info**

5. **Two outbox events**: stream_event.created + stream.member_added

---

### `leaveStream(streamId, userId): Promise<void>`

**Purpose**: User leaves a stream.

**Database Calls** (within transaction):
1. `UPDATE stream_members SET left_at = NOW() WHERE ...`
2. Create member_left event
3. Two outbox events

---

### `addMember(streamId, userId, addedByUserId, role): Promise<void>`

**Purpose**: Add a member to a stream (by another user).

**Database Calls** (within transaction):
1. Upsert membership (like joinStream)
2. Create member_joined event with added_by info
3. Get stream info
4. Outbox event for stream.member_added

---

### `removeMember(streamId, userId, removedByUserId): Promise<void>`

**Purpose**: Remove a member from a stream (by another user).

**Database Calls** (within transaction):
1. Update left_at
2. Create member_left event with removed_by info
3. Get stream info
4. Outbox event

---

### `getStreamMembers(streamId): Promise<Array<StreamMember & {email, name}>>`

**Purpose**: List all current members of a stream.

**Database Calls**:
```sql
SELECT sm.*, u.email, u.name
FROM stream_members sm
INNER JOIN users u ON sm.user_id = u.id
WHERE sm.stream_id = $streamId AND sm.left_at IS NULL
ORDER BY sm.joined_at
```

---

## Read State (Lines 1954-1986)

### `updateReadCursor(streamId, userId, eventId, workspaceId): Promise<void>`

**Purpose**: Mark messages as read up to a certain event.

**Database Calls** (within transaction):
1. `UPDATE stream_members SET last_read_event_id = $eventId, last_read_at = NOW() WHERE ...`
2. Outbox event for read_cursor.updated

---

### `getReadCursor(streamId, userId): Promise<string | null>`

**Purpose**: Get user's last read event in a stream.

**Database Calls**:
```sql
SELECT last_read_event_id FROM stream_members WHERE stream_id = $streamId AND user_id = $userId
```

---

## Notifications (Lines 1988-2055)

### `getNotificationCount(workspaceId, userId): Promise<number>`

**Purpose**: Count unread notifications.

**Database Calls**:
```sql
SELECT COUNT(*)::int FROM notifications
WHERE workspace_id = $workspaceId AND user_id = $userId AND read_at IS NULL
```

---

### `getNotifications(workspaceId, userId, limit): Promise<any[]>`

**Purpose**: List notifications with details.

**Database Calls**:
```sql
SELECT n.*, u.email, COALESCE(wp.display_name, u.name) as actor_name,
       s.name as stream_name, s.slug, s.stream_type
FROM notifications n
LEFT JOIN users u ON n.actor_id = u.id
LEFT JOIN workspace_profiles wp ON ...
LEFT JOIN streams s ON n.stream_id = s.id
WHERE n.workspace_id = $workspaceId AND n.user_id = $userId
ORDER BY n.created_at DESC LIMIT $limit
```

---

### `markNotificationAsRead(notificationId, userId): Promise<void>`

**Purpose**: Mark single notification as read.

**Database Calls**:
```sql
UPDATE notifications SET read_at = NOW() WHERE id = $notificationId AND user_id = $userId
```

---

### `markAllNotificationsAsRead(workspaceId, userId): Promise<void>`

**Purpose**: Mark all notifications as read.

**Database Calls**:
```sql
UPDATE notifications SET read_at = NOW()
WHERE workspace_id = $workspaceId AND user_id = $userId AND read_at IS NULL
```

---

## Utility Methods (Lines 2057-2446)

### `getUserEmail(userId): Promise<string | null>`

**Database Calls**:
```sql
SELECT email FROM users WHERE id = $userId
```

---

### `checkSlugExists(workspaceId, slug, excludeStreamId?): Promise<boolean>`

**Database Calls**:
```sql
SELECT 1 FROM streams WHERE workspace_id = $workspaceId AND slug = $slug
  AND ($excludeStreamId IS NULL OR id != $excludeStreamId)
```

---

### `checkStreamAccess(streamId, userId): Promise<StreamAccessResult>`

**Purpose**: Check if user can access a stream. Uses recursive CTE for efficient graph traversal.

**Database Calls**:

1. **Recursive CTE to traverse parent chain**
   ```sql
   WITH RECURSIVE stream_chain AS (
     -- Base: target stream
     SELECT s.id, s.visibility, s.stream_type, s.parent_stream_id,
            CASE WHEN sm.user_id IS NOT NULL THEN true ELSE false END as is_member,
            0 as depth
     FROM streams s
     LEFT JOIN stream_members sm ON s.id = sm.stream_id AND sm.user_id = $userId AND sm.left_at IS NULL
     WHERE s.id = $streamId

     UNION ALL

     -- Recursive: parents
     SELECT p.id, p.visibility, p.stream_type, p.parent_stream_id,
            CASE WHEN sm.user_id IS NOT NULL THEN true ELSE false END as is_member,
            sc.depth + 1
     FROM stream_chain sc
     INNER JOIN streams p ON p.id = sc.parent_stream_id
     LEFT JOIN stream_members sm ON p.id = sm.stream_id AND sm.user_id = $userId AND sm.left_at IS NULL
     WHERE sc.depth < 10
   )
   SELECT * FROM stream_chain ORDER BY depth
   ```

2. **If thread and not member - check cross-post access**

**Access logic**:
- Direct member → full access
- Thread + member of ancestor channel/thinking_space → access via inheritance
- Cross-post → access if can access source stream
- Public → read-only access
- Inherit visibility → check parent chain
- Private + not member → no access

---

### `checkCrossPostAccess(streamId, userId): Promise<StreamAccessResult>` (private)

**Purpose**: Check access through cross-posts.

**Database Calls**:
```sql
SELECT DISTINCT source_event.stream_id
FROM stream_events e
INNER JOIN shared_refs sr ON e.content_type = 'shared_ref' AND e.content_id = sr.id
INNER JOIN stream_events source_event ON sr.original_event_id = source_event.id
WHERE e.stream_id = $streamId AND e.deleted_at IS NULL
```
Then recursively checks access to each source stream.

---

### `checkEventAccess(eventId, userId): Promise<StreamAccessResult>`

**Purpose**: Check if user can reply to an event.

**Database Calls**:
1. `SELECT stream_id FROM stream_events WHERE id = $eventId`
2. `checkStreamAccess(streamId, userId)`

---

### `getDiscoverableStreams(workspaceId, userId): Promise<BootstrapStream[]>`

**Purpose**: Get public channels user can join.

**Database Calls**:
```sql
SELECT s.*, CASE WHEN sm.user_id IS NOT NULL THEN true ELSE false END as is_member,
       (SELECT COUNT(*)::int FROM stream_members WHERE stream_id = s.id AND left_at IS NULL) as member_count
FROM streams s
LEFT JOIN stream_members sm ON s.id = sm.stream_id AND sm.user_id = $userId AND sm.left_at IS NULL
WHERE s.workspace_id = $workspaceId
  AND s.archived_at IS NULL
  AND s.stream_type = 'channel'
  AND s.visibility = 'public'
ORDER BY s.name
```

---

### `pinStream(streamId, userId): Promise<void>`

**Database Calls**:
```sql
UPDATE stream_members SET pinned_at = NOW() WHERE stream_id = $streamId AND user_id = $userId
```

---

### `unpinStream(streamId, userId): Promise<void>`

**Database Calls**:
```sql
UPDATE stream_members SET pinned_at = NULL WHERE stream_id = $streamId AND user_id = $userId
```

---

### `retryAutoNameIfNeeded(streamId, workspaceId): Promise<void>` (private)

**Purpose**: Retry auto-naming for unnamed streams after more messages added.

**Database Calls**:
1. Get message count
2. Check if stream still unnamed
3. Fetch recent messages for context
4. Update stream name if successful
5. Outbox event

---

## Reactions (Lines 2500-2654)

### `addReaction(eventId, userId, reaction): Promise<void>`

**Purpose**: Add a reaction (emoji) to a message.

**Database Calls** (within transaction):
1. **Get event info**
   ```sql
   SELECT e.id, e.stream_id, e.content_type, e.content_id, s.workspace_id
   FROM stream_events e JOIN streams s ON ... WHERE e.id = $eventId
   ```

2. **Upsert reaction**
   ```sql
   INSERT INTO message_reactions (id, message_id, user_id, reaction)
   VALUES (...) ON CONFLICT (message_id, user_id, reaction) DO NOTHING
   ```

3. **Get reaction count**
   ```sql
   SELECT COUNT(*) FROM message_reactions WHERE message_id = $eventId AND deleted_at IS NULL
   ```

4. **Outbox event for reaction.added**

**Post-transaction**: Queue enrichment if enough reactions.

---

### `removeReaction(eventId, userId, reaction): Promise<void>`

**Purpose**: Remove a reaction.

**Database Calls** (within transaction):
1. Get event info
2. Soft-delete reaction: `UPDATE message_reactions SET deleted_at = NOW() WHERE ...`
3. Get updated count
4. Outbox event

---

### `getReactions(eventId): Promise<Array<{userId, reaction, createdAt}>>`

**Database Calls**:
```sql
SELECT user_id, reaction, created_at FROM message_reactions
WHERE message_id = $eventId AND deleted_at IS NULL
ORDER BY created_at ASC
```

---

### `getReactionCount(eventId): Promise<number>`

**Database Calls**:
```sql
SELECT COUNT(*) FROM message_reactions WHERE message_id = $eventId AND deleted_at IS NULL
```

---

## Summary of Database Tables Accessed

| Table | Operations |
|-------|------------|
| `workspaces` | Read |
| `workspace_members` | Read |
| `workspace_profiles` | Read |
| `users` | Read |
| `streams` | CRUD |
| `stream_members` | CRUD |
| `stream_events` | CRUD |
| `text_messages` | Create, Read, Update |
| `shared_refs` | Create, Read |
| `message_revisions` | Create |
| `message_reactions` | Create, Read, Update (soft delete) |
| `notifications` | Create, Read, Update |
| `outbox` | Create (for real-time events) |
| `agent_personas` | Read (for agent names) |

---

## Identified Issues

1. **N+1 queries**: `getAncestorChain` iteratively fetches streams
2. **Reply count subquery**: Executed per-event in `getStreamEvents`
3. **Large transaction scope**: Some methods do many operations in one transaction
4. **Mixed concerns**: Business logic, notifications, auto-naming, queuing all in one service
5. **Duplicate code**: Similar queries for getting streams/events repeated
