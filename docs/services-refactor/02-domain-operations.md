# Domain Operations for Stream Repository

This document identifies the database operations from `stream-service.ts` that can be generalized into a repository layer. The repository will accept a `PoolClient` to work within transactions controlled by the service layer.

---

## Database Schema Reference

### `streams` Table
```
id                     | text           | NOT NULL (PK)
workspace_id           | text           | NOT NULL
stream_type            | text           | NOT NULL
name                   | text           | nullable
slug                   | text           | nullable
description            | text           | nullable
topic                  | text           | nullable
parent_stream_id       | text           | nullable (FK → streams)
branched_from_event_id | text           | nullable
visibility             | text           | NOT NULL, default 'public'
status                 | text           | NOT NULL, default 'active'
promoted_at            | timestamptz    | nullable
promoted_by            | text           | nullable
metadata               | jsonb          | default '{}'
created_at             | timestamptz    | NOT NULL, default now()
updated_at             | timestamptz    | NOT NULL, default now()
archived_at            | timestamptz    | nullable
persona_id             | text           | nullable (FK → agent_personas)
```

### `stream_events` Table
```
id                | text           | NOT NULL (PK)
stream_id         | text           | NOT NULL
event_type        | text           | NOT NULL
actor_id          | text           | nullable
content_type      | text           | nullable
content_id        | text           | nullable
payload           | jsonb          | nullable
created_at        | timestamptz    | NOT NULL, default now()
edited_at         | timestamptz    | nullable
deleted_at        | timestamptz    | nullable
agent_id          | text           | nullable (FK → agent_personas)
client_message_id | varchar(255)   | nullable
```

### `stream_members` Table
```
stream_id          | text           | NOT NULL (PK part 1)
user_id            | text           | NOT NULL (PK part 2)
role               | text           | NOT NULL, default 'member'
notify_level       | text           | NOT NULL, default 'default'
last_read_event_id | text           | nullable
last_read_at       | timestamptz    | NOT NULL, default now()
added_by_user_id   | text           | nullable
joined_at          | timestamptz    | NOT NULL, default now()
left_at            | timestamptz    | nullable
updated_at         | timestamptz    | NOT NULL, default now()
pinned_at          | timestamptz    | nullable
```

### `text_messages` Table
```
id                  | text           | NOT NULL (PK)
content             | text           | NOT NULL
mentions            | jsonb          | default '[]'
formatting          | jsonb          | nullable
created_at          | timestamptz    | NOT NULL, default now()
search_vector       | tsvector       | nullable (auto-generated)
contextual_header   | text           | nullable
header_generated_at | timestamptz    | nullable
enrichment_tier     | integer        | default 0
enrichment_signals  | jsonb          | default '{}'
```

### `message_reactions` Table
```
id         | text           | NOT NULL (PK)
message_id | text           | NOT NULL
user_id    | text           | NOT NULL
reaction   | text           | NOT NULL
created_at | timestamptz    | NOT NULL, default now()
updated_at | timestamptz    | NOT NULL, default now()
deleted_at | timestamptz    | nullable
```
Unique constraint: `(message_id, user_id, reaction)`

### `notifications` Table
```
id                | text           | NOT NULL (PK)
workspace_id      | text           | NOT NULL (FK → workspaces)
user_id           | text           | NOT NULL (FK → users)
notification_type | text           | NOT NULL
message_id        | text           | nullable
channel_id        | text           | nullable
conversation_id   | text           | nullable
actor_id          | text           | nullable (FK → users)
preview           | text           | nullable
read_at           | timestamptz    | nullable
created_at        | timestamptz    | NOT NULL, default now()
stream_id         | text           | nullable
event_id          | text           | nullable
```
Unique constraint: `(workspace_id, user_id, notification_type, message_id, actor_id)`

### `shared_refs` Table
```
id                | text           | NOT NULL (PK)
original_event_id | text           | NOT NULL
context           | text           | nullable
created_at        | timestamptz    | NOT NULL, default now()
```

### `message_revisions` Table
```
id         | text           | NOT NULL (PK)
message_id | text           | NOT NULL
content    | text           | NOT NULL
created_at | timestamptz    | NOT NULL, default now()
updated_at | timestamptz    | NOT NULL, default now()
deleted_at | timestamptz    | nullable
```

### `users` Table
```
id             | text           | NOT NULL (PK)
email          | text           | NOT NULL (unique)
name           | text           | NOT NULL
workos_user_id | text           | nullable (unique)
timezone       | text           | nullable
locale         | text           | nullable
created_at     | timestamptz    | NOT NULL, default now()
updated_at     | timestamptz    | NOT NULL, default now()
deleted_at     | timestamptz    | nullable
archived_at    | timestamptz    | nullable
```

