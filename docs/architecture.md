# Architecture Patterns

This document describes the key architectural patterns used throughout the Threa backend.

## Repository Pattern

Repositories provide the data access layer, keeping SQL queries isolated from business logic.

### Design Principles

- **Static methods**: Each repository is a namespace of static-like methods (no instance state)
- **Querier first parameter**: All methods take `Querier` (Pool or PoolClient) as first parameter
- **Type mapping**: Internal row types (snake_case DB) mapped to domain types (camelCase TypeScript)
- **Pure data access**: No side effects, no business logic, no transaction management
- **Type-safe SQL**: Use template tag SQL via `squid/pg` for compile-time safety

### Example

```typescript
// apps/backend/src/repositories/stream.repository.ts
export const StreamRepository = {
  async findById(querier: Querier, streamId: string): Promise<Stream | null> {
    const result = await querier.query(sql`
      SELECT * FROM streams WHERE id = ${streamId}
    `)
    if (result.rows.length === 0) return null
    return mapRowToStream(result.rows[0])
  },

  async insert(querier: Querier, data: CreateStreamData): Promise<Stream> {
    const result = await querier.query(sql`
      INSERT INTO streams (id, workspace_id, type, visibility, ...)
      VALUES (${data.id}, ${data.workspaceId}, ${data.type}, ...)
      RETURNING *
    `)
    return mapRowToStream(result.rows[0])
  },
}

// Type mapping (internal)
function mapRowToStream(row: StreamRow): Stream {
  return {
    id: row.id,
    workspaceId: row.workspace_id, // snake_case → camelCase
    type: row.type,
    visibility: row.visibility,
    // ...
  }
}
```

### Why Querier?

By accepting `Querier` (union of Pool | PoolClient), repositories work in both contexts:

- Direct pool access: `StreamRepository.findById(pool, id)`
- Within transaction: `StreamRepository.findById(client, id)`

This enables composition without repositories knowing about transactions.

### Anti-Patterns to Avoid

❌ **Don't manage transactions in repositories**

```typescript
// Bad
async createStream(data) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // ...
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
  }
}
```

❌ **Don't add business logic to repositories**

```typescript
// Bad
async insert(querier, data) {
  // Validate business rules
  if (data.type === 'channel' && !data.slug) {
    throw new Error('Channels need slugs')
  }
  // Send notifications
  await notificationService.send(...)
}
```

## Service Layer

Services orchestrate business logic and manage transaction boundaries.

### Design Principles

- **Class-based**: Services are classes with Pool injected in constructor
- **Transaction owners**: Services decide transaction boundaries via `withTransaction()` / `withClient()`
- **Business logic home**: Contains domain logic, validation, coordination
- **Repository coordination**: Calls multiple repositories within single transaction
- **Thin handlers**: HTTP handlers and workers just call service methods

### Example

```typescript
// apps/backend/src/services/stream.service.ts
export class StreamService {
  constructor(private pool: Pool) {}

  async createStream(params: CreateStreamParams): Promise<Stream> {
    return withTransaction(this.pool, async (client) => {
      // 1. Create stream
      const stream = await StreamRepository.insert(client, {
        id: ulid(),
        workspaceId: params.workspaceId,
        type: params.type,
        visibility: params.visibility,
      })

      // 2. Add creator as member
      await StreamMemberRepository.insert(client, {
        streamId: stream.id,
        userId: params.creatorId,
        role: "owner",
      })

      // 3. Publish event for async processing
      await OutboxRepository.insert(client, "stream:created", {
        streamId: stream.id,
        workspaceId: stream.workspaceId,
      })

      return stream
    })
  }

  async getStream(streamId: string): Promise<Stream | null> {
    // Simple reads can use pool directly (no transaction needed)
    return StreamRepository.findById(this.pool, streamId)
  }
}
```

### withTransaction vs withClient

**withTransaction**: Multi-step writes that must be atomic

```typescript
async createWithMembers(data) {
  return withTransaction(this.pool, async (client) => {
    const stream = await StreamRepository.insert(client, data)
    await StreamMemberRepository.insertMany(client, members)
    await OutboxRepository.insert(client, 'created', {...})
    return stream
  })
}
```

**withClient**: Multiple reads from same connection (connection affinity)

```typescript
async getStreamWithMembers(streamId) {
  return withClient(this.pool, async (client) => {
    const stream = await StreamRepository.findById(client, streamId)
    const members = await StreamMemberRepository.findByStream(client, streamId)
    return { stream, members }
  })
}
```

