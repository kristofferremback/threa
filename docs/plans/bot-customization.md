# Bot Customization Plan

## Problem

Bots are currently a side-effect of API key usage, not a first-class entity:

1. Admin creates a workspace API key (via WorkOS widget)
2. Bot is **auto-created on first message** with the API key's name
3. No UI to manage bot profiles (name, avatar, description)
4. No way to define a bot before it starts sending messages
5. Bot's name is always derived from the API key name — renaming the key renames the bot
6. WorkOS widget is a black box — can't show bot associations, customize scopes, or control UX

The bot is a shadow entity with no independent identity.

## Goal

Make bots first-class workspace entities with rich profiles that admins can customize. Replace WorkOS API key management with self-managed bot keys (mirroring the existing user API key system). The bot becomes the primary entity; keys are its authentication credentials.

## Design Decisions

### D1: Invert the relationship — Bot is primary, keys are credentials

**Current**: WorkOS API key → auto-creates bot on first message (1:1)
**Proposed**: Admin creates bot → generates/manages keys for it

This means:

- Bots can exist without any API key (created but not yet connected)
- Bot identity (name, avatar, description, slug) is fully independent of keys
- Multiple keys per bot become possible (rotation, environment separation)
- `bots.api_key_id` column becomes nullable (standalone bots) and eventually removed in favor of the new `bot_api_keys` table

### D2: Bot profile fields

| Field          | Type            | Notes                                             |
| -------------- | --------------- | ------------------------------------------------- |
| `name`         | `TEXT NOT NULL` | Display name (freeform, not unique)               |
| `slug`         | `TEXT NOT NULL` | **New** — unique per workspace, like user slugs   |
| `description`  | `TEXT`          | Already exists — bio/about                        |
| `avatar_emoji` | `TEXT`          | Already exists — emoji avatar                     |
| `avatar_url`   | `TEXT`          | **New** — S3 key base path, same pattern as users |
| `archived_at`  | `TIMESTAMPTZ`   | **New** — soft delete, messages keep showing bot  |

Slugs are unique per workspace (like users). Display names are freeform visual labels.

### D3: Replace WorkOS API keys with self-managed bot keys

The existing user API key system (`user_api_keys`, `UserApiKeyService`) already implements:

- Secure key generation (`threa_uk_` prefix + 256-bit random + base64url)
- SHA256 hashing with timing-safe comparison
- Prefix-based candidate lookup
- Scopes, expiration, revocation, last-used tracking

We replicate this exact pattern for bot keys:

- **New prefix**: `threa_bk_` (bot key)
- **New table**: `bot_api_keys` (mirrors `user_api_keys` structure + `bot_id` column)
- **New service**: `BotApiKeyService` (same crypto, same validation pattern)
- **Scopes**: Same `API_KEY_SCOPES` enum initially, can diverge later

This lets us:

- Drop the WorkOS widget and its token endpoint for API key management
- Show bot ↔ key associations in our own UI
- Control the full key lifecycle (create, revoke, rotate)
- Keep WorkOS for auth/SSO only (its core value)

### D4: Avatar system reuse

User avatars already have a full pipeline:

- Upload raw image → `avatar_uploads` tracking table → worker processes with sharp → S3 WebP at 256px + 64px
- `AvatarService` handles processing, upload, streaming, deletion
- Frontend: `getAvatarUrl()` constructs serving URL from S3 key base path

For bots, we reuse the same `AvatarService` but with bot-scoped S3 paths:

- Key pattern: `avatars/{workspaceId}/bots/{botId}/{timestamp}` (vs `avatars/{workspaceId}/{userId}/{timestamp}` for users)
- Serving endpoint: `GET /api/workspaces/:workspaceId/bots/:botId/avatar/:file`
- Same processing pipeline (sharp resize -> WebP -> S3)

### D5: Admin-only management

Bot management is admin/owner-only. Add a "Bots" tab to workspace settings dialog, replacing the current WorkOS API key widget section with native bot + key management.

### D6: Backwards compatibility for auto-creation

The existing auto-create-on-first-message flow stays as a fallback:

- If a key already has a linked bot -> use it (no profile override)
- If no linked bot exists -> auto-create one (current behavior, preserves existing integrations)
- During migration: existing WorkOS-linked bots continue working until keys are rotated to native bot keys

### D7: Soft delete via `archived_at`

Bots are soft-deleted. Archived bots:

- Don't appear in active bot lists or settings UI
- Keep their profile data for message display (historical messages still show bot name/avatar)
- Have their API keys automatically revoked on archive
- Can be restored by admin (clear `archived_at`)

## Implementation Plan

### Phase 1: Database — Evolve bots table + create bot_api_keys

**Migration**: `{timestamp}_bot_customization.sql`