### `workspaces` Table
```
id                      | text           | NOT NULL (PK)
name                    | text           | NOT NULL
slug                    | text           | NOT NULL (unique)
stripe_customer_id      | text           | nullable
plan_tier               | text           | NOT NULL, default 'free'
billing_status          | text           | NOT NULL, default 'active'
seat_limit              | integer        | nullable
ai_budget_limit         | numeric(10,2)  | nullable
workos_organization_id  | text           | nullable (unique)
created_at              | timestamptz    | NOT NULL, default now()
ai_enabled              | boolean        | NOT NULL, default false
ai_budget_cents_monthly | integer        | NOT NULL, default 10000
```

### `workspace_members` Table
```
workspace_id | text           | NOT NULL (PK part 1)
user_id      | text           | NOT NULL (PK part 2)
role         | text           | NOT NULL, default 'member'
status       | text           | NOT NULL, default 'active'
invited_at   | timestamptz    | nullable
joined_at    | timestamptz    | nullable
removed_at   | timestamptz    | nullable
```

### `workspace_profiles` Table
```
workspace_id           | text           | NOT NULL (PK part 1)
user_id                | text           | NOT NULL (PK part 2)
display_name           | text           | nullable
title                  | text           | nullable
avatar_url             | text           | nullable
bio                    | text           | nullable
workos_membership_id   | text           | nullable (unique)
profile_managed_by_sso | boolean        | NOT NULL, default false
created_at             | timestamptz    | NOT NULL, default now()
updated_at             | timestamptz    | NOT NULL, default now()
```

### `agent_personas` Table
```
id                    | text           | NOT NULL (PK)
workspace_id          | text           | NOT NULL (FK → workspaces)
name                  | text           | NOT NULL
slug                  | text           | NOT NULL
description           | text           | NOT NULL
avatar_emoji          | text           | nullable
system_prompt         | text           | NOT NULL
enabled_tools         | text[]         | nullable
model                 | text           | NOT NULL, default 'anthropic:claude-haiku-4-5-20251001'
temperature           | real           | NOT NULL, default 0.7
max_tokens            | integer        | NOT NULL, default 2048
allowed_stream_ids    | text[]         | nullable
is_default            | boolean        | NOT NULL, default false
is_active             | boolean        | NOT NULL, default true
created_by            | text           | NOT NULL (FK → users)
created_at            | timestamptz    | NOT NULL, default now()
updated_at            | timestamptz    | NOT NULL, default now()
current_version_id    | text           | nullable (FK → persona_versions)
draft_version_id      | text           | nullable (FK → persona_versions)
latest_version_number | integer        | NOT NULL, default 0
```

---

## Repository Design Principles

1. **Accept `PoolClient`**: All repository methods receive a client to enable transaction control from the service
2. **Return raw data**: Repositories return database rows, services handle mapping
3. **Single responsibility**: Each method does one database operation
4. **No side effects**: No outbox events, notifications, or external calls in repository
5. **Composable**: Services compose multiple repository calls within transactions
6. **Explicit field selection**: NEVER use `SELECT *`, always list fields explicitly

---

## Identified Domain Operations

### Stream Operations

#### `findStreamById(client, streamId): Promise<StreamRow | null>`
Fetch a single stream by ID.
```sql
SELECT
  id, workspace_id, stream_type, name, slug, description, topic,
  parent_stream_id, branched_from_event_id, visibility, status,
  promoted_at, promoted_by, metadata, created_at, updated_at,
  archived_at, persona_id
FROM streams
WHERE id = $1
```
**Used by**: `getStream`, `createThreadFromEvent`, `replyToEvent`, `promoteStream`, `archiveStream`, `unarchiveStream`, `updateStream`, `joinStream`, `leaveStream`, `addMember`, `removeMember`

---

#### `findStreamBySlug(client, workspaceId, slug): Promise<StreamRow | null>`
Fetch a stream by workspace + slug.
```sql
SELECT
  id, workspace_id, stream_type, name, slug, description, topic,
  parent_stream_id, branched_from_event_id, visibility, status,
  promoted_at, promoted_by, metadata, created_at, updated_at,
  archived_at, persona_id
FROM streams
WHERE workspace_id = $1 AND slug = $2
```
**Used by**: `getStreamBySlug`

---

#### `findStreamByBranchedFromEventId(client, eventId): Promise<StreamRow | null>`
Find thread that branched from an event.
```sql
SELECT
  id, workspace_id, stream_type, name, slug, description, topic,
  parent_stream_id, branched_from_event_id, visibility, status,
  promoted_at, promoted_by, metadata, created_at, updated_at,
  archived_at, persona_id
FROM streams
WHERE branched_from_event_id = $1
```
**Used by**: `createThreadFromEvent`, `replyToEvent`, `getThreadForEvent`

---

#### `findStreamByBranchedFromEventIdForUpdate(client, eventId): Promise<StreamRow | null>`
Same as above but with row lock for concurrent thread creation.
```sql
SELECT
  id, workspace_id, stream_type, name, slug, description, topic,
  parent_stream_id, branched_from_event_id, visibility, status,
  promoted_at, promoted_by, metadata, created_at, updated_at,
  archived_at, persona_id
FROM streams
WHERE branched_from_event_id = $1
FOR UPDATE
```
**Used by**: `replyToEvent`

---

