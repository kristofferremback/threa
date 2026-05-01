# Plan: Scheduled Message Sending

## Core principle: always progress the schedule, never sidestep it

"Send now" updates `scheduledAt` to `now` instead of calling send + cancel separately. This eliminates any double-send risk near the deadline or when offline. The server already clamps past times to `NOW()`, so the same mechanism handles it.

## Backend

| Endpoint |
|---|
| `POST /api/workspaces/:wid/scheduled-messages` | Schedule |
| `GET /api/workspaces/:wid/scheduled-messages?streamId=` | List pending |
| `PATCH /:id` | Edit content and/or `scheduledAt` |
| `DELETE /:id` | Cancel |

**Fire time resolution:**
- `stream_id` set → send there
- `parent_message_id` set → look up `thread_id`; found → use it; **not found → create thread**, send as first reply

**Server optimization**: when `scheduledAt <= NOW()`, call `eventService.createMessage()` directly in the handler transaction instead of going through the queue. This removes latency for the "send now" and offline-time-passed paths.

**Socket events** (workspace-scoped, `ws:{wid}`): `scheduled_message:created/updated/cancelled/fired`

**Migration**: `scheduled_messages` table, no FKs, `TEXT` only (INV-1, INV-3), workspace-scoped (INV-8). `QUEUE_NAME = "scheduled_message.fire"`, LIGHT tier.

## Frontend State

**IDB v27 — `scheduledMessages`**:
```
id, workspaceId, authorId, streamId | null, parentMessageId | null, parentStreamId | null
contentJson, contentMarkdown, attachmentIds[]
scheduledAt, sentAt | null, cancelledAt | null, createdAt, updatedAt
streamDisplayName | null
_status: "pending-sync" | "synced"
_scheduledAtMs (numeric mirror), _cachedAt
```
Indexes: `[workspaceId+_scheduledAtMs]`, `[workspaceId+streamId+_scheduledAtMs]`, `[workspaceId+_status]`

**Bootstrap hook** `useScheduledList()` — subscribe-then-bootstrap

**Socket handlers** (registered in `workspace-sync.ts`):
- `scheduled_message:created` → update row with server ID, `_status: "synced"`
- `scheduled_message:updated` → update content/time
- `scheduled_message:cancelled` / `fired` → delete from IDB
- `stream:created` → if `parentMessageId` matches any row's `parentMessageId`, update that row's `streamId` (thread conversion)

**Dispatch hook** `useScheduledDispatch()` — on connect drains `_status === "pending-sync"` rows, Web Locks, retry with exponential backoff

**Mutation hooks**: `useMutation` for schedule/edit/cancel

## Frontend UI

**Split-button send button** (reuses `GroupedItem` pattern):
- Desktop: left = normal send, right chevron = scheduling presets sub-menu
- Mobile: long-press → bottom sheet with presets
- Presets: 15m, 1h, 3h, tomorrow 9am, next Mon 9am, custom

**Shared scheduling component** extracted from `reminder-*` into `components/scheduling/`

**Scheduled messages page** `/w/:workspaceId/scheduled`

**Scheduled messages popover** in composer toolbar

**Composer Edit Mode** — typing persists to IDB, send button PATCH-es, "Send now" patches scheduledAt to now

## Files

**Backend**: `apps/backend/src/features/scheduled-messages/` (6 new) + modify `queue/job-queue.ts`, `id.ts`, `server.ts`, `routes.ts` + migration

**Types**: modify `packages/types/src/{domain,api}.ts`

**Frontend state**: `api/scheduled-messages.ts`, `hooks/use-scheduled.ts` (list + dispatch + mutations), modify `db/database.ts` (v27), `sync/workspace-sync.ts`, `sync/sync-engine.ts`

**Frontend UI**: `lib/schedule-presets.ts`, `components/scheduling/{presets,custom-picker}.tsx`, `pages/scheduled.tsx`, `components/composer/scheduled-picker.tsx`, modify `routes/index.tsx`, `message-composer.tsx`, `message-input.tsx`, `reminder-popover-content.tsx`, `reminder-picker-sheet.tsx`
