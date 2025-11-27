# Stream Model Refactor

> **Status**: Planning  
> **Created**: 2025-11-27  
> **Goal**: Replace channels/conversations with a unified stream model

---

## Why This Refactor?

### The Problem

The current model has separate concepts for **channels** and **conversations** (threads):

```
channels ←→ channel_members
conversations ←→ conversation_members ←→ conversation_channels
messages (references both channel_id AND conversation_id)
message_channels (for cross-posting)
```

This creates:
- **Duplicate code paths** everywhere (channel vs conversation handling)
- **Complex junction tables** for cross-posting
- **Rigid hierarchy** - threads can't become channels
- **Limited extensibility** - adding polls, incidents, etc. requires more schema changes

### The Solution

Everything becomes a **stream**. A stream is a container for events:

```
streams ←→ stream_members
stream_events (polymorphic - messages, shares, polls, system events)
```

Benefits:
- **One code path** for all stream types
- **Threads can be promoted** to channels (incident escalation use case)
- **Cross-posting is natural** - just a "shared" event in the target stream
- **Extensible** - new event types without schema changes
- **Scale-ready** - streams are natural sharding boundaries

---

## Core Concepts

### Streams

A stream is a container that can hold any sequence of events:

| Type | Has Name | In Sidebar | Membership | Example |
|------|----------|------------|------------|---------|
| `channel` | Required | Yes | Explicit join | #engineering |
| `thread` | Optional | No | Inherited from parent | Discussion on a message |
| `dm` | Auto-generated | Yes | Fixed participants | Pierre, Kristoffer |
| `incident` | Required | Yes (special) | Auto + explicit | Checkout Outage |

Streams can **branch** (threads branch from events in channels) and **promote** (thread → channel).

### Stream Events

Everything that happens is an event:

| Event Type | Content | Example |
|------------|---------|---------|
| `message` | Text + mentions | "Hey team, quick question..." |
| `shared` | Reference + context | Shared from #engineering: "..." |
| `member_joined` | User ID | Pierre joined the channel |
| `member_left` | User ID | Kristoffer left the channel |
| `thread_started` | Thread stream ID | New thread branched off |
| `poll` | Question + options | "Ship Friday?" |
| `file` | File metadata | Uploaded design.fig |

### Branching & Promotion

```
#engineering (root stream, type='channel')
│
├── evt_1: "Deploy went out"
├── evt_2: "Seeing errors in Sentry"
│   │
│   └── branches to → Stream (type='thread')
│       ├── "What errors?"
│       ├── "500s on checkout"
│       ├── "This is an outage!"
│       │
│       └── /promote-incident
│           │
│           └── Stream becomes type='incident', name="Checkout Outage"
│               ├── "Root cause: DB pool"
│               ├── "Mitigation deployed"
│               └── "Resolved ✓"
│
└── evt_3: "Shared from Checkout Outage" (shared_ref)
```

---

## Database Schema

### New Tables

```sql
-- Streams: unified container (replaces channels + conversations)
CREATE TABLE streams (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    stream_type TEXT NOT NULL,        -- 'channel', 'thread', 'dm', 'incident'
    
    -- Identity (required for channels, optional for threads)
    name TEXT,
    slug TEXT,                        -- unique per workspace for named streams
    description TEXT,
    
    -- Branching relationship
    parent_stream_id TEXT,            -- thread's parent channel
    branched_from_event_id TEXT,      -- the event this thread started from
    
    -- State
    visibility TEXT DEFAULT 'public', -- 'public', 'private', 'inherit'
    status TEXT DEFAULT 'active',     -- 'active', 'archived', 'resolved'
    
    -- Promotion tracking
    promoted_at TIMESTAMPTZ,
    promoted_by TEXT,
    
    metadata JSONB,                   -- flexible: incident severity, etc.
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,
    
    UNIQUE (workspace_id, slug) WHERE slug IS NOT NULL
);

-- Stream events: everything that happens
CREATE TABLE stream_events (
    id TEXT PRIMARY KEY,
    stream_id TEXT NOT NULL,
    event_type TEXT NOT NULL,         -- 'message', 'shared', 'poll', 'member_joined'
    actor_id TEXT NOT NULL,
    
    -- Polymorphic content reference
    content_type TEXT,                -- 'text_message', 'shared_ref', 'poll'
    content_id TEXT,
    
    -- Inline payload for simple events (member_joined, etc.)
    payload JSONB,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    edited_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);

-- Text message content
CREATE TABLE text_messages (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    mentions JSONB,                   -- [{type, id, label, slug}]
    formatting JSONB                  -- future: block-based formatting
);

-- Shared references (cross-posts with context)
CREATE TABLE shared_refs (
    id TEXT PRIMARY KEY,
    original_event_id TEXT NOT NULL,
    context TEXT                      -- "Relevant for our roadmap discussion"
);

-- Stream membership (replaces channel_members + conversation_members)
CREATE TABLE stream_members (
    stream_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT DEFAULT 'member',       -- 'owner', 'admin', 'member'
    notify_level TEXT DEFAULT 'default',
    last_read_event_id TEXT,
    last_read_at TIMESTAMPTZ DEFAULT NOW(),
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    left_at TIMESTAMPTZ,
    PRIMARY KEY (stream_id, user_id)
);
```