#### `slugExists(client, workspaceId, slug, excludeStreamId?): Promise<boolean>`
Check if slug is taken.
```sql
SELECT 1 FROM streams
WHERE workspace_id = $1 AND slug = $2
  AND ($3::text IS NULL OR id != $3)
LIMIT 1
```
**Used by**: `createStream`, `promoteStream`, `checkSlugExists`

---

#### `insertStream(client, params): Promise<StreamRow>`
Create a new stream.
```sql
INSERT INTO streams (
  id, workspace_id, stream_type, name, slug, description, topic,
  visibility, parent_stream_id, branched_from_event_id, metadata, persona_id
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
RETURNING
  id, workspace_id, stream_type, name, slug, description, topic,
  parent_stream_id, branched_from_event_id, visibility, status,
  promoted_at, promoted_by, metadata, created_at, updated_at,
  archived_at, persona_id
```
**Used by**: `createStream`, `createDM`, `createThreadFromEvent`, `replyToEvent`

---

#### `updateStreamType(client, streamId, params): Promise<StreamRow>`
Update stream type (for promotion).
```sql
UPDATE streams SET
  stream_type = $2,
  name = $3,
  slug = $4,
  visibility = $5,
  promoted_at = NOW(),
  promoted_by = $6,
  updated_at = NOW()
WHERE id = $1
RETURNING
  id, workspace_id, stream_type, name, slug, description, topic,
  parent_stream_id, branched_from_event_id, visibility, status,
  promoted_at, promoted_by, metadata, created_at, updated_at,
  archived_at, persona_id
```
**Used by**: `promoteStream`

---

#### `updateStreamName(client, streamId, name): Promise<void>`
Update just the stream name (for auto-naming).
```sql
UPDATE streams SET name = $2, updated_at = NOW() WHERE id = $1
```
**Used by**: `createThreadFromEvent`, `replyToEvent`, `createEvent`, `retryAutoNameIfNeeded`

---

#### `updateStreamMetadata(client, streamId, updates): Promise<StreamRow>`
Update stream name/description/topic.
```sql
UPDATE streams SET
  name = COALESCE($2, name),
  description = COALESCE($3, description),
  topic = COALESCE($4, topic),
  updated_at = NOW()
WHERE id = $1
RETURNING
  id, workspace_id, stream_type, name, slug, description, topic,
  parent_stream_id, branched_from_event_id, visibility, status,
  promoted_at, promoted_by, metadata, created_at, updated_at,
  archived_at, persona_id
```
**Used by**: `updateStream`

---

#### `archiveStream(client, streamId): Promise<void>`
Set archived_at timestamp.
```sql
UPDATE streams SET archived_at = NOW(), updated_at = NOW() WHERE id = $1
```
**Used by**: `archiveStream`

---

#### `unarchiveStream(client, streamId): Promise<void>`
Clear archived_at timestamp.
```sql
UPDATE streams SET archived_at = NULL, updated_at = NOW() WHERE id = $1
```
**Used by**: `unarchiveStream`

---

#### `findExistingDM(client, workspaceId, participantIds): Promise<StreamRow | null>`
Find DM with exact participants.
```sql
SELECT
  s.id, s.workspace_id, s.stream_type, s.name, s.slug, s.description, s.topic,
  s.parent_stream_id, s.branched_from_event_id, s.visibility, s.status,
  s.promoted_at, s.promoted_by, s.metadata, s.created_at, s.updated_at,
  s.archived_at, s.persona_id
FROM streams s
WHERE s.workspace_id = $1
  AND s.stream_type = 'dm'
  AND s.archived_at IS NULL
  AND (SELECT COUNT(*) FROM stream_members sm
       WHERE sm.stream_id = s.id AND sm.left_at IS NULL) = $2
  AND NOT EXISTS (
    SELECT 1 FROM unnest($3::text[]) as pid
    WHERE pid NOT IN (
      SELECT user_id FROM stream_members sm2
      WHERE sm2.stream_id = s.id AND sm2.left_at IS NULL
    )
  )
```
**Used by**: `findExistingDM`, `createDM`

---

#### `findDiscoverableStreams(client, workspaceId, userId): Promise<DiscoverableStreamRow[]>`
Get public channels for discovery.
```sql
SELECT
  s.id, s.workspace_id, s.stream_type, s.name, s.slug, s.description, s.topic,
  s.parent_stream_id, s.branched_from_event_id, s.visibility, s.status,
  s.promoted_at, s.promoted_by, s.metadata, s.created_at, s.updated_at,
  s.archived_at, s.persona_id,
  CASE WHEN sm.user_id IS NOT NULL THEN true ELSE false END as is_member,
  (SELECT COUNT(*)::int FROM stream_members WHERE stream_id = s.id AND left_at IS NULL) as member_count
FROM streams s
LEFT JOIN stream_members sm ON s.id = sm.stream_id AND sm.user_id = $2 AND sm.left_at IS NULL
WHERE s.workspace_id = $1
  AND s.archived_at IS NULL
  AND s.stream_type = 'channel'
  AND s.visibility = 'public'
ORDER BY s.name
```
**Used by**: `getDiscoverableStreams`

