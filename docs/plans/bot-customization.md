# Bot Customization Plan

## Problem

Bots are currently a side-effect of API key usage, not a first-class entity:

1. Admin creates a workspace API key (via WorkOS widget)
2. Bot is **auto-created on first message** with the API key's name
3. No UI to manage bot profiles (name, avatar, description)
4. No way to define a bot before it starts sending messages
5. Bot's name is always derived from the API key name — renaming the key renames the bot

The bot is a shadow entity with no independent identity.

## Goal

Make bots first-class workspace entities with rich profiles that admins can customize, similar to how users have profile settings. The API key becomes an **authentication mechanism** for the bot, not the bot's identity source.

## Design Decisions

### D1: Invert the relationship — Bot owns API keys, not the other way around

**Current**: API key → auto-creates bot (1:1 via `unique(workspace_id, api_key_id)`)
**Proposed**: Admin creates a bot → then associates API key(s) to it

This means:

- `bots` table gets `avatar_url` column (like users) alongside existing `avatar_emoji`
- The unique index `idx_bots_workspace_api_key` on `(workspace_id, api_key_id)` remains, but bot creation is decoupled from first message
- Bots can exist without an API key (created but not yet connected)
- Bot name is set independently of API key name

### D2: Bot profile fields (mirroring user profiles)

| Field          | Type            | Notes                                             |
| -------------- | --------------- | ------------------------------------------------- |
| `name`         | `TEXT NOT NULL` | Already exists — display name                     |
| `description`  | `TEXT`          | Already exists — bio/about                        |
| `avatar_emoji` | `TEXT`          | Already exists — emoji avatar                     |
| `avatar_url`   | `TEXT`          | **New** — S3 key base path, same pattern as users |

We keep it focused: name, description, and avatar (emoji OR image). No pronouns/phone/github — those are human-specific. Bots are tools, not people.

### D3: Avatar system reuse

User avatars already have a full pipeline:

- Upload raw image → `avatar_uploads` tracking table → worker processes with sharp → S3 WebP at 256px + 64px
- `AvatarService` handles processing, upload, streaming, deletion
- Frontend: `getAvatarUrl()` constructs serving URL from S3 key base path

For bots, we reuse the same `AvatarService` but with bot-scoped S3 paths:

- Key pattern: `avatars/{workspaceId}/bots/{botId}/{timestamp}` (vs `avatars/{workspaceId}/{userId}/{timestamp}` for users)
- Serving endpoint: `GET /api/workspaces/:workspaceId/bots/:botId/avatar/:file`
- Same processing pipeline (sharp resize → WebP → S3)

### D4: Admin-only management

Bot management is admin/owner-only, consistent with workspace API key management. Add a "Bots" tab to workspace settings dialog, separate from API keys.

### D5: Backwards compatibility for auto-creation

The existing auto-create-on-first-message flow stays, but becomes a fallback:

- If a workspace API key already has a linked bot → use it (no name override)
- If no linked bot exists → auto-create one (current behavior, preserves existing integrations)

This ensures existing integrations don't break while new bots get proper setup flows.

## Implementation Plan

### Phase 1: Database — Add `avatar_url` to bots

**Migration**: `{timestamp}_add_avatar_url_to_bots.sql`

```sql
ALTER TABLE bots ADD COLUMN avatar_url TEXT;
```

Simple column addition. No data backfill needed.

**Files changed**:

- `apps/backend/src/db/migrations/{timestamp}_add_avatar_url_to_bots.sql` (new)
- `apps/backend/src/features/public-api/bot-repository.ts` — add `avatar_url` to `BOT_COLUMNS`, `BotRow`, `Bot` interface, `mapRowToBot`
- `packages/types/src/domain.ts` — add `avatarUrl: string | null` to `Bot` interface

### Phase 2: Bot CRUD API endpoints

Add bot management endpoints to the backend. These are workspace-scoped, admin-only.

**New endpoints**:

- `GET /api/workspaces/:workspaceId/bots` — list bots (already fetchable via bootstrap, but explicit endpoint)
- `PATCH /api/workspaces/:workspaceId/bots/:botId` — update bot profile (name, description, avatarEmoji)
- `POST /api/workspaces/:workspaceId/bots` — create a bot (without API key association)
- `DELETE /api/workspaces/:workspaceId/bots/:botId` — delete a bot (soft? hard? — TBD, likely soft via archive)

**Bot update schema** (Zod):

```ts
const updateBotSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  avatarEmoji: z.string().emoji().optional().nullable(),
})
```

**Files changed**:

