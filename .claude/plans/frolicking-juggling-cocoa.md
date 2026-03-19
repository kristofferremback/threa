# Public API v1 — Phase 2 Architectural Rework

## Context

PR #220 implemented CRUD endpoints (streams, messages, users) for the public API. After review feedback from Kris and Greptile, four architectural issues need addressing:

1. **Bot identity**: `author_display_name` and `api_key_id` as flat columns on messages breaks the established `authorType + authorId → entity table` pattern. Bots should be proper entities like personas.
2. **Feature folder**: Public API handlers are misplaced in `features/api-keys/`. The public API is its own feature that wraps other features.
3. **Display name consistency**: Public API should return formatted channel names (`#slug`) so consumers don't need to know Threa conventions.
4. **OwnershipError handling**: Try/catch blocks in every handler are verbose; centralize in error middleware.

Additionally, Greptile flagged that `resolveApiKeyMessage` allows soft-deleted messages through.

---

## Step 1: Replace Migration

**Replace** `apps/backend/src/db/migrations/20260313120000_public_api_message_columns.sql`

The current migration adds `author_display_name` and `api_key_id` to messages. Replace with a migration that creates the `bots` table and removes the flat columns. Safe to replace since this migration hasn't shipped (PR not merged).

```sql
-- Bot entities for API-created messages.
-- Follows the persona pattern: authorType "bot" + authorId → bots.id
CREATE TABLE bots (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  api_key_id TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar_emoji TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One bot per API key per workspace
CREATE UNIQUE INDEX idx_bots_workspace_api_key ON bots (workspace_id, api_key_id);
```

No changes to the messages table — bots use the existing `author_id` + `author_type` columns.

---

## Step 2: Create `features/public-api/` Feature Folder

New feature folder following INV-51 colocation:

```
features/public-api/
├── handlers.ts          # All public API endpoint handlers (moved from api-keys/)
├── bot-repository.ts    # Bot entity data access
├── index.ts             # Barrel exports
```

### 2a: BotRepository (`features/public-api/bot-repository.ts`)

```ts
interface Bot {
  id: string
  workspaceId: string
  apiKeyId: string
  name: string
  avatarEmoji: string | null
  createdAt: Date
  updatedAt: Date
}

// Key methods:
findByApiKeyId(db, workspaceId, apiKeyId): Promise<Bot | null>
upsert(db, params: { id, workspaceId, apiKeyId, name }): Promise<Bot>
findById(db, id): Promise<Bot | null>
```

The `upsert` uses `ON CONFLICT (workspace_id, api_key_id) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()` (INV-20 race-safe). Called on every `sendMessage` — creates the bot on first use, updates name if changed.

### 2b: Move Handlers

Move `createPublicApiHandlers` and all serializers from `features/api-keys/handlers.ts` to `features/public-api/handlers.ts`. The api-keys barrel (`features/api-keys/index.ts`) stops exporting `createPublicApiHandlers`/`PublicApiDeps`.

Update `PublicApiDeps` interface:
```ts
export interface PublicApiDeps {
  searchService: SearchService
  apiKeyChannelService: ApiKeyChannelService
  eventService: EventService
  pool: Pool
}
```

### 2c: Update Barrel (`features/public-api/index.ts`)

```ts
export { createPublicApiHandlers, type PublicApiDeps } from "./handlers"
```

### 2d: Update Imports

- `apps/backend/src/routes.ts`: import from `features/public-api` instead of `features/api-keys`
- `apps/backend/src/features/api-keys/index.ts`: remove `createPublicApiHandlers`/`PublicApiDeps` exports

---

## Step 3: Bot Identity in Message Flow

### 3a: Remove Flat Columns from Backend Message Type

**`apps/backend/src/features/messaging/repository.ts`**:
- Remove `authorDisplayName` and `apiKeyId` from `Message` interface
- Remove `authorDisplayName` and `apiKeyId` from `InsertMessageParams`
- Remove from `SELECT_FIELDS`, `insert()` SQL, and `mapRowToMessage()`

### 3b: Remove from EventService

**`apps/backend/src/features/messaging/event-service.ts`**:
- Remove `authorDisplayName` and `apiKeyId` from `CreateMessageParams`
- Remove `apiKeyId` from `EditMessageParams` and `DeleteMessageParams`
- Remove the `apiKeyId`-based ownership check in `editMessage` and `deleteMessage` (the standard `actorId` check handles ownership naturally when the caller passes `bot.id`)