---

### Stream Member Operations

#### `findMembershipByStreamAndUser(client, streamId, userId): Promise<StreamMemberRow | null>`
Get a user's membership in a stream.
```sql
SELECT
  stream_id, user_id, role, notify_level, last_read_event_id, last_read_at,
  added_by_user_id, joined_at, left_at, updated_at, pinned_at
FROM stream_members
WHERE stream_id = $1 AND user_id = $2
```
**Used by**: `checkStreamAccess` (indirectly via CTE), membership checks

---

#### `insertMember(client, params): Promise<void>`
Add a member to a stream.
```sql
INSERT INTO stream_members (stream_id, user_id, role, added_by_user_id, notify_level)
VALUES ($1, $2, $3, $4, $5)
```
**Used by**: `createStream`, `createDM`, `createThreadFromEvent`, `addMember`

---

#### `upsertMember(client, params): Promise<void>`
Add or reactivate a member.
```sql
INSERT INTO stream_members (stream_id, user_id, role, added_by_user_id)
VALUES ($1, $2, $3, $4)
ON CONFLICT (stream_id, user_id) DO UPDATE SET
  left_at = NULL,
  role = EXCLUDED.role,
  updated_at = NOW()
```
**Used by**: `joinStream`, `addMember`

---

#### `upsertMemberWithReadCursor(client, params): Promise<void>`
Add/update member and set read cursor.
```sql
INSERT INTO stream_members (stream_id, user_id, last_read_event_id, last_read_at)
VALUES ($1, $2, $3, NOW())
ON CONFLICT (stream_id, user_id) DO UPDATE SET
  last_read_event_id = EXCLUDED.last_read_event_id,
  last_read_at = NOW()
```
**Used by**: `replyToEvent`

---

#### `removeMember(client, streamId, userId): Promise<void>`
Soft-remove a member (set left_at).
```sql
UPDATE stream_members SET left_at = NOW(), updated_at = NOW()
WHERE stream_id = $1 AND user_id = $2
```
**Used by**: `leaveStream`, `removeMember`

---

#### `copyParentMembership(client, parentStreamId, newStreamId): Promise<void>`
Copy members from parent to new stream.
```sql
INSERT INTO stream_members (stream_id, user_id, role, notify_level)
SELECT $2, user_id, 'member', notify_level
FROM stream_members
WHERE stream_id = $1 AND left_at IS NULL
```
**Used by**: `replyToEvent`

---

#### `updateReadCursor(client, streamId, userId, eventId): Promise<void>`
Update user's last read position.
```sql
UPDATE stream_members SET
  last_read_event_id = $3,
  last_read_at = NOW(),
  updated_at = NOW()
WHERE stream_id = $1 AND user_id = $2
```
**Used by**: `createStream`, `createEvent`, `joinStream`, `updateReadCursor`

---

#### `getReadCursor(client, streamId, userId): Promise<string | null>`
Get user's last read event.
```sql
SELECT last_read_event_id
FROM stream_members
WHERE stream_id = $1 AND user_id = $2
```
**Used by**: `getReadCursor`

---

#### `findStreamMembers(client, streamId): Promise<StreamMemberWithUserRow[]>`
List all active members of a stream with user info.
```sql
SELECT
  sm.stream_id, sm.user_id, sm.role, sm.notify_level, sm.last_read_event_id,
  sm.last_read_at, sm.added_by_user_id, sm.joined_at, sm.left_at,
  sm.updated_at, sm.pinned_at,
  u.email, u.name
FROM stream_members sm
INNER JOIN users u ON sm.user_id = u.id
WHERE sm.stream_id = $1 AND sm.left_at IS NULL
ORDER BY sm.joined_at
```
**Used by**: `getStreamMembers`

---

#### `pinStream(client, streamId, userId): Promise<void>`
Pin a stream for a user.
```sql
UPDATE stream_members SET pinned_at = NOW(), updated_at = NOW()
WHERE stream_id = $1 AND user_id = $2
```
**Used by**: `pinStream`

---

#### `unpinStream(client, streamId, userId): Promise<void>`
Unpin a stream for a user.
```sql
UPDATE stream_members SET pinned_at = NULL, updated_at = NOW()
WHERE stream_id = $1 AND user_id = $2
```
**Used by**: `unpinStream`

---

### Stream Event Operations

#### `findEventById(client, eventId): Promise<StreamEventRow | null>`
Get event by ID.
```sql
SELECT
  id, stream_id, event_type, actor_id, content_type, content_id,
  payload, created_at, edited_at, deleted_at, agent_id, client_message_id
FROM stream_events
WHERE id = $1
```
**Used by**: `getEventWithDetails`, `editEvent`, `deleteEvent`, `addReaction`, `removeReaction`

---

#### `findEventByIdForUpdate(client, eventId): Promise<StreamEventRow | null>`
Get event with lock.
```sql
SELECT
  id, stream_id, event_type, actor_id, content_type, content_id,
  payload, created_at, edited_at, deleted_at, agent_id, client_message_id
FROM stream_events
WHERE id = $1
FOR UPDATE
```
**Used by**: `replyToEvent`