### Tables to Keep (Unchanged)
- `workspaces`
- `users`
- `workspace_members`
- `outbox`
- `notifications` (will reference stream_events instead of messages)

### Tables to Drop
- `channels`
- `channel_members`
- `conversations`
- `conversation_channels`
- `conversation_members`
- `messages`
- `message_channels`

---

## WebSocket Architecture

Three room levels for different event scopes:

### Room Types

```typescript
const room = {
    // Per-stream events (new events, edits, typing)
    stream: (wsId: string, streamId: string) => `ws:${wsId}:stream:${streamId}`,
    
    // Workspace-wide (sidebar badges, new streams visible)
    workspace: (wsId: string) => `ws:${wsId}:workspace`,
    
    // User-specific (activity feed, membership changes, read sync)
    user: (wsId: string, userId: string) => `ws:${wsId}:user:${userId}`,
}
```

### Events by Room

| Room | Event | Purpose |
|------|-------|---------|
| `stream:*` | `event` | New event posted in stream |
| `stream:*` | `event:edited` | Event was edited |
| `stream:*` | `event:deleted` | Event was deleted |
| `stream:*` | `typing` | Someone is typing |
| `workspace` | `notification` | Sidebar badge update |
| `workspace` | `stream:created` | New stream visible to user |
| `workspace` | `stream:archived` | Stream was archived |
| `user:*` | `notification:new` | Activity feed item (mention) |
| `user:*` | `stream:member:added` | User was added to stream |
| `user:*` | `stream:member:removed` | User was removed from stream |
| `user:*` | `readCursor:updated` | Read state synced across devices |

---

## API Routes

### New Structure

```
Bootstrap
  GET  /:workspaceId/bootstrap

Streams
  GET  /:workspaceId/streams/:streamId
  POST /:workspaceId/streams                     # create channel/DM
  PATCH /:workspaceId/streams/:streamId          # update name, description
  DELETE /:workspaceId/streams/:streamId         # archive

Stream Events
  GET  /:workspaceId/streams/:streamId/events    # paginated
  POST /:workspaceId/streams/:streamId/events    # post message
  PATCH /:workspaceId/streams/:streamId/events/:eventId
  DELETE /:workspaceId/streams/:streamId/events/:eventId

Threads & Sharing
  POST /:workspaceId/streams/:streamId/thread    # create thread from event
  POST /:workspaceId/streams/:streamId/promote   # thread → channel/incident
  POST /:workspaceId/streams/:streamId/share     # share event to this stream

Membership
  POST /:workspaceId/streams/:streamId/join
  POST /:workspaceId/streams/:streamId/leave
  GET  /:workspaceId/streams/:streamId/members
  POST /:workspaceId/streams/:streamId/members   # invite/add

Read State
  POST /:workspaceId/streams/:streamId/read
  POST /:workspaceId/streams/:streamId/unread
```

### Removed Routes
- All `/channels/*` routes (merged into `/streams/*`)
- All `/threads/*` routes (merged into `/streams/*`)
- All `/conversations/*` routes (eliminated)

---

## Frontend Changes

### Types

```typescript
export type StreamType = 'channel' | 'thread' | 'dm' | 'incident'
export type EventType = 'message' | 'shared' | 'member_joined' | 'member_left' | 'poll' | ...

export interface Stream {
    id: string
    workspaceId: string
    streamType: StreamType
    name: string | null
    slug: string | null
    description: string | null
    parentStreamId: string | null
    branchedFromEventId: string | null
    visibility: 'public' | 'private' | 'inherit'
    status: 'active' | 'archived' | 'resolved'
    isMember: boolean
    unreadCount: number
    lastReadAt: string | null
    notifyLevel: string
}

export interface StreamEvent {
    id: string
    streamId: string
    eventType: EventType
    actorId: string
    actorEmail: string
    content?: TextMessageContent
    sharedRef?: SharedRefContent
    payload?: Record<string, unknown>
    replyCount?: number
    createdAt: string
    editedAt?: string
}
```

### Hooks