### 3c: Update `sendMessage` Handler

```ts
async sendMessage(req, res) {
  // ... validate, check stream access ...

  // Upsert bot entity (creates on first use, updates name if changed)
  const bot = await BotRepository.upsert(pool, {
    id: generateId("bot"),
    workspaceId,
    apiKeyId: apiKey.id,
    name: displayName,
  })

  // Create message with bot as author
  const message = await eventService.createMessage({
    workspaceId,
    streamId,
    authorId: bot.id,           // Bot entity ID, not API key ID
    authorType: AuthorTypes.BOT,
    contentJson,
    contentMarkdown,
  })

  res.status(201).json({ data: serializeMessage(message) })
}
```

### 3d: Update `resolveApiKeyMessage` Helper

The helper now also verifies bot ownership:

```ts
async function resolveApiKeyMessage(messageId: string, req: Request) {
  const message = await eventService.getMessageById(messageId)
  if (!message || message.deletedAt) {  // ← Greptile fix: reject soft-deleted
    throw new HttpError("Message not found", { status: 404, code: "NOT_FOUND" })
  }

  // Verify stream access
  const accessibleStreamIds = await getAccessibleStreamIds(req)
  if (!accessibleStreamIds.includes(message.streamId)) {
    throw new HttpError("Stream not accessible", { status: 403, code: "FORBIDDEN" })
  }

  // Verify bot ownership: message must be authored by a bot owned by this API key
  if (message.authorType !== AuthorTypes.BOT) {
    throw new HttpError("Cannot modify messages not created via API", { status: 403, code: "FORBIDDEN" })
  }

  const bot = await BotRepository.findById(pool, message.authorId)
  if (!bot || bot.apiKeyId !== req.apiKey!.id) {
    throw new HttpError("Cannot modify messages created by another API key", { status: 403, code: "FORBIDDEN" })
  }

  return { message, bot }
}
```

### 3e: Update `updateMessage` and `deleteMessage` Handlers

With ownership verified in `resolveApiKeyMessage`, the handlers become simpler — no try/catch for `OwnershipError`:

```ts
async updateMessage(req, res) {
  const { message, bot } = await resolveApiKeyMessage(messageId, req)
  const updated = await eventService.editMessage({
    workspaceId,
    messageId,
    streamId: message.streamId,
    contentJson,
    contentMarkdown,
    actorId: bot.id,
    actorType: AuthorTypes.BOT,
    // No apiKeyId — ownership already verified
  })
  if (!updated) throw new HttpError("Message not found or was deleted", { status: 404, code: "NOT_FOUND" })
  res.json({ data: serializeMessage(updated) })
}
```

### 3f: Serialize Bot Display Name

The `serializeMessage` function needs the bot name for the response. Two options:
- **Option A**: `resolveApiKeyMessage` already returns the bot — pass it through
- **Option B**: Add `authorDisplayName` back to the serialized response by looking up the bot

For `listMessages` (read endpoint), messages don't go through `resolveApiKeyMessage`. The message itself no longer has `authorDisplayName`. To include bot names in list responses, join with the bots table or do a batch lookup.

**Approach**: Add an optional `authorDisplayName` to the serialize call. For bot messages in list responses, batch-fetch bot names by collecting unique bot authorIds and querying the bots table. For send/update responses, use the bot name from the upserted/resolved bot.

```ts
function serializeMessage(message: Message, authorDisplayName?: string | null) {
  return {
    ...baseFields,
    authorDisplayName: authorDisplayName ?? null,
  }
}
```

For `listMessages`:
```ts
// After fetching messages, resolve bot display names
const botIds = [...new Set(page.filter(m => m.authorType === 'bot').map(m => m.authorId))]
const bots = botIds.length > 0 ? await BotRepository.findByIds(pool, botIds) : []
const botNameMap = new Map(bots.map(b => [b.id, b.name]))

res.json({
  data: page.map(m => serializeMessage(m, m.authorType === 'bot' ? botNameMap.get(m.authorId) : null)),
  hasMore,
})
```

Add `findByIds(db, ids: string[]): Promise<Bot[]>` to BotRepository (batch lookup, INV-56).