---

#### `findEventWithStream(client, eventId): Promise<EventWithStreamRow | null>`
Get event with stream info (for validation/context).
```sql
SELECT
  e.id, e.stream_id, e.event_type, e.actor_id, e.content_type, e.content_id,
  e.payload, e.created_at, e.edited_at, e.deleted_at, e.agent_id, e.client_message_id,
  s.workspace_id
FROM stream_events e
INNER JOIN streams s ON e.stream_id = s.id
WHERE e.id = $1
```
**Used by**: `createThreadFromEvent`, `editEvent`, `deleteEvent`

---

#### `findEventWithStreamAndContent(client, eventId): Promise<EventWithContentRow | null>`
Get event with message content for threading/display.
```sql
SELECT
  e.id, e.stream_id, e.event_type, e.actor_id, e.content_type, e.content_id,
  e.payload, e.created_at, e.edited_at, e.deleted_at, e.agent_id, e.client_message_id,
  s.workspace_id, s.parent_stream_id,
  tm.content as message_content, tm.mentions
FROM stream_events e
INNER JOIN streams s ON e.stream_id = s.id
LEFT JOIN text_messages tm ON e.content_type = 'text_message' AND e.content_id = tm.id
WHERE e.id = $1
```
**Used by**: `createThreadFromEvent`, `replyToEvent`

---

#### `findEventByClientMessageId(client, streamId, clientMessageId): Promise<EventWithDetailsRow | null>`
Idempotency check for duplicate messages.
```sql
SELECT
  se.id, se.stream_id, se.event_type, se.actor_id, se.content_type, se.content_id,
  se.payload, se.created_at, se.edited_at, se.deleted_at, se.agent_id, se.client_message_id,
  tm.content, tm.mentions,
  u.email as actor_email
FROM stream_events se
LEFT JOIN text_messages tm ON se.content_id = tm.id AND se.content_type = 'text_message'
LEFT JOIN users u ON se.actor_id = u.id
WHERE se.client_message_id = $2 AND se.stream_id = $1
```
**Used by**: `createEvent`, `replyToEvent`

---

#### `findEventsByStreamId(client, streamId, params): Promise<StreamEventWithDetailsRow[]>`
Paginated events for a stream with full details.
```sql
SELECT
  e.id, e.stream_id, e.event_type, e.actor_id, e.content_type, e.content_id,
  e.payload, e.created_at, e.edited_at, e.deleted_at, e.agent_id, e.client_message_id,
  u.email as actor_email,
  COALESCE(wp.display_name, u.name) as actor_name,
  wp.avatar_url as actor_avatar,
  ap.name as agent_name,
  ap.avatar_emoji as agent_avatar,
  tm.content, tm.mentions, tm.formatting,
  sr.original_event_id, sr.context as share_context,
  (SELECT COUNT(*)::int FROM stream_events se2
   INNER JOIN streams s2 ON s2.branched_from_event_id = e.id
   WHERE se2.stream_id = s2.id AND se2.deleted_at IS NULL
  ) as reply_count
FROM stream_events e
INNER JOIN streams s ON e.stream_id = s.id
LEFT JOIN users u ON e.actor_id = u.id
LEFT JOIN workspace_profiles wp ON wp.workspace_id = s.workspace_id AND wp.user_id = e.actor_id
LEFT JOIN agent_personas ap ON e.agent_id = ap.id
LEFT JOIN text_messages tm ON e.content_type = 'text_message' AND e.content_id = tm.id
LEFT JOIN shared_refs sr ON e.content_type = 'shared_ref' AND e.content_id = sr.id
WHERE e.stream_id = $1 AND e.deleted_at IS NULL
ORDER BY e.created_at DESC
LIMIT $2 OFFSET $3
```
**Used by**: `getStreamEvents`

---

#### `findEventWithDetails(client, eventId): Promise<StreamEventWithDetailsRow | null>`
Single event with full details (same joins as findEventsByStreamId).
```sql
SELECT
  e.id, e.stream_id, e.event_type, e.actor_id, e.content_type, e.content_id,
  e.payload, e.created_at, e.edited_at, e.deleted_at, e.agent_id, e.client_message_id,
  u.email as actor_email,
  COALESCE(wp.display_name, u.name) as actor_name,
  wp.avatar_url as actor_avatar,
  ap.name as agent_name,
  ap.avatar_emoji as agent_avatar,
  tm.content, tm.mentions, tm.formatting,
  sr.original_event_id, sr.context as share_context,
  (SELECT COUNT(*)::int FROM stream_events se2
   INNER JOIN streams s2 ON s2.branched_from_event_id = e.id
   WHERE se2.stream_id = s2.id AND se2.deleted_at IS NULL
  ) as reply_count
FROM stream_events e
INNER JOIN streams s ON e.stream_id = s.id
LEFT JOIN users u ON e.actor_id = u.id
LEFT JOIN workspace_profiles wp ON wp.workspace_id = s.workspace_id AND wp.user_id = e.actor_id
LEFT JOIN agent_personas ap ON e.agent_id = ap.id
LEFT JOIN text_messages tm ON e.content_type = 'text_message' AND e.content_id = tm.id
LEFT JOIN shared_refs sr ON e.content_type = 'shared_ref' AND e.content_id = sr.id
WHERE e.id = $1 AND e.deleted_at IS NULL
```
**Used by**: `getEventWithDetails`