| Old | New | Purpose |
|-----|-----|---------|
| `useChat` | `useStream` | Stream events, posting, editing |
| `useWorkspaceSocket` | `useWorkspaceSocket` | Sidebar badges, activity (mostly unchanged) |

### Components

| Component | Changes |
|-----------|---------|
| `ChatInterface` | Props: `channelId/threadId` → `streamId` |
| `Sidebar` | Fetch streams by type, no more separate channel/conversation logic |
| `MessageList` → `EventList` | Render different event types |
| `MessageItem` → `EventItem` | Handle message vs shared vs system events |

### URL State

```
Old: p=c:engineering, p=t:msg_123:chan_456
New: p=s:stream_123
```

---

## Implementation Phases

### Phase 1: Database Schema
- [ ] Create `008_streams.sql` migration
- [ ] Indexes for common queries
- [ ] Drop old tables

### Phase 2: Backend Service
- [ ] Create `StreamService` class
- [ ] Bootstrap method (streams, unread counts)
- [ ] Stream CRUD operations
- [ ] Event operations (post, edit, delete)
- [ ] Thread creation and promotion
- [ ] Sharing between streams
- [ ] Membership operations
- [ ] Read state management

### Phase 3: API Routes
- [ ] Refactor `workspace-routes.ts`
- [ ] New stream-based endpoints
- [ ] Remove old channel/conversation routes

### Phase 4: WebSocket Layer
- [ ] Update room naming
- [ ] Event handlers for stream events
- [ ] Workspace and user level events

### Phase 5: Frontend Types & Hooks
- [ ] Update `types.ts`
- [ ] Create `useStream` hook
- [ ] Update `useWorkspaceSocket`

### Phase 6: Frontend Components
- [ ] `ChatInterface` → stream-based
- [ ] `Sidebar` → unified stream list
- [ ] `MessageList` → `EventList`
- [ ] `MessageItem` → `EventItem`
- [ ] URL state serialization

### Phase 7: Cleanup
- [ ] Remove old service methods
- [ ] Remove old types
- [ ] Remove old migrations (keep for reference)

---

## Queries Reference

### Get streams for sidebar

```sql
SELECT s.*, 
    CASE WHEN sm.user_id IS NOT NULL THEN true ELSE false END as is_member,
    sm.last_read_at,
    sm.notify_level,
    (SELECT COUNT(*) FROM stream_events e 
     WHERE e.stream_id = s.id 
     AND e.created_at > COALESCE(sm.last_read_at, '1970-01-01')
     AND e.deleted_at IS NULL
     AND e.actor_id != $2) as unread_count
FROM streams s
LEFT JOIN stream_members sm ON s.id = sm.stream_id AND sm.user_id = $2
WHERE s.workspace_id = $1
  AND s.archived_at IS NULL
  AND s.stream_type IN ('channel', 'dm')
  AND (s.visibility = 'public' OR sm.user_id IS NOT NULL)
ORDER BY s.name;
```

### Get events for a stream

```sql
SELECT e.*, 
    u.email as actor_email,
    u.name as actor_name,
    tm.content, tm.mentions,
    sr.original_event_id, sr.context,
    (SELECT COUNT(*) FROM streams t WHERE t.branched_from_event_id = e.id) as reply_count
FROM stream_events e
INNER JOIN users u ON e.actor_id = u.id
LEFT JOIN text_messages tm ON e.content_type = 'text_message' AND e.content_id = tm.id
LEFT JOIN shared_refs sr ON e.content_type = 'shared_ref' AND e.content_id = sr.id
WHERE e.stream_id = $1
  AND e.deleted_at IS NULL
ORDER BY e.created_at DESC
LIMIT $2 OFFSET $3;
```

### Create thread from event

```sql
-- 1. Create the thread stream
INSERT INTO streams (id, workspace_id, stream_type, parent_stream_id, branched_from_event_id)
VALUES ($1, $2, 'thread', $3, $4);

-- 2. Copy membership from parent (or specific rules)
INSERT INTO stream_members (stream_id, user_id, joined_at)
SELECT $1, user_id, NOW() FROM stream_members WHERE stream_id = $3;

-- 3. Optionally emit event in parent stream
INSERT INTO stream_events (id, stream_id, event_type, actor_id, payload)
VALUES ($5, $3, 'thread_started', $6, '{"thread_id": "$1"}'::jsonb);
```

---

## Notes

- **No foreign keys** - application logic handles referential integrity (per existing pattern)
- **Soft deletes** - `deleted_at` timestamp, never hard delete
- **Workspace isolation** - all queries scoped by `workspace_id` for future sharding
- **Event sourcing lite** - not full event sourcing, but append-mostly pattern

