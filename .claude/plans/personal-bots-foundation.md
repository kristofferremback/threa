# Personal Bots Foundation

## Goal

Build the backend foundation for personal bots — bots owned by individual users rather than shared workspace-wide. This enables users to create their own bots (e.g. OpenClaw, Hermes, NanoClaw) and manage them, laying the groundwork for conversational interaction with personal bots via scratchpads (follow-up PR).

## What Was Built

### 1. Bot data model — type/owner/traits

Bots today are admin-created, workspace-shared. This PR adds a `type` discriminator (`"shared"` vs `"personal"`), optional `owner_user_id`, and a `traits` capability set.

**Files:**
- `packages/types/src/constants.ts` — Add `BOT_TYPES`, `BotTypes`, `BOT_TRAITS`, `BotTraits` constants
- `packages/types/src/domain.ts` — Make `Bot` a discriminated union on `type` so callers can narrow to `"shared"` (ownerUserId null) vs `"personal"` (ownerUserId string)
- `packages/types/src/index.ts` — Export new types
- `apps/backend/src/db/migrations/20260507182654_bots_type_owner_traits.sql` — Add columns, partial index, backfill existing rows as shared
- `apps/backend/src/features/public-api/bot-repository.ts` — `BotRow` + `Bot` type extended; shape invariant enforced on read/write; `findById`/`findByIds` now workspace-scoped; `listByOwner` helper with trait filtering; `listVisibleTo` returns shared bots + caller's personal bots

### 2. Authorization — permission gates + ownership checks

Route-level gates use the existing `requireWorkspacePermission` with `BOTS_CREATE_PERSONAL` / `BOTS_CREATE_SHARED` / `BOTS_MANAGE` slugs. Handler-level ownership checks for personal bots operate inside route handlers after the permission gate.

**Files:**
- `apps/backend/src/routes.ts` — Personal bot create gated on `BOTS_CREATE_PERSONAL`; personal bot management at handler level (owner can manage own personal bots without `BOTS_MANAGE`)
- `apps/backend/src/features/public-api/bot-handlers.ts` — `authorizeBotManagement` helper: personal bots require owner match (no permission check needed since route gate fires first); update/grant/archive paths check ownership
- `apps/backend/src/features/workspaces/handlers.ts` — Bootstrap `listVisibleTo` returns shared bots + the caller's personal bots (not all users' personal bots)

### 3. Identity endpoints — `/me` and `/me/bots`

- `GET /api/v1/workspaces/:wid/me` — Returns the authenticated principal as a discriminated union (user, shared bot, personal bot)
- `GET /api/v1/workspaces/:wid/me/bots` — For user keys, returns the current user's personal bots with optional `?traits=` filter. Bot keys get 403.

**Files:**
- `apps/backend/src/features/public-api/handlers.ts` — `getMe` + `listMyBots` handlers
- `apps/backend/src/features/public-api/routes.ts` — Wire schemas + route registration
- `apps/backend/src/features/public-api/schemas.ts` — `listMyBotsSchema`
- `apps/backend/src/routes.ts` — Register under public middleware

### 4. Stream service — transaction-compatible bot grant

Extract `addBotToStreamOn` and `isMemberOn` from their parent methods so callers can compose them into an outer transaction (needed for personal-bot owner membership checks + grant in one atomic operation).

**Files:**
- `apps/backend/src/features/streams/service.ts` — `addBotToStreamOn(client, ...)`, `isMemberOn(db, ...)`

### 5. Fixes for existing code

- `apps/backend/src/features/activity/service.ts` + test — Scope bot lookups by workspace
- `apps/backend/tests/e2e/public-api-*.test.ts` — Add `type: "shared"` to bot creation fixtures

## Design Decisions

### Permission-aware route gating

Personal bots use `BOTS_CREATE_PERSONAL` permission (already in the catalog). By default all members have this permission, but enterprise workspaces can revoke it via WorkOS. Creation at handler level derives owner from the authenticated actor (never from request body).

### Management ownership, not permission

A personal bot's owner manages it (update, archive, keys, grants) by virtue of ownership, not via `BOTS_MANAGE`. The route gate for shared-bot management (`BOTS_MANAGE`) stays; the personal-bot management paths check ownership at handler level and skip the permission gate. This means an owner can manage their bot even after `BOTS_MANAGE` is revoked, which is correct — they own the bot.

### Grant delegate through `addBotToStream`

The `grantStreamAccess` handler delegates to `streamService.addBotToStream` (via `addBotToStreamOn`) so the `member_added` event and `stream:member_added` outbox message fire correctly. The PR's earlier approach of calling `BotChannelAccessRepository.grantAccess` directly missed this — real-time clients would never see bot grants. Now they do.

### Transaction-safe membership check

`isMemberOn(db, ...)` lets the personal-bot grant path check owner membership inside the same transaction that locks bot and stream rows (`FOR UPDATE`), preventing TOCTOU races.

### Bootstrap includes only the actor's personal bots

`BotRepository.listVisibleTo` returns `type = 'shared' OR (type = 'personal' AND owner_user_id = $userId)` so user B never sees user A's personal bots in the bootstrap payload.

## Schema Changes

- `apps/backend/src/db/migrations/20260507182654_bots_type_owner_traits.sql`:
  - `ALTER TABLE bots ADD COLUMN type TEXT NOT NULL DEFAULT 'shared'`
  - `ALTER TABLE bots ADD COLUMN owner_user_id TEXT`
  - `ALTER TABLE bots ADD COLUMN traits TEXT[] NOT NULL DEFAULT '{}'`
  - `CREATE INDEX idx_bots_workspace_owner ON bots (workspace_id, owner_user_id) WHERE owner_user_id IS NOT NULL`
  - No DB enums (INV-3), shape invariant enforced in application code

## What's NOT Included

- Frontend personal-bots settings UI (follow-up)
- Quick-switcher "New scratchpad with <Bot>" commands (follow-up)
- OpenClaw channel plugin (follow-up)
- Socket.io push / SSE for real-time bot messages (deferred)
- Actual conversational interaction with personal bots (follow-up)

## Status

- [x] Bot data model: types, migration, repository, invariants
- [x] Authz: permission gates + ownership checks at handler level
- [x] Identity endpoints: `/me` and `/me/bots`
- [x] Stream service: transaction-compatible `addBotToStreamOn` / `isMemberOn`
- [x] Fix existing callsites (activity service, e2e tests, bootstrap)
- [ ] Administrative UI: personal bot creation in settings (frontend)