---

#### `findEventsByIds(client, eventIds): Promise<StreamEventWithDetailsRow[]>`
Batch fetch events by IDs (for hydrating shared refs).
```sql
SELECT
  e.id, e.stream_id, e.event_type, e.actor_id, e.content_type, e.content_id,
  e.payload, e.created_at, e.edited_at, e.deleted_at, e.agent_id, e.client_message_id,
  u.email as actor_email,
  COALESCE(wp.display_name, u.name) as actor_name,
  wp.avatar_url as actor_avatar,
  ap.name as agent_name,
  ap.avatar_emoji as agent_avatar,
  tm.content, tm.mentions, tm.formatting,
  sr.original_event_id, sr.context as share_context
FROM stream_events e
INNER JOIN streams s ON e.stream_id = s.id
LEFT JOIN users u ON e.actor_id = u.id
LEFT JOIN workspace_profiles wp ON wp.workspace_id = s.workspace_id AND wp.user_id = e.actor_id
LEFT JOIN agent_personas ap ON e.agent_id = ap.id
LEFT JOIN text_messages tm ON e.content_type = 'text_message' AND e.content_id = tm.id
LEFT JOIN shared_refs sr ON e.content_type = 'shared_ref' AND e.content_id = sr.id
WHERE e.id = ANY($1)
```
**Used by**: `getStreamEvents` (for shared refs hydration)

---

#### `insertEvent(client, params): Promise<StreamEventRow>`
Create a new event.
```sql
INSERT INTO stream_events (
  id, stream_id, event_type, actor_id, agent_id,
  content_type, content_id, payload, client_message_id
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING
  id, stream_id, event_type, actor_id, content_type, content_id,
  payload, created_at, edited_at, deleted_at, agent_id, client_message_id
```
**Used by**: `createStream`, `createThreadFromEvent`, `replyToEvent`, `createEvent`, `joinStream`, `leaveStream`, `addMember`, `removeMember`, `promoteStream`

---

#### `updateEventEditedAt(client, eventId): Promise<void>`
Mark event as edited.
```sql
UPDATE stream_events SET edited_at = NOW() WHERE id = $1
```
**Used by**: `editEvent`

---

#### `softDeleteEvent(client, eventId): Promise<void>`
Soft-delete an event.
```sql
UPDATE stream_events SET deleted_at = NOW() WHERE id = $1
```
**Used by**: `deleteEvent`

---

#### `countMessagesByStreamId(client, streamId): Promise<number>`
Count messages in a stream (for auto-naming).
```sql
SELECT COUNT(*)::int
FROM stream_events
WHERE stream_id = $1 AND event_type = 'message' AND deleted_at IS NULL
```
**Used by**: `retryAutoNameIfNeeded`

---

#### `findRecentMessagesContent(client, streamId, limit): Promise<{content: string}[]>`
Get recent message content for auto-naming.
```sql
SELECT tm.content
FROM stream_events e
INNER JOIN text_messages tm ON e.content_type = 'text_message' AND e.content_id = tm.id
WHERE e.stream_id = $1 AND e.event_type = 'message' AND e.deleted_at IS NULL
ORDER BY e.created_at ASC
LIMIT $2
```
**Used by**: `retryAutoNameIfNeeded`

---

### Text Message Operations

#### `insertTextMessage(client, id, content, mentions): Promise<void>`
Create a text message.
```sql
INSERT INTO text_messages (id, content, mentions)
VALUES ($1, $2, $3)
```
**Used by**: `createEvent`, `replyToEvent`

---

#### `findTextMessageById(client, id): Promise<TextMessageRow | null>`
Get message content.
```sql
SELECT
  id, content, mentions, formatting, created_at,
  contextual_header, header_generated_at, enrichment_tier, enrichment_signals
FROM text_messages
WHERE id = $1
```
**Used by**: `editEvent`

---

#### `updateTextMessageContent(client, id, content): Promise<void>`
Update message content.
```sql
UPDATE text_messages SET content = $2 WHERE id = $1
```
**Used by**: `editEvent`

---

### Shared Ref Operations

#### `insertSharedRef(client, id, originalEventId, context): Promise<void>`
Create a shared reference.
```sql
INSERT INTO shared_refs (id, original_event_id, context)
VALUES ($1, $2, $3)
```
**Used by**: `createEvent`

---

### Message Revision Operations

#### `insertMessageRevision(client, id, messageId, content): Promise<void>`
Create a revision before editing.
```sql
INSERT INTO message_revisions (id, message_id, content)
VALUES ($1, $2, $3)
```
**Used by**: `editEvent`

---