---

## Step 4: Display Name Consistency

**`features/public-api/handlers.ts` — `serializeStream`**:

```ts
function serializeStream(stream: { type: string; slug: string | null; displayName: string | null; ... }) {
  return {
    ...otherFields,
    displayName: stream.type === "channel" && stream.slug ? `#${stream.slug}` : stream.displayName,
    slug: stream.slug,
  }
}
```

Channels get `#slug` as displayName. Other stream types keep their raw displayName. The `slug` field remains available separately for consumers who need the raw value.

---

## Step 5: Centralize OwnershipError Handling

**`apps/backend/src/middleware/error-handler.ts`**:

```ts
import { OwnershipError } from "../features/messaging"

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof OwnershipError) {
    return res.status(403).json({ error: err.message, code: "FORBIDDEN" })
  }
  // ... existing MulterError handling ...
}
```

This means any handler that encounters an OwnershipError gets an automatic 403 without try/catch. The public API handlers won't hit this path (they check ownership explicitly), but internal handlers benefit from the centralization.

---

## Step 6: Remove `authorDisplayName` from Shared Domain Type

**`packages/types/src/domain.ts`**: The `Message` type should not have `authorDisplayName` — it's resolved from the bot entity, not stored on the message. (Note: `apiKeyId` was already removed from the shared type in the previous commit.)

---

## Step 7: Update Routes and Server

**`apps/backend/src/routes.ts`**:
- Change import from `"../features/api-keys"` to `"../features/public-api"` for `createPublicApiHandlers`/`PublicApiDeps`
- No route path changes needed

**`apps/backend/src/server.ts`**: No changes needed — `eventService` and `pool` are already passed through `registerRoutes`.

---

## Step 8: Update E2E Tests

**`apps/backend/tests/e2e/public-api-crud.test.ts`**:

- Bot messages now have `authorId` as a `bot_xxx` ID (not the API key ID). Tests asserting `authorType: "bot"` and `authorDisplayName` still pass.
- Cross-key tests still work: different API keys produce different bot entities, so ownership checks fail correctly.
- Add test: verify `listMessages` includes `authorDisplayName` for bot messages.
- Add test: verify `serializeStream` returns `#slug` for channels.
- The soft-delete test (double-delete returning 404) already exists.
- Add test: verify update/delete returns 404 for soft-deleted message (Greptile fix).

---

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/backend/src/db/migrations/20260313120000_public_api_message_columns.sql` | Replace | Create bots table instead of message columns |
| `apps/backend/src/features/public-api/handlers.ts` | New | Moved from api-keys, updated for bot entity |
| `apps/backend/src/features/public-api/bot-repository.ts` | New | Bot entity data access |
| `apps/backend/src/features/public-api/index.ts` | New | Barrel exports |
| `apps/backend/src/features/api-keys/handlers.ts` | Delete | Moved to public-api (api-keys keeps only key management) |
| `apps/backend/src/features/api-keys/index.ts` | Edit | Remove public API exports |
| `apps/backend/src/features/messaging/repository.ts` | Edit | Remove authorDisplayName, apiKeyId from Message/insert |
| `apps/backend/src/features/messaging/event-service.ts` | Edit | Remove apiKeyId from params and ownership checks |
| `apps/backend/src/middleware/error-handler.ts` | Edit | Add OwnershipError → 403 handling |
| `packages/types/src/domain.ts` | Edit | Remove authorDisplayName from Message |
| `apps/backend/src/routes.ts` | Edit | Import from features/public-api |
| `apps/backend/tests/e2e/public-api-crud.test.ts` | Edit | Update assertions for bot entity pattern |

## Verification

1. `bun run typecheck` — all types consistent after removing flat columns
2. `bun run test` — unit tests pass (no internal code depends on authorDisplayName/apiKeyId on messages)
3. `bun run test:e2e` — all 254+ E2E tests pass, including:
   - Bot message has `authorType: "bot"` and `authorDisplayName` resolved from bot entity
   - Cross-key ownership still enforced (403)
   - Soft-deleted messages return 404 on update/delete
   - Channel display names include `#` prefix
   - Double-delete returns 404
4. Manual: `curl` send → update → delete flow with a valid API key
5. Real-time: Bot message appears in connected Threa client via outbox/WebSocket
