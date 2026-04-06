# Richer, grouped OSV push notifications

## Context

Threa's push notifications currently show a single "last message" preview per stream with no author attribution. When multiple messages arrive from the same stream, the service worker replaces the notification with a generic `"N new messages in #stream"` title and only the most recent preview as the body — older messages are lost. Users can't peek multiple messages without opening the app.

We want push notifications to:

1. Show the **author's name** alongside each message preview.
2. Group multiple messages per stream so the user can **peek several recent messages** by expanding the native OS notification, effectively one expandable entry per stream.

### How expansion works (what the user is asking for)

The Web Notifications API does not expose a first-class "expand/collapse" primitive, but OS notification centers already provide that affordance for us as long as the notification's `body` contains enough content to expand:

- **Chromium (desktop Chrome/Edge, Android):** bodies containing `\n` render as multiple lines. When the body exceeds the collapsed height, the user gets a chevron/"…"/hover to expand — exactly the "open the notification for more" behavior the user wants. No extra API calls needed.
- **Firefox desktop:** renders the full multi-line body.
- **iOS Safari / macOS Safari:** collapses to a short preview, but grouped-by-app expansion in Notification Center still reveals the full body. First line should still read well standalone ("Alice: hey team") for devices that clip.

We lean on this natively by packing up to 5 recent `{author, preview}` lines into `body` separated by `\n`. Every modern platform gives the user a way to expand to see them all; no custom UI or second-tier "notification feed" is required inside the OS chrome.

The mechanism for keeping the list is: accumulate a small history of `{author, preview}` entries in the notification's `data` payload, then rewrite the single notification's `body` to a multi-line list whenever a new message in that stream arrives (using the existing `tag = streamId` replacement).

## Decisions (from user)

- **Peek depth:** up to **5** most recent messages per grouped notification.
- **Per-line format:** `"{authorName}: {contentPreview}"`, one message per line, separated by `\n`. The OS handles expand/collapse natively.
- **Mentions stay visually distinct:** mention notifications use a separate tag (`${streamId}:mention`) so they don't get blended into the regular stream group and keep their urgency.

## Approach

### Backend — include author name in activity context

**File:** `apps/backend/src/features/activity/service.ts`

`ActivityService.processMessageMentions` and `processMessageNotifications` both build a `context: { contentPreview, ...streamContext }` and batch-insert activities. Extend both to also include `authorName` resolved once per call:

- Resolve `authorName` once per call based on `actorType` — all types use DB lookups:
  - `"user"` → `UserRepository.findById(client, workspaceId, actorId)` → `user.name` (already imported at service.ts:3).
  - `"bot"` → `BotRepository.findById(client, actorId)` → `bot.name` (exported from `features/public-api`).
  - `"persona"` → `PersonaRepository.findById(client, actorId)` → `persona.name` (exported from `features/agents`).
  - `"system"` → `"Threa"` (no entity to look up — static fallback).
- Add a private `resolveAuthorName(client, workspaceId, actorId, actorType)` method to `ActivityService`.
- Add `authorName` to `context` alongside `contentPreview`.
- Write a minimal unit/integration test asserting the stored activity's `context.authorName` matches the actor.

Rationale: resolved once per `processMessage*` call (one message → many recipients → many activity rows), so it's cheaper than resolving inside the push delivery path. All downstream consumers of `activity.context` (not just push) can render the author.

**Files touched:**
- `apps/backend/src/features/activity/service.ts` (resolve name, extend context)
- `apps/backend/src/features/activity/service.test.ts` (or the nearest existing test file — add coverage)

### Backend — propagate into push payload

**File:** `apps/backend/src/features/push/service.ts:190-200`

Extend the `context` cast and the `pushPayload.data` object with `authorName`. No DB work — it's already in `activity.context`.

```ts
const context = activity.context as {
  contentPreview?: string
  streamName?: string
  authorName?: string
} | null | undefined

// ...include authorName in pushPayload.data
```

Web Push encrypted payload budget is ~2–4KB; `authorName` plus the new multi-entry grouping on the SW side stays well within limits (we only ship the new message, not the full history — the SW accumulates).

### Service worker — accumulate a per-stream message list

**File:** `apps/frontend/src/sw.ts:237-357`

Current behavior (sw.ts:313-343) already tags by `streamId` and tracks `messageCount`. Replace the count-only accumulation with a short rolling list of recent messages held on the existing notification's `data`.

1. **Extend `PushData`** (sw.ts:238):
   ```ts
   interface PushData {
     // ...existing fields
     authorName?: string
     /** Rolling history accumulated by the SW across repeated pushes for the same stream. */
     messages?: Array<{ authorName?: string; contentPreview?: string }>
   }
   ```

2. **Accumulate on push** (sw.ts:322-330): read `existing[0]?.data.messages ?? []`, append the new `{ authorName, contentPreview }`, and cap at the last **5** entries (oldest dropped). The total message count for the title becomes `messages.length` (no separate `messageCount` needed — derive from the array).

3. **Tag selection** — split mentions from regular messages so mentions stay visually distinct:
   - Regular message activity → `tag = streamId`.
   - Mention activity → `tag = ${streamId}:mention`.
   Each tag accumulates its own `messages[]` list independently.