```sql
-- Evolve bots table
ALTER TABLE bots ADD COLUMN slug TEXT;
ALTER TABLE bots ADD COLUMN avatar_url TEXT;
ALTER TABLE bots ADD COLUMN archived_at TIMESTAMPTZ;

-- Make api_key_id nullable (bots can exist without keys)
ALTER TABLE bots ALTER COLUMN api_key_id DROP NOT NULL;

-- Unique slug per workspace (only among non-archived bots)
CREATE UNIQUE INDEX idx_bots_workspace_slug
  ON bots (workspace_id, slug) WHERE archived_at IS NULL;

-- Backfill slugs for existing bots from name (slugified)
-- Done in application code post-migration

-- Self-managed bot API keys (mirrors user_api_keys)
CREATE TABLE bot_api_keys (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  scopes TEXT[] NOT NULL,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bot_api_keys_bot
  ON bot_api_keys (workspace_id, bot_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_bot_api_keys_prefix
  ON bot_api_keys (key_prefix) WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW());
```

**Files changed**:

- `apps/backend/src/db/migrations/{timestamp}_bot_customization.sql` (new)
- `apps/backend/src/features/public-api/bot-repository.ts` — add new columns to `BOT_COLUMNS`, `BotRow`, `Bot` interface, `mapRowToBot`
- `packages/types/src/domain.ts` — add `avatarUrl`, `slug`, `archivedAt` to `Bot` interface

### Phase 2: Bot API key service

Create `BotApiKeyService` mirroring `UserApiKeyService`.

**New prefix**: `threa_bk_`

**Key operations**:

- `createKey({ workspaceId, botId, name, scopes, expiresAt })` — same crypto as user keys
- `validateKey(value)` — returns `{ id, workspaceId, botId, name, scopes }` or null
- `listKeys(workspaceId, botId)` — active + revoked keys for a bot
- `revokeKey(workspaceId, botId, keyId)` — soft revoke via `revoked_at`

**Update auth middleware** (`public-api-auth.ts`):

- Current chain: try `threa_uk_` → fall through to WorkOS
- New chain: try `threa_uk_` → try `threa_bk_` → fall through to WorkOS (for migration period)
- Eventually: try `threa_uk_` → try `threa_bk_` → reject

**Files changed**:

- `apps/backend/src/features/public-api/bot-api-key-repository.ts` (new) — DB operations
- `apps/backend/src/features/public-api/bot-api-key-service.ts` (new) — key lifecycle
- `apps/backend/src/middleware/public-api-auth.ts` — add bot key validation to chain
- `packages/types/src/api-keys.ts` — add `BOT_KEY_PREFIX`, bot key types
- `apps/backend/src/lib/id.ts` — add `botApiKeyId()` generator

### Phase 3: Bot CRUD API endpoints

Workspace-scoped, admin-only bot management.

**New endpoints**:

- `POST /api/workspaces/:workspaceId/bots` — create bot (name, slug, description, avatarEmoji)
- `PATCH /api/workspaces/:workspaceId/bots/:botId` — update bot profile
- `POST /api/workspaces/:workspaceId/bots/:botId/archive` — soft delete
- `POST /api/workspaces/:workspaceId/bots/:botId/restore` — undo archive
- `GET /api/workspaces/:workspaceId/bots` — list active bots (bootstrap already includes this)

**Bot key management endpoints** (nested under bot):

- `POST /api/workspaces/:workspaceId/bots/:botId/keys` — generate new key
- `GET /api/workspaces/:workspaceId/bots/:botId/keys` — list keys
- `POST /api/workspaces/:workspaceId/bots/:botId/keys/:keyId/revoke` — revoke key

**Validation schemas** (Zod, INV-55):

```ts
const createBotSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/),
  description: z.string().max(500).nullable().optional(),
  avatarEmoji: z.string().nullable().optional(),
})

const updateBotSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  description: z.string().max(500).nullable().optional(),
  avatarEmoji: z.string().nullable().optional(),
})

const createBotKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.enum([...Object.values(API_KEY_SCOPES)])).min(1),
  expiresAt: z.string().datetime().nullable().optional(),
})
```

**Files changed**:

- `apps/backend/src/features/public-api/bot-repository.ts` — add `create()`, `update()`, `archive()`, `restore()` methods
- `apps/backend/src/features/public-api/bot-service.ts` (new) — business logic, slug uniqueness, archive cascade
- `apps/backend/src/features/public-api/handlers.ts` — handler factories for new endpoints
- `apps/backend/src/features/public-api/router.ts` — register new routes
- Outbox events: `bot:created`, `bot:updated`, `bot:archived` (new)

### Phase 4: Update message-send flow to respect bot profiles

**Current behavior**: On every message send, bot name is overwritten with API key name.
**New behavior**: If bot already exists, use it as-is. No profile overrides.

