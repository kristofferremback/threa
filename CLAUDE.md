## Important Documentation

- **[docs/features.md](docs/features.md)** - UI component feature specifications. **MUST READ** before modifying frontend components to avoid accidentally removing features.

---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";

// import .css files directly and it works
import './index.css';

import { createRoot } from "react-dom/client";

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.md`.

## Configuration

All server-side environment variables must be defined in `src/server/config.ts` and imported from there. Never use `process.env` directly in application code - only in config.ts.

## Architecture: Message Flow

### Posting a Message (Optimistic Updates + Outbox Pattern)

The message flow uses optimistic updates with an outbox pattern for offline support.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. User types message and hits send                                        │
│     └── usePostMessage.ts:postMessage()                                     │
│                                                                             │
│  2. Generate temp_xxx ID (clientMessageId)                                  │
│     └── message-outbox.ts:generateTempId()                                  │
│                                                                             │
│  3. Add to localStorage outbox (survives page refresh)                      │
│     └── message-outbox.ts:addToOutbox()                                     │
│                                                                             │
│  4. Add optimistic event to TanStack Query cache                            │
│     └── Shows immediately in UI with pending=true                           │
│                                                                             │
│  5. Send HTTP POST to server                                                │
│     └── streamApi.postMessage(workspaceId, streamId, {                      │
│           content, mentions, clientMessageId: temp_xxx                      │
│         })                                                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SERVER                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  6. Route handler receives POST                                             │
│     └── stream-routes.ts:POST /api/streams/:streamId/events                 │
│                                                                             │
│  7. Idempotency check: if clientMessageId exists, return existing event     │
│     └── stream-service.ts:createEvent() or replyToEvent()                   │
│                                                                             │
│  8. Create event in DB (with client_message_id stored)                      │
│     └── INSERT INTO stream_events (..., client_message_id)                  │
│                                                                             │
│  9. Publish to outbox table (transactional)                                 │
│     └── outbox-events.ts:publishOutboxEvent(STREAM_EVENT_CREATED, {         │
│           event_id, stream_id, client_message_id, ...                       │
│         })                                                                  │
│                                                                             │
│  10. Return event to client                                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           OUTBOX LISTENER                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  11. PostgreSQL NOTIFY triggers outbox listener                             │
│      └── outbox-listener.ts:processOutboxEvents()                           │
│                                                                             │
│  12. Publish to Redis pub/sub                                               │
│      └── redisPublisher.publish("event:stream_event.created", payload)      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           WEBSOCKET SERVER                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  13. Redis subscriber receives event                                        │
│      └── stream-socket.ts:messageSubscriber.on("message")                   │
│                                                                             │
│  14. Build eventData including clientMessageId                              │
│      └── { id, streamId, content, ..., clientMessageId }                    │
│                                                                             │
│  15. Emit to Socket.IO room                                                 │
│      └── io.to(room.stream(workspace_id, stream_id)).emit("event", data)    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (RECEIVER)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  16. Socket.IO handler receives event                                       │
│      └── useStreamWithQuery.ts:socket.on("event", ...)                      │
│                                                                             │
│  17. Check if event.clientMessageId matches a temp_xxx event                │
│      └── If match: REPLACE temp event with real event (no duplicate)        │
│      └── If no match: ADD as new event (from another user)                  │
│                                                                             │
│  18. Remove from outbox on HTTP success                                     │
│      └── usePostMessage.ts:onSuccess → removeFromOutbox(tempId)             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Files

- `src/frontend/mutations/usePostMessage.ts` - Mutation hook with optimistic updates
- `src/frontend/lib/message-outbox.ts` - localStorage persistence for offline support
- `src/frontend/hooks/useStreamWithQuery.ts` - WebSocket handling + TanStack Query cache updates
- `src/server/routes/stream-routes.ts` - HTTP endpoint for posting messages
- `src/server/services/stream-service.ts` - Business logic + idempotency checks
- `src/server/lib/outbox-events.ts` - Outbox event types and publishing
- `src/server/lib/outbox-listener.ts` - Polls outbox table, publishes to Redis
- `src/server/websockets/stream-socket.ts` - Redis subscriber → Socket.IO broadcaster

### Pending Threads (Reply to Message)

When replying to a message that doesn't have a thread yet:

1. Frontend uses `streamId = "event_xxx"` (the parent event ID)
2. Server route detects `streamId === "pending"` and creates thread on first message
3. Uses `parentEventId` and `parentStreamId` from request body
4. Returns the new thread's Stream object along with the event

### Offline Support

1. Messages stored in outbox BEFORE HTTP request
2. On page load, `resetSendingMessages()` resets stuck "sending" → "pending"
3. On reconnect, retry all pending/failed messages
4. Server idempotency via `client_message_id` prevents duplicates