**Direct pool**: Single query (INV-30)

```typescript
async getStream(streamId) {
  // Don't wrap single queries - just use pool directly
  return StreamRepository.findById(this.pool, streamId)
}
```

## Outbox Pattern + Listeners

The outbox pattern enables reliable, ordered event processing without distributed transactions.

### Architecture

```
┌─────────────────┐
│  HTTP Request   │
│   (Transaction) │
├─────────────────┤
│ 1. Update data  │
│ 2. Insert event │◄─── Single transaction
│    into outbox  │
└────────┬────────┘
         │
         ├─ NOTIFY "outbox_event"
         │
    ┌────▼─────────────┐
    │ OutboxDispatcher │◄─── LISTEN on dedicated connection
    │ (separate pool)  │
    └────┬─────────────┘
         │
         ├─ Notifies all registered handlers
         │
    ┌────▼──────────┐  ┌──────────────┐
    │ BroadcastHdlr │  │ NamingHandler│  (and others...)
    │ (WebSocket)   │  │ (Job queue)  │
    └───────────────┘  └──────────────┘
```

### Publishing Events (In Transaction)

```typescript
await withTransaction(pool, async (client) => {
  // Do work
  const stream = await StreamRepository.insert(client, data)

  // Publish event (same transaction)
  await OutboxRepository.insert(client, "stream:created", {
    streamId: stream.id,
    workspaceId: stream.workspaceId,
  })
})
// Transaction commits → automatic PostgreSQL NOTIFY
```

### Processing Events (Out of Transaction)

Each handler implements `OutboxHandler` interface:

```typescript
export interface OutboxHandler {
  name: string
  handle(event: OutboxEvent): Promise<void>
}

export const BroadcastHandler: OutboxHandler = {
  name: "broadcast",
  async handle(event) {
    // Determine room based on event type and payload
    const room = computeRoom(event)
    // Broadcast to WebSocket clients
    io.to(room).emit(event.type, event.payload)
  },
}
```

### Cursor-Based Processing

Each handler tracks its own cursor (last processed event ID):

```typescript
// handlers/memo-accumulator.handler.ts
await cursorLock.run(async (cursor) => {
  // Fetch events after last processed
  const events = await OutboxRepository.fetchAfterId(client, cursor, 100)

  for (const event of events) {
    if (event.type === "message:created") {
      await memoAccumulator.add(event.payload)
    }
  }

  // Return new cursor position
  return {
    status: "processed",
    newCursor: events[events.length - 1]?.id ?? cursor,
  }
})
```

### CursorLock: Time-Based Locking

Traditional transactions would hold connections too long. Instead, use time-based locks:

```typescript
await cursorLock.run(async (cursor) => {
  // Lock acquired via locked_until timestamp
  // Automatically refreshed every 5s
  // If process crashes, lock expires and another worker takes over

  // Process events without holding DB connection
  const events = await fetchEvents(cursor)
  await processEvents(events)

  return { status: "processed", newCursor: latestId }
})
```

Benefits:

- No connection held during long processing
- Automatic failover if process crashes
- Multiple workers can handle different handlers concurrently

### Event Scoping

Events are scoped for efficient broadcasting:

- **Stream-scoped**: `ws:{workspaceId}:stream:{streamId}` - Only subscribers to specific stream
- **Workspace-scoped**: `ws:{workspaceId}` - All workspace members
- **Author-scoped**: Only the message author's sockets

Example:

```typescript
// Stream-scoped: message in specific stream
io.to(`ws:${workspaceId}:stream:${streamId}`).emit('message:created', {...})

// Workspace-scoped: new stream created
io.to(`ws:${workspaceId}`).emit('stream:created', {...})
```

### Available Handlers

- **BroadcastHandler**: WebSocket broadcasting to connected clients
- **NamingHandler**: Auto-naming streams from first message
- **CompanionHandler**: AI companion responses
- **EmojiUsageHandler**: Track emoji usage statistics
- **EmbeddingHandler**: Generate embeddings for search
- **BoundaryExtractionHandler**: Extract conversation boundaries
- **MemoAccumulatorHandler**: Queue messages for memo creation

### Debouncing

Handlers receive NOTIFY on every outbox insert. Debouncing prevents rapid re-runs:

```typescript
let debounceTimer: NodeJS.Timeout | null = null

function handleNotify() {
  if (debounceTimer) clearTimeout(debounceTimer)

  debounceTimer = setTimeout(async () => {
    await processEvents()
    debounceTimer = null
  }, 100) // 100ms debounce
}
```

## Event Sourcing + Projections

Events are the source of truth; projections are derived views for query performance.

### Architecture

```
Write Path:
  Message sent
    ↓
  INSERT INTO stream_events (append-only log)
    ↓
  UPDATE messages (current state projection)
    ↓
  Both in same transaction

Read Path:
  Query messages table (fast, denormalized)
  Or replay stream_events for audit/debugging
```

### Example

```typescript
async sendMessage(params) {
  return withTransaction(pool, async (client) => {
    // 1. Get next sequence number (atomic)
    const seq = await getNextSequence(client, streamId)

    // 2. Append event (source of truth)
    const event = await StreamEventRepository.insert(client, {
      streamId,
      sequence: seq,
      type: 'message:sent',
      payload: { content, authorId, ... },
    })

    // 3. Update projection (for fast queries)
    const message = await MessageRepository.upsert(client, {
      id: event.id,
      streamId,
      content: event.payload.content,
      authorId: event.payload.authorId,
      // Denormalized for queries
    })

    return message
  })
}
```

### Sequence Numbers

Per-stream atomic counters ensure event ordering:

```sql
-- stream_sequences table
INSERT INTO stream_sequences (stream_id, sequence)
VALUES (?, 1)
ON CONFLICT (stream_id) DO UPDATE
  SET sequence = stream_sequences.sequence + 1
RETURNING sequence
```

Benefits:

- Guaranteed order within stream
- No gaps (unlike auto-increment across concurrent transactions)
- Fast (`ON CONFLICT DO UPDATE` is atomic)

### Why Both Events and Projections?

**Events** (`stream_events`):

- Immutable append-only log
- Complete audit trail
- Can replay to rebuild projections
- Source of truth

**Projections** (`messages`, `memos`, etc.):

- Fast queries (indexed, denormalized)
- Current state only
- Can be rebuilt from events if corrupted

## Job Queue + Workers

Background work runs via PostgreSQL-backed job queue with typed handlers.

### Job Structure

```typescript
interface Job<T> {
  id: string
  type: string
  data: T
  priority: number
  runAt: Date
  attempts: number
  maxAttempts: number
}

type JobHandler<T> = (job: Job<T>) => Promise<void>
```

### Worker Pattern

```typescript
// workers/naming.worker.ts
export function createNamingWorker(deps: { streamNamingService: StreamNamingService }): JobHandler<NamingJobData> {
  return async (job) => {
    const { streamId } = job.data
    await deps.streamNamingService.attemptAutoNaming(streamId)
  }
}

// workers/index.ts
const workers = {
  "stream:naming": createNamingWorker({ streamNamingService }),
  "stream:companion": createCompanionWorker({ companionService }),
  "message:embedding": createEmbeddingWorker({ embeddingService }),
  // ...
}

jobQueue.process(workers)
```

### Why Thin Workers?

Workers are infrastructure. Business logic lives in services for reusability:

```typescript
// ✅ Good: Service method reusable
class StreamNamingService {
  async attemptAutoNaming(streamId: string) {
    // Business logic here
  }
}

// Worker is just a thin wrapper
createNamingWorker(deps) {
  return async (job) => {
    await deps.streamNamingService.attemptAutoNaming(job.data.streamId)
  }
}

// Can call from:
// 1. Job worker
// 2. HTTP handler
// 3. Eval harness
```

### Available Workers

- **Naming**: Auto-name streams from first message
- **Companion**: AI companion response generation
- **Embedding**: Generate embeddings for search
- **BoundaryExtraction**: Extract conversation boundaries
- **MemoBatch**: Batch memo creation
- **Command**: Execute slash commands
- **PersonaAgent**: Run persona agent sessions

## Middleware Composition

Middleware factories enable flexible permission composition.

### Pattern

```typescript
// middleware/auth.middleware.ts
export function createAuthMiddleware(deps: { authService: AuthService; userService: UserService }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.replace("Bearer ", "")
    if (!token) {
      throw new UnauthorizedError("No token provided")
    }

    const session = await deps.authService.validateToken(token)
    const user = await deps.userService.getById(session.userId)

    req.auth = { session, user } // Attach to request
    next()
  }
}
```