4. **Title formatting** — keep stream-centric framing:
   - 1 message: `"#general"` (or DM partner name) as title, body = `"Alice: hey team"`.
   - 2+ messages: `"#general · 3 new messages"` as title; body = newline-joined list of `"{author}: {preview}"`. For message notifications without a stream name, fall back to `"3 new messages"`.
   - Mentions keep a distinct title prefix so they remain visually urgent: `"Mentioned in #general"` (1) / `"3 new mentions in #general"` (2+).

5. **Body formatting** — a helper `formatGroupedBody(messages)` that renders up to 5 lines of `"{authorName}: {contentPreview}"`, truncating each preview to ~80 chars so the whole body stays under the practical OS-notification limit (~300–400 chars). `authorName` is always set by the backend (user name, "Assistant", or "Threa") so no client-side fallback is needed. Chromium desktop/Android renders the `\n`s as multi-line and gives the user a native expand affordance; iOS collapses on the lock screen but the first line still reads as `"Alice: hey"` and the full body is visible when the notification is expanded in Notification Center.

6. **Persist the list** in `options.data.messages` so the next push can read it back. Drop the now-redundant `messageCount` field (derive count from `messages.length`).

7. **Clear path unchanged** (`action: "clear"`, stream-read → `getNotifications({ tag })` → `close()`). One subtle update: when clearing, fetch notifications for **both** `streamId` and `${streamId}:mention` so reading a stream dismisses the mention group too. Resetting the group happens naturally when the OS notification is dismissed.

**File touched:** `apps/frontend/src/sw.ts`

### Service worker tests

`tests/browser/push-notification-settings.spec.ts` is an E2E stub for VAPID/settings UI, not push rendering. Add a small unit-style test for the pure helpers (`formatGroupedBody`, title selection) by extracting them into a testable module (e.g. `apps/frontend/src/lib/sw-notification-format.ts`) imported by `sw.ts`. This keeps the SW side-effect-free testable surface.

**New file:** `apps/frontend/src/lib/sw-notification-format.ts`
**New file:** `apps/frontend/src/lib/sw-notification-format.test.ts`

## Data flow (end-to-end)

1. User sends a message → `MessageService` invokes `ActivityService.processMessageMentions`/`processMessageNotifications`.
2. Activity service resolves `authorName` once, writes it into each activity's `context`.
3. Outbox dispatcher delivers `activity:created` → `PushService.deliverPushForActivity` → encrypted push to each subscribed device with `{ streamId, streamName, authorName, contentPreview, activityType, messageId }`.
4. SW receives push, picks tag (`streamId` for messages, `${streamId}:mention` for mentions), finds the existing notification for that tag, reads `data.messages`, appends the new entry (cap 5), rewrites title + multi-line body, calls `showNotification` with the same tag and `renotify: true`.
5. User taps → existing `notificationclick` handler opens the stream (no change needed); OS notification center handles expand/collapse natively — the user "opens the notification for more" by tapping the expand chevron on Android/Chromium or pulling down the stack on iOS.
6. User reads stream on another device → backend `deliverClearForStreams` → SW closes **both** the `streamId` and `${streamId}:mention` notifications → list resets.

## Critical files

- `apps/backend/src/features/activity/service.ts` — add author name to `context` in both `processMessage*` methods.
- `apps/backend/src/features/push/service.ts:190-200` — pass `authorName` through `pushPayload.data`.
- `apps/frontend/src/sw.ts:237-357` — extend `PushData`, accumulate rolling message list, rewrite title/body, drop `messageCount`.
- `apps/frontend/src/lib/sw-notification-format.ts` (new) — extracted pure helpers.
- `apps/frontend/src/lib/sw-notification-format.test.ts` (new) — unit tests for format helpers.
- `apps/backend/src/features/activity/` tests — assert `authorName` in stored activity context.

## Reused utilities

- `UserRepository.findById` (`apps/backend/src/features/workspaces/user-repository.ts:106`) — single name lookup at activity creation time.
- `resolveStreamContext` (`apps/backend/src/features/activity/service.ts:268`) — keep as is; author name is parallel to stream name.
- Existing SW tag/clear infrastructure (`sw.ts:289-293`, `sw.ts:401-411`) — no changes needed.

## Verification

1. **Unit tests:** `bun run test` — confirm new `sw-notification-format.test.ts` passes and activity service test asserts `context.authorName`.
2. **Manual push flow:**
   - Run backend + frontend locally, subscribe a browser tab to push.
   - As user B, send three messages in quick succession to a stream user A is subscribed to while A's tab is unfocused.
   - On A's device, verify the notification shows:
     - Title: `"#streamname · 3 new messages"`.
     - Body: three lines, each `"B: <preview>"`.
   - Tap the notification → opens the stream (unchanged behavior).
3. **Cross-device clear:** Read the stream on a second device; confirm the grouped notification disappears on the first device.
4. **Edge cases to manually verify:**
   - Bot author → shows `"BotName: <preview>"`. Persona → `"PersonaName: <preview>"`. System → `"Threa: <preview>"`.
   - Mention + message mix → mentions appear as a **separate** notification entry (distinct tag) alongside the regular stream group, both expandable.
   - Expansion: on desktop Chrome and Android Chrome, verify the chevron/"…" reveals all 5 lines when the body is long.
   - More than 5 messages → only the 5 most recent appear; title count still reflects real arrivals (bounded by SW state, which is fine since the user has already been notified).
5. **E2E:** `bun run test:e2e` — confirm no regression in `tests/browser/push-notification-settings.spec.ts`.