### Reaction Operations

#### `insertReaction(client, params): Promise<void>`
Add a reaction.
```sql
INSERT INTO message_reactions (id, message_id, user_id, reaction)
VALUES ($1, $2, $3, $4)
ON CONFLICT (message_id, user_id, reaction) DO NOTHING
```
**Used by**: `addReaction`

---

#### `softDeleteReaction(client, eventId, userId, reaction): Promise<void>`
Remove a reaction.
```sql
UPDATE message_reactions SET deleted_at = NOW(), updated_at = NOW()
WHERE message_id = $1 AND user_id = $2 AND reaction = $3
```
**Used by**: `removeReaction`

---

#### `findReactionsByEventId(client, eventId): Promise<ReactionRow[]>`
Get reactions for an event.
```sql
SELECT id, message_id, user_id, reaction, created_at, updated_at
FROM message_reactions
WHERE message_id = $1 AND deleted_at IS NULL
ORDER BY created_at ASC
```
**Used by**: `getReactions`

---

#### `countReactionsByEventId(client, eventId): Promise<number>`
Count reactions for an event.
```sql
SELECT COUNT(*)::int
FROM message_reactions
WHERE message_id = $1 AND deleted_at IS NULL
```
**Used by**: `addReaction`, `removeReaction`, `getReactionCount`

---

### Notification Operations

#### `insertNotification(client, params): Promise<void>`
Create a notification.
```sql
INSERT INTO notifications (
  id, workspace_id, user_id, notification_type,
  stream_id, event_id, actor_id, preview
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (workspace_id, user_id, notification_type, message_id, actor_id) DO NOTHING
```
**Used by**: `createEvent`, `replyToEvent`

---

#### `countUnreadNotifications(client, workspaceId, userId): Promise<number>`
Count unread notifications.
```sql
SELECT COUNT(*)::int
FROM notifications
WHERE workspace_id = $1 AND user_id = $2 AND read_at IS NULL
```
**Used by**: `getNotificationCount`

---

#### `findNotifications(client, workspaceId, userId, limit): Promise<NotificationWithDetailsRow[]>`
Get notifications with details.
```sql
SELECT
  n.id, n.workspace_id, n.user_id, n.notification_type, n.message_id,
  n.channel_id, n.conversation_id, n.actor_id, n.preview, n.read_at,
  n.created_at, n.stream_id, n.event_id,
  u.email as actor_email,
  COALESCE(wp.display_name, u.name) as actor_name,
  wp.avatar_url as actor_avatar,
  s.name as stream_name,
  s.slug as stream_slug,
  s.stream_type
FROM notifications n
LEFT JOIN users u ON n.actor_id = u.id
LEFT JOIN workspace_profiles wp ON wp.workspace_id = n.workspace_id AND wp.user_id = n.actor_id
LEFT JOIN streams s ON n.stream_id = s.id
WHERE n.workspace_id = $1 AND n.user_id = $2
ORDER BY n.created_at DESC
LIMIT $3
```
**Used by**: `getNotifications`

---

#### `markNotificationRead(client, notificationId, userId): Promise<void>`
Mark one notification read.
```sql
UPDATE notifications SET read_at = NOW()
WHERE id = $1 AND user_id = $2
```
**Used by**: `markNotificationAsRead`

---

#### `markAllNotificationsRead(client, workspaceId, userId): Promise<void>`
Mark all notifications read.
```sql
UPDATE notifications SET read_at = NOW()
WHERE workspace_id = $1 AND user_id = $2 AND read_at IS NULL
```
**Used by**: `markAllNotificationsAsRead`

---

### User Operations (read-only)

#### `findUserById(client, userId): Promise<UserRow | null>`
Get user info.
```sql
SELECT
  id, email, name, workos_user_id, timezone, locale,
  created_at, updated_at, deleted_at, archived_at
FROM users
WHERE id = $1
```
**Used by**: `createEvent`, `replyToEvent`

---

#### `findUserEmail(client, userId): Promise<string | null>`
Get just user email.
```sql
SELECT email FROM users WHERE id = $1
```
**Used by**: `getUserEmail`

---

#### `findUsersByIds(client, userIds): Promise<UserRow[]>`
Batch fetch users for display.
```sql
SELECT id, name, email
FROM users
WHERE id = ANY($1)
```
**Used by**: `createDM`

---

### Access Control Operations

#### `findStreamAccessChain(client, streamId, userId): Promise<StreamChainRow[]>`
Recursive CTE for access check. Walks up the stream parent chain.
```sql
WITH RECURSIVE stream_chain AS (
  SELECT
    s.id, s.visibility, s.stream_type, s.parent_stream_id,
    CASE WHEN sm.user_id IS NOT NULL THEN true ELSE false END as is_member,
    0 as depth
  FROM streams s
  LEFT JOIN stream_members sm ON s.id = sm.stream_id
    AND sm.user_id = $2 AND sm.left_at IS NULL
  WHERE s.id = $1
  UNION ALL
  SELECT
    p.id, p.visibility, p.stream_type, p.parent_stream_id,
    CASE WHEN sm.user_id IS NOT NULL THEN true ELSE false END as is_member,
    sc.depth + 1
  FROM stream_chain sc
  INNER JOIN streams p ON p.id = sc.parent_stream_id
  LEFT JOIN stream_members sm ON p.id = sm.stream_id
    AND sm.user_id = $2 AND sm.left_at IS NULL
  WHERE sc.depth < 10
)
SELECT id, visibility, stream_type, parent_stream_id, is_member, depth
FROM stream_chain
ORDER BY depth
```
**Used by**: `checkStreamAccess`, `checkStreamAccessDirect`

