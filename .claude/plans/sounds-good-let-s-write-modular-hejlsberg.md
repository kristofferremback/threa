# Threa as an OpenClaw chat provider — implementation plan

## Context

OpenClaw (https://openclaw.ai/, ~100k stars, MIT) is a local agent daemon ("the Gateway") installed on a user's machine via `openclaw onboard --install-daemon`. The Gateway hosts plugins: model providers, tools, skills, and **channels** (chat integrations like Slack, Discord, WhatsApp). Channel plugins are authored against `openclaw/plugin-sdk/channel-core`.

The user wants Threa to be one such channel so they can talk to their personal claw from inside Threa. Because OpenClaw already runs the Gateway daemon on the user's machine, we don't need our own daemon — we ship a plugin that loads into theirs and translates between the OpenClaw plugin contract and Threa's public API.

**Mental model.** Personal claw = a bot owned by one user. The user opens a "scratchpad with claw" (scratchpads are Threa's single-user private streams; this fits "personal claw" better than a DM). Each top-level message in that scratchpad becomes a new conversation; replying on a message opens a child stream in Threa (existing behavior), which OpenClaw treats as a separate threaded conversation. This naturally supports parallel "ask claw about X" sessions inside a single scratchpad.

**MVP scope.** Smallest working loop: poll-based ingest + REST send + scratchpad-only. Socket.io API-key auth (real-time push) and webhook subscriptions are explicit follow-ups.

## Threa-side changes

### 1. Personal bot data model

Bots today (`apps/backend/src/features/public-api/bot-repository.ts`) are admin-created, workspace-shared. Make the bot kind explicit instead of inferring from a nullable owner column, and add a `traits` set so callers (UI, plugin) can filter bots by capability:

- New column `type` (`TEXT`, per INV-3 — no DB enums) with values `"shared"` and `"personal"`. Centralized constant in `packages/types/src/domain.ts` (per INV-33), inferred Zod enum drives validation (per INV-31, INV-55).
- New column `owner_user_id` (`TEXT`, nullable). Server invariant enforced in repo `create()` and any update path: `(type = "personal" AND owner_user_id IS NOT NULL)` OR `(type = "shared" AND owner_user_id IS NULL)`. Reject mismatched shapes with `HttpError` (INV-32).
- New column `traits TEXT[] NOT NULL DEFAULT '{}'` — a set of capability tags. Validated server-side against a known vocabulary (Zod `z.array(z.enum([...]))`). v0 vocabulary is just `"interactive"` (bot can be used as a scratchpad-with-bot conversational partner). Adding new traits later is schema-free; we only ship what we need (INV-36). Trait constants live in `packages/types/src/domain.ts` (INV-33).
- New migration in `apps/backend/src/db/migrations/` following the existing timestamp pattern (e.g. `20260507120000_bots_type_owner_traits.sql`, mirroring `20260505120000_invitation_link_kind.sql`). Use the `add-migration` skill. Append-only (INV-17). Backfill: existing rows get `type = "shared"`, `owner_user_id = NULL`, `traits = '{}'`.
- `BotRow` interface (`bot-repository.ts:4-16`): add `type: BotType`, `owner_user_id: string | null`, `traits: string[]`.
- `mapRowToBot()` (`bot-repository.ts:35`): map to camelCase. Validate the type/owner shape invariant and the trait vocabulary on read so corrupt rows fail loudly (INV-11).
- `create()` (`bot-repository.ts:103`): require `type`, `ownerUserId` (for personal), and accept `traits`. Default `traits = []`. Personal-without-owner, shared-with-owner, or unknown trait values are programmer errors and throw.
- New repo helper `listByOwner(workspaceId, ownerUserId, { traits? })` for the frontend to enumerate the current user's personal bots, optionally filtered by trait. Implemented as a single composable query (INV-27, INV-56).
- `Bot` type in `packages/types/src/domain.ts:284`: discriminated union on `type` with shared `traits` field so callers narrow correctly:

  ```ts
  export type BotTrait = (typeof BOT_TRAITS)[keyof typeof BOT_TRAITS]
  export const BOT_TRAITS = { interactive: "interactive" } as const

  export type Bot =
    | { type: "shared"; ownerUserId: null; traits: BotTrait[]; /* shared fields */ }
    | { type: "personal"; ownerUserId: UserId; traits: BotTrait[]; /* shared fields */ }
  ```

**Why traits on the bot, not on the API key.** The capability ("can be used as an interactive partner") describes the bot's identity, not the credential. A bot's keys rotate; its personality doesn't. If we ever need per-key scoping (e.g. "this key can only read"), that's a separate concern and belongs on the key.

### 2. Authorization rules

In `apps/backend/src/features/public-api/bot-handlers.ts`:

- `createBotSchema` (`bot-handlers.ts:22`): require `type: "shared" | "personal"`. Reject any client-supplied `ownerUserId` (always derived server-side from actor) to prevent spoofing.
- `create()` handler (`bot-handlers.ts:73`): branch on `type`. `type === "shared"` requires admin; `type === "personal"` is allowed for any workspace member and the server pins `ownerUserId = actor.userId`.
- `grantStreamAccess()` (`bot-handlers.ts:427`): allow grant if **(admin AND `bot.type === "shared"`)** OR **(`bot.type === "personal"` AND actor === `bot.ownerUserId` AND owner is a member of the target stream)**. Reuse the existing stream-membership query from `apps/backend/src/features/streams/`.
- Bot key creation/rotation/revocation: branch on `bot.type`. Personal → owner-only; shared → admin-only.

Validation via Zod (INV-55). Errors via `HttpError` (INV-32). No magic strings (INV-33).

### 3. Public API `/me` endpoint

No `/me` exists today (closest is `GET /api/v1/workspaces/:wid/users` at `apps/backend/src/features/public-api/routes.ts:482`). Add:

- `GET /api/v1/workspaces/:wid/me` — returns the authenticated principal as a discriminated union:
  - `{ kind: "user", userId, workspaceId }`
  - `{ kind: "bot", botId, botType: "shared", traits, workspaceId }`
  - `{ kind: "bot", botId, botType: "personal", traits, workspaceId, ownerUserId }`

The plugin calls this once after pairing to verify the key, discover its bot id, and confirm the bot carries the `interactive` trait (so it refuses to attach if the user accidentally uses a non-interactive bot's key).

- `GET /api/v1/workspaces/:wid/me/bots` — for user keys, returns the authenticated user's personal bots (optional `?traits=interactive` filter). Used by the frontend to enumerate quick-switcher commands. For bot keys, returns 403.

### 4. Frontend — "Personal bots" settings

Users can create N personal bots, each with its own name, avatar, and trait set. Settings UI lives in `apps/frontend/src/components/settings/` and is opened via the `useSettings()` dialog (no dedicated route — `apps/frontend/src/routes/index.tsx` has no settings route). Add:

- A "Personal bots" section in the existing settings dialog.
- List of the current user's personal bots: name, avatar, traits (as small tag chips), key count, revoke.
- Create form: name + avatar emoji + traits. v0 surfaces a single "Interactive (show in scratchpad menu)" checkbox bound to the `interactive` trait, defaulted on. Future traits would surface as additional checkboxes without UI restructuring.
- Edit: rename, change avatar, toggle traits.
- "Create key" flow per bot: shows the `threa_bk_*` token exactly once.

Reuse Shadcn primitives (INV-14). UI-only component, business logic via service hooks (INV-15). Component must not be defined inside another component (INV-18).

### 5. "Create scratchpad with <bot>" affordance

Existing flow:
- Hook: `apps/frontend/src/hooks/use-draft-scratchpads.ts:24` (`createDraft()` adds to local IDB).
- Quick-switcher command: `apps/frontend/src/components/quick-switcher/commands.ts:38` ("New Scratchpad").
- Caller: `apps/frontend/src/components/quick-switcher/quick-switcher.tsx:72`.

For each personal bot owned by the current user that carries the `interactive` trait, surface a sibling command "New scratchpad with <Bot Name>" (e.g. "New scratchpad with Clawdius", "New scratchpad with Sebastian"). Each command:
1. Creates the draft scratchpad.
2. On first send (when the stream is materialized backend-side), grants that specific bot access to the resulting stream via `POST /api/v1/workspaces/:wid/bots/:botId/streams/:streamId/grant`.

Source the bot list from the `listByOwner(..., { traits: ["interactive"] })` repo helper, exposed via a new `GET /api/v1/workspaces/:wid/me/bots` endpoint (returns only bots owned by the authenticated user; empty array is the default). Cache via TanStack Query with the standard cache-only observer pattern documented in the `## Frontend Patterns` section of CLAUDE.md.

Zero personal interactive bots → zero commands rendered (the section disappears entirely; no placeholder). Three interactive bots → three commands. The base "New Scratchpad" command stays as today.

## Plugin: `packages/openclaw-channel`

```
packages/openclaw-channel/
  package.json                 # @threa/openclaw-channel
  openclaw.plugin.json         # manifest: channelConfigs.threa, preferOver: []
  src/
    index.ts                   # defineChannelPluginEntry → createChatChannelPlugin
    config.ts                  # baseUrl, apiKey, pollIntervalMs (default 1000)
    client.ts                  # typed REST: GET /me, GET /streams, GET /streams/:id/messages, POST .../messages
    pairing.ts                 # paste-key flow; verifies via /me; persists workspaceId + botId in plugin state
    session.ts                 # resolveSessionConversation(rawId): streamId → conversation; child streams (parentStreamId) → threadId
    poller.ts                  # registerFull background loop; per-stream cursor in plugin state; bot-self filter
    outbound.ts                # sendText / sendMedia → POST /streams/:sid/messages with clientMessageId for idempotency
  README.md                    # install + onboard instructions
```

Key SDK contract pieces (per https://docs.openclaw.ai/plugins/sdk-channel-plugins):

- `threading.topLevelReplyToMode: "reply"` — replying on a top-level claw message creates a child stream in Threa, reported to OpenClaw as a new threaded conversation.
- `security.dm`: scoped allowlist (only the configured workspace; reject everything else).
- `pairing.text`: paste-key flow (verification-code `notify` is optional and not used for v0).
- `messaging.resolveSessionConversation(rawStreamId)`: returns `{ conversationId: streamId, threadId: childStream?.id, parentCandidates: [] }`.

Polling strategy:
- 1s default cadence (configurable).
- `GET /api/v1/workspaces/:wid/streams?type=scratchpad` periodically (cached) to discover scratchpads the bot has access to.
- For each, `GET /streams/:sid/messages?after=<cursor>`. Cursor = last message id or sequence, persisted per stream in plugin state.
- Drop messages where `authorType === "bot" && authorId === <connected botId>` to avoid feedback loops.

Idempotency: outbound sends include `clientMessageId` (existing API field) so retries don't dupe.

## Out of scope (explicit deferrals)

- Socket.io API-key auth / SSE push — follow-up once poll loop is proven.
- Webhook subscriptions for hosted (non-daemon) agents.
- Reactions, message edits, typing indicators, image/file attachments beyond plain text.
- Multi-workspace pairing in a single plugin instance (one workspace per install for v0).

## Critical files to modify

Backend:
- `apps/backend/src/db/migrations/<new>.sql`
- `apps/backend/src/features/public-api/bot-repository.ts`
- `apps/backend/src/features/public-api/bot-handlers.ts`
- `apps/backend/src/features/public-api/routes.ts` (register `/me`)
- `apps/backend/src/features/public-api/handlers.ts` (`/me` handler)
- `packages/types/src/domain.ts`
- `packages/types/src/api-keys.ts` (if scope additions needed)

Frontend:
- `apps/frontend/src/components/settings/` (new "Personal bots" page)
- `apps/frontend/src/components/quick-switcher/commands.ts`
- `apps/frontend/src/hooks/use-draft-scratchpads.ts`

Plugin:
- New package `packages/openclaw-channel/` (full tree above).

## Reused functions/utilities

- `apps/backend/src/features/streams/repository.ts:74-92` — stream type/membership queries for the grant authorization rule.
- `apps/backend/src/middleware/public-api-auth.ts:27-91` — existing auth middleware; `/me` slots in behind it.
- `apps/backend/src/features/public-api/bot-api-key-service.ts` — existing hasher/validation; reused for personal bot keys (no new key infrastructure).
- Public API send: `POST /api/v1/workspaces/:wid/streams/:sid/messages` (`apps/backend/src/features/public-api/handlers.ts:820-894`) — plugin outbound goes here unmodified.

## Verification

End-to-end:
1. `bun run dev` (backend + frontend) locally.
2. Sign in, open Settings → Personal bots → create "claw" → create key → copy.
3. Install OpenClaw locally; `bun link` the plugin (or `bun run build` + local install per OpenClaw plugin docs); run `openclaw onboard threa`; paste base URL + key.
4. Verify plugin log: `GET /me` returned `{ kind: "bot", botType: "personal", traits: ["interactive"], botId, workspaceId, ownerUserId }`.
5. In Threa quick-switcher: confirm "New scratchpad with Clawdius" appears (and not commands for any non-interactive bots). Open it → type a message.
6. Within ~1-3s Clawdius replies inline in the scratchpad.
7. Reply on Clawdius's message → confirm a child stream is created and OpenClaw treats it as a new conversation (subsequent messages in the child route to that thread context, not the scratchpad root).
8. Create a second personal bot "Sebastian" with the `interactive` trait → confirm a second command appears. Create a third without the `interactive` trait → confirm it does NOT appear.
9. Auth check: as another user, attempt to grant the first user's bot to one of *your* scratchpads → expect 403.
10. Feedback-loop check: bot's own messages do not re-trigger the plugin (verify by tailing plugin logs through several replies).

Tests (INV-39 frontend integration, INV-48 spy patterns, INV-22 fix failures):
- `apps/backend/src/features/public-api/__tests__/bot-handlers.test.ts` — new cases: personal bot create by non-admin succeeds; shared bot create by non-admin rejected; grant personal bot by owner to own scratchpad succeeds; grant personal bot by owner to non-owned stream rejected; grant personal bot by non-owner rejected; admin cannot grant a personal bot (only the owner can); creating a bot with an unknown trait is rejected.
- Repository tests: `mapRowToBot` round-trip for both `type` values and trait sets; shape-invariant guard rejects `(personal, null owner)` and `(shared, non-null owner)` rows; `listByOwner` filters correctly by trait.
- `/me` handler tests covering all three principal shapes (user, shared bot, personal bot) including `traits` in the bot responses.
- `/me/bots` handler tests: returns owner's personal bots only; trait filter works; bot keys get 403.

`bun run test` and `bun run test:e2e` must pass before merge.

## Implementation order

1. Migration + `BotRow` + `mapRowToBot` + `listByOwner` + types/constants (backend).
2. `createBotSchema` + `create()` handler authorization + trait validation (backend).
3. `grantStreamAccess()` authorization (backend).
4. `/me` and `/me/bots` endpoints + handlers (backend).
5. Plugin skeleton + manifest + `outbound.sendText` + pairing against `/me` (incl. `interactive` trait check) (plugin).
6. Plugin `poller.ts` + cursor state + bot-self filter (plugin).
7. Personal bots settings UI with trait toggles (frontend).
8. Quick-switcher command enumeration ("New scratchpad with <Bot>") (frontend).
9. E2E walkthrough per Verification section.

Steps 1–4 ship independently of OpenClaw and de-risk the integration. Steps 5–6 prove the loop end-to-end with existing CLI tooling. Steps 7–8 polish the UX.