### Composition

```typescript
// Compose multiple middlewares
app.use(
  compose(createAuthMiddleware({ authService, userService }), createWorkspaceMemberMiddleware({ workspaceService }))
)

// Or apply individually
app.get("/streams", createAuthMiddleware(deps), createWorkspaceMemberMiddleware(deps), streamHandlers.list)
```

### Benefits

- Each middleware testable in isolation
- Routes can mix and match permissions
- Adding new checks is additive
- Clear dependency graph via factories

## Handler Factory Pattern

HTTP handlers are created via factories for dependency injection.

### Pattern

```typescript
// handlers/stream.handlers.ts
export function createStreamHandlers(deps: { streamService: StreamService; eventService: EventService }) {
  return {
    async list(req: Request, res: Response) {
      const { workspaceId } = req.params
      const streams = await deps.streamService.listByWorkspace(workspaceId)
      res.json({ streams })
    },

    async create(req: Request, res: Response) {
      const stream = await deps.streamService.createStream({
        workspaceId: req.params.workspaceId,
        creatorId: req.auth.user.id,
        ...req.body,
      })
      res.status(201).json({ stream })
    },
  }
}
```

### Usage

```typescript
// app.ts
const streamHandlers = createStreamHandlers({
  streamService,
  eventService,
})

app.get("/workspaces/:workspaceId/streams", streamHandlers.list)
app.post("/workspaces/:workspaceId/streams", streamHandlers.create)
```

### Benefits

- Explicit dependencies (no hidden globals)
- Testable (inject mocks)
- Clear initialization order
- Type-safe

## Database Pool Separation

Multiple connection pools prevent resource starvation.

### Pool Configuration

```typescript
// pools/main.ts
export const mainPool = new Pool({
  connectionString: DATABASE_URL,
  max: 30, // Higher limit for transactional work
})

// pools/listen.ts
export const listenPool = new Pool({
  connectionString: DATABASE_URL,
  max: 12, // Lower limit, long-held connections
})
```

### Usage

**Main Pool** (30 connections):

- HTTP request handlers
- Service methods
- Job workers
- Short-lived transactions

**Listen Pool** (12 connections):

- NOTIFY/LISTEN connections (one per handler)
- WebSocket server LISTEN
- Long-held, never released

### Why Separate?

Without separation:

```
LISTEN connections consume pool
  ↓
HTTP requests wait for connections
  ↓
Requests timeout
  ↓
System appears hung
```

With separation:

```
LISTEN has dedicated pool (12)
  ↓
HTTP requests use main pool (30)
  ↓
Each pool sized for its workload
  ↓
No resource contention
```

## Cursor Lock + Time-Based Locking

Prevents connection pool exhaustion during long-running event processing.

### Problem

Traditional approach (holding connection):

```typescript
const client = await pool.connect()
try {
  await client.query("BEGIN")
  const events = await fetchEvents(client)
  await processEvents(events) // Could take minutes!
  await client.query("COMMIT")
} finally {
  client.release()
}
```

Issues:

- Connection held during entire processing
- Pool exhaustion if many handlers
- No failover if process crashes

### Solution: Time-Based Lock

```typescript
await cursorLock.run(async (cursor) => {
  // 1. Acquire lock via timestamp
  //    UPDATE handler_cursors
  //    SET locked_until = NOW() + INTERVAL '30 seconds'
  //    WHERE name = ? AND locked_until < NOW()

  // 2. Fetch events (quick query, release connection)
  const events = await OutboxRepository.fetchAfterId(pool, cursor, 100)

  // 3. Process without holding connection
  for (const event of events) {
    await handleEvent(event)
    // Lock automatically refreshed every 5s
  }

  // 4. Update cursor position
  return {
    status: "processed",
    newCursor: events[events.length - 1]?.id ?? cursor,
  }
})
```

### Benefits

- No connection held during processing
- Lock expires if process crashes (automatic failover)
- Multiple handlers can run concurrently
- Each handler tracks own cursor independently

### Lock Refresh

```typescript
// Background task refreshes lock every 5s
setInterval(async () => {
  await pool.query(`
    UPDATE handler_cursors
    SET locked_until = NOW() + INTERVAL '30 seconds'
    WHERE name = ? AND locked_until > NOW()
  `)
}, 5000)
```

If process crashes, lock expires after 30s and another worker can take over.