---

#### `findCrossPostSources(client, streamId): Promise<{source_stream_id: string}[]>`
Find streams that cross-posted into this stream.
```sql
SELECT DISTINCT source_event.stream_id as source_stream_id
FROM stream_events e
INNER JOIN shared_refs sr ON e.content_type = 'shared_ref' AND e.content_id = sr.id
INNER JOIN stream_events source_event ON sr.original_event_id = source_event.id
WHERE e.stream_id = $1 AND e.deleted_at IS NULL
```
**Used by**: `checkCrossPostAccess`

---

#### `findEventStreamId(client, eventId): Promise<string | null>`
Get stream ID for an event.
```sql
SELECT stream_id FROM stream_events WHERE id = $1
```
**Used by**: `checkEventAccess`

---

### Bootstrap Operations

#### `findWorkspaceWithUserRole(client, workspaceId, userId): Promise<WorkspaceWithRoleRow | null>`
Get workspace + user's role.
```sql
SELECT
  w.id, w.name, w.slug, w.plan_tier, w.billing_status,
  w.ai_enabled, w.ai_budget_cents_monthly,
  wm.role
FROM workspaces w
INNER JOIN workspace_members wm ON w.id = wm.workspace_id
WHERE w.id = $1 AND wm.user_id = $2 AND wm.status = 'active'
```
**Used by**: `bootstrap`

---

#### `findUserStreamsWithUnreadCounts(client, workspaceId, userId): Promise<BootstrapStreamRow[]>`
Get user's joined streams with unread counts.
```sql
SELECT
  s.id, s.workspace_id, s.stream_type, s.name, s.slug, s.description, s.topic,
  s.parent_stream_id, s.branched_from_event_id, s.visibility, s.status,
  s.promoted_at, s.promoted_by, s.metadata, s.created_at, s.updated_at,
  s.archived_at, s.persona_id,
  sm.last_read_at, sm.pinned_at, sm.notify_level, sm.last_read_event_id,
  (SELECT COUNT(*)::int
   FROM stream_events se
   WHERE se.stream_id = s.id
     AND se.deleted_at IS NULL
     AND (sm.last_read_event_id IS NULL OR se.created_at > (
       SELECT created_at FROM stream_events WHERE id = sm.last_read_event_id
     ))
  ) as unread_count
FROM streams s
INNER JOIN stream_members sm ON s.id = sm.stream_id
  AND sm.user_id = $2 AND sm.left_at IS NULL
WHERE s.workspace_id = $1
  AND s.archived_at IS NULL
  AND s.stream_type IN ('channel', 'dm', 'thinking_space')
ORDER BY sm.pinned_at DESC NULLS LAST, s.name
```
**Used by**: `bootstrap`

---

#### `findWorkspaceMembers(client, workspaceId): Promise<WorkspaceMemberWithProfileRow[]>`
Get all workspace members with profiles.
```sql
SELECT
  u.id, u.email,
  COALESCE(wp.display_name, u.name) as name,
  wp.title, wp.avatar_url, wp.bio,
  wm.role, wm.status, wm.joined_at
FROM users u
INNER JOIN workspace_members wm ON u.id = wm.user_id
LEFT JOIN workspace_profiles wp ON wp.workspace_id = wm.workspace_id AND wp.user_id = u.id
WHERE wm.workspace_id = $1 AND wm.status = 'active' AND u.deleted_at IS NULL
ORDER BY COALESCE(wp.display_name, u.name)
```
**Used by**: `bootstrap`

---

#### `findUserWorkspaceProfile(client, workspaceId, userId): Promise<WorkspaceProfileRow | null>`
Get user's workspace profile.
```sql
SELECT
  wp.workspace_id, wp.user_id, wp.display_name, wp.title,
  wp.avatar_url, wp.bio, wp.profile_managed_by_sso,
  wp.created_at, wp.updated_at
FROM workspace_profiles wp
WHERE wp.workspace_id = $1 AND wp.user_id = $2
```
**Used by**: `bootstrap`

---

## Summary: Operation Count by Entity

| Entity | Operations |
|--------|------------|
| Stream | 12 |
| StreamMember | 11 |
| StreamEvent | 13 |
| TextMessage | 3 |
| SharedRef | 1 |
| MessageRevision | 1 |
| Reaction | 4 |
| Notification | 5 |
| User (read-only) | 3 |
| Access Control | 3 |
| Bootstrap | 4 |

**Total: ~60 distinct database operations**