For bot keys (`threa_bk_`):

- Middleware resolves `botId` from the validated key
- Message handler uses bot directly — no upsert needed

For legacy WorkOS keys (migration period):

- Existing `findOrCreate` behavior, but `DO NOTHING` on conflict (no name update)

**Files changed**:

- `apps/backend/src/features/public-api/handlers.ts` — change upsert to insert-only on conflict, add bot key path
- `apps/backend/src/features/public-api/bot-repository.ts` — add `findOrCreate()` that inserts but never updates

### Phase 5: Bot avatar upload

Reuse the user avatar pipeline with bot-scoped paths.

**New endpoints**:

- `POST /api/workspaces/:workspaceId/bots/:botId/avatar` — upload image
- `GET /api/workspaces/:workspaceId/bots/:botId/avatar/:file` — serve processed image
- `DELETE /api/workspaces/:workspaceId/bots/:botId/avatar` — remove avatar

**S3 path**: `avatars/{workspaceId}/bots/{botId}/{timestamp}`

**Files changed**:

- `apps/backend/src/features/workspaces/avatar-service.ts` — add `uploadRawForBot()` and `streamBotAvatarFile()` (or generalize existing methods)
- `apps/backend/src/features/public-api/handlers.ts` — avatar upload/serve/delete handlers
- `apps/backend/src/features/public-api/router.ts` — register avatar routes
- `packages/types/src/domain.ts` — add `getBotAvatarUrl()` helper

### Phase 6: Frontend — Bots tab in workspace settings

Add a "Bots" tab to workspace settings dialog (admin-only), replacing the WorkOS API key widget section.

**Tab contents**:

- **Bot list**: cards showing avatar (emoji or image), name, slug, description, key count, status
- **Create bot dialog**: name, slug (auto-generated from name), description, emoji picker
- **Bot detail panel** (click to expand or navigate):
  - Profile editing: name, slug, description, avatar (emoji selector + image upload)
  - Keys section: list active/revoked keys, create new key (name + scopes + optional expiry), revoke key
  - Archive action with confirmation

**Files changed**:

- `apps/frontend/src/components/workspace-settings/workspace-settings-dialog.tsx` — add "bots" tab, remove WorkOS widget from api-keys tab
- `apps/frontend/src/components/workspace-settings/bots-tab.tsx` (new) — bot list + management UI
- `apps/frontend/src/components/workspace-settings/bot-detail.tsx` (new) — bot profile + key management
- `apps/frontend/src/api/bots.ts` (new) — API client for bot CRUD, key management, avatar upload
- `apps/frontend/src/components/workspace-settings/api-keys-tab.tsx` — remove WorkOS `<ApiKeys>` widget and `WorkspaceApiKeysWidget`, keep only personal keys section

### Phase 7: Frontend — Bot avatar display in messages

Update message rendering to show bot avatar images when available.

**Priority**: `avatarUrl` (image) > `avatarEmoji` (emoji) > initials from name

**Files changed**:

- `apps/frontend/src/components/timeline/message-event.tsx` — render `<AvatarImage>` with `getBotAvatarUrl()` when `avatarUrl` is set
- `apps/frontend/src/hooks/use-actors.ts` — expose `botAvatarUrl` alongside existing bot name/emoji resolution

## Phasing Recommendation

### MVP (ship together)

Phases 1, 2, 3, 4, 6 — bot profiles + self-managed keys + admin UI

This gives:

- Admins create and customize bots (name, slug, description, emoji)
- Self-managed bot keys replace WorkOS API key widget
- Bot profiles are independent of key names
- Soft delete with archive/restore
- Full key lifecycle in native UI

### Follow-up

Phase 5 + 7 — image avatar upload + display

Image upload is more complex (S3, processing, serving) and emoji avatars are a good starting point matching the persona pattern.

### Migration path (WorkOS key deprecation)

1. **Phase A** (with MVP): Both WorkOS keys and bot keys work simultaneously. Auth middleware tries both.
2. **Phase B** (later): Admin UI shows "migrate" action for existing WorkOS-linked bots — generates a native bot key, displays it once, bot continues working.
3. **Phase C** (eventually): Remove WorkOS API key validation from middleware. Remove WorkOS widget dependencies (`@workos-inc/widgets` for API keys, widget token endpoint).

## Dependency Graph

```
Phase 1 (DB migration)
  ├── Phase 2 (Bot key service)
  │     └── Phase 4 (Message flow update)
  ├── Phase 3 (Bot CRUD API)
  │     └── Phase 6 (Frontend bots tab)
  └── Phase 5 (Avatar upload) ── follow-up
        └── Phase 7 (Avatar display) ── follow-up
```

Phases 2 and 3 can be developed in parallel after Phase 1.
Phases 4 and 6 can be developed in parallel after their respective parents.