- `apps/backend/src/features/public-api/bot-repository.ts` — add `update()`, `create()` methods
- `apps/backend/src/features/public-api/handlers.ts` — add handler factories for new endpoints
- `apps/backend/src/features/public-api/router.ts` — register new routes
- Outbox events: `bot:created`, `bot:updated` already exist and can be reused

### Phase 3: Bot avatar upload

Reuse the user avatar pipeline with bot-scoped paths.

**New endpoint**: `POST /api/workspaces/:workspaceId/bots/:botId/avatar`

- Accepts multipart image upload
- Validates file type/size (same constraints as user avatars)
- Uses `AvatarService.uploadRaw()` with bot-scoped key pattern
- Queues processing via existing avatar worker (or processes inline if simpler)
- Updates `bots.avatar_url` with the S3 key base path

**New endpoint**: `GET /api/workspaces/:workspaceId/bots/:botId/avatar/:file`

- Serves processed avatar WebP files from S3
- Same streaming pattern as user avatar serving

**New endpoint**: `DELETE /api/workspaces/:workspaceId/bots/:botId/avatar`

- Removes avatar files from S3
- Sets `bots.avatar_url = NULL`

**Files changed**:

- `apps/backend/src/features/workspaces/avatar-service.ts` — generalize path helpers or add bot variants
- `apps/backend/src/features/public-api/handlers.ts` — avatar upload/serve/delete handlers
- `apps/backend/src/features/public-api/router.ts` — register avatar routes
- `packages/types/src/domain.ts` — add `getBotAvatarUrl()` helper (mirrors `getAvatarUrl()`)

### Phase 4: Update auto-creation to not override bot profiles

**Current behavior**: On every message send, bot name is overwritten with API key name.
**New behavior**: If bot already exists, don't touch the name (it was set by admin).

Change the upsert in `handlers.ts` (message creation flow):

- If bot exists for this API key → use as-is, no name update
- If bot doesn't exist → create with API key name as default (backwards compat)

**Files changed**:

- `apps/backend/src/features/public-api/handlers.ts` — change upsert to insert-only (no name override on conflict)
- `apps/backend/src/features/public-api/bot-repository.ts` — add `findOrCreate()` that only inserts, never updates name

### Phase 5: Frontend — Bots tab in workspace settings

Add a "Bots" tab to the workspace settings dialog (admin-only).

**New tab contents**:

- List of existing bots with avatar, name, description
- Click bot → edit panel (inline or modal) with:
  - Avatar picker (emoji selector OR image upload)
  - Name input
  - Description textarea
  - Connected API key display (read-only reference)
- "Create bot" button → creates a standalone bot entity
- Delete/archive action

**Files changed**:

- `apps/frontend/src/components/workspace-settings/workspace-settings-dialog.tsx` — add "bots" tab (admin-only, conditionally rendered like the bot keys section)
- `apps/frontend/src/components/workspace-settings/bots-tab.tsx` (new) — bot management UI
- `apps/frontend/src/api/bots.ts` (new, or extend existing) — API client for bot CRUD + avatar upload
- `apps/frontend/src/hooks/use-actors.ts` — update to use `avatarUrl` when available, fall back to `avatarEmoji`

### Phase 6: Frontend — Bot avatar display in messages

Update the message rendering to show bot avatar images when available.

**Files changed**:

- `apps/frontend/src/components/timeline/message-event.tsx` — for bot messages, render `<img>` with `getBotAvatarUrl()` when `avatarUrl` is set, else fall back to emoji/initials

## Phasing recommendation

**Ship together (MVP)**: Phases 1-2 + 4 + 5 (basic bot profiles without image avatars)

- This gives admins the ability to create/edit bots with name, description, emoji avatar
- Decouples bot identity from API key name
- Adds the Bots tab to workspace settings

**Follow-up**: Phases 3 + 6 (image avatars)

- Image upload is more complex (S3, processing pipeline, serving endpoint)
- Emoji avatars are a good starting point and match the existing persona pattern

## Open questions

1. **Bot deletion**: Soft delete (archive) or hard delete? Archived bots' messages should still show the bot name. Recommend: add `archived_at` column, filter from lists but keep for message display.
2. **Bot creation without API key**: Should bots always require an API key association, or can they exist standalone (for future "create bot → then generate key" flow)? Recommend: allow standalone initially, associate key later.
3. **API key ↔ bot association UI**: Should the "Bot keys" WorkOS widget show which bot each key is connected to? This might require custom UI replacing the WorkOS widget. Could be a follow-up.
4. **Bot-to-bot uniqueness**: Should bot names be unique within a workspace? Recommend: no, like user names.
