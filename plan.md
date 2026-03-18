# Infinite Scroll for Messages

## Problem

Streams only load the most recent 50 events. There's no way to see older messages, and search-to-message navigation only works if the target is in the initial 50. Pull-to-refresh also conflicts with upward scrolling in streams.

## Key Findings

- **Backend** only supports forward pagination (`afterSequence` → events with `sequence > X`). No backward pagination exists.
- **Frontend `streamsApi.getEvents`** maps `before` → backend `after` param, which is semantically wrong — it fetches events AFTER a sequence, not before. Current infinite scroll is wired up but broken.
- **Bootstrap** returns the latest 50 events and `latestSequence`, but no indicator of whether older events exist.
- **Pull-to-refresh** is enabled on mobile globally. It conflicts with upward scrolling in streams since both trigger at scrollTop ≈ 0.
- **Thread panel** renders `StreamContent` which uses the same `useEvents` hook.

## Design Decisions

1. **No virtual scroll** — preserve native browser search (Cmd+F)
2. **Configurable trigger point** — fetch next page after scrolling past half the page size (25 of 50 messages)
3. **Bidirectional pagination** — needed for jump-to-message: load a window around the target, then paginate both directions
4. **Thread panel** loads all messages (no pagination) — threads are typically small
5. **Disable pull-to-refresh inside stream scroll containers** — streams get infinite scroll instead

## Implementation Plan

### Phase 1: Backend — Add backward pagination + surrounding context

**1.1 Add `beforeSequence` to event repository** (`apps/backend/src/features/streams/event-repository.ts`)
- Add `beforeSequence?: bigint` to `list()` filters
- When present: `WHERE sequence < $X ORDER BY sequence DESC LIMIT N`, then reverse
- `afterSequence` and `beforeSequence` are mutually exclusive

**1.2 Add `before` query param to events handler** (`apps/backend/src/features/streams/handlers.ts`)
- Accept `before` query param alongside existing `after`
- Map to `beforeSequence` in repository call

**1.3 Add `hasOlderEvents` to bootstrap response**
- After fetching the 50 events, check if there are events with lower sequence than the oldest returned
- Add `hasOlderEvents: boolean` to `StreamBootstrap` type
- This tells the frontend whether to enable infinite scroll at all

**1.4 Add "events around message" endpoint** (for jump-to-message)
- New handler: `GET /streams/:streamId/events/around?eventId=X&limit=50`
- Uses event repository to find the target event's sequence, then fetches N/2 before and N/2 after
- Returns `{ events, hasOlder, hasNewer }` so the frontend knows pagination state

### Phase 2: Frontend — Fix pagination + bidirectional scroll

**2.1 Fix `streamsApi.getEvents`** (`apps/frontend/src/api/streams.ts`)
- Support both `before` and `after` params properly (separate query params)
- Add `getEventsAround(workspaceId, streamId, eventId, limit)` for jump-to-message

**2.2 Update shared types** (`packages/types/`)
- Add `hasOlderEvents` to `StreamBootstrap`
- Add response type for "events around"

**2.3 Extract pagination constant**
- Create `apps/frontend/src/lib/constants.ts` with `EVENT_PAGE_SIZE = 50`
- Use in `use-events.ts` and scroll trigger calculation

**2.4 Refactor `use-events.ts`** — bidirectional pagination
- **Older events**: Fix infinite query to use `before` param correctly
- **Newer events**: Add second infinite query (or extend existing) for forward pagination from a jump point
- **Normal mode** (latest messages): only backward pagination enabled, `hasOlderEvents` from bootstrap gates it
- **Jump-to mode** (from search): load events around target, enable both directions
- Expose `fetchNewerEvents`, `hasNewerEvents`, `isFetchingNewer` alongside existing older equivalents

**2.5 Update `use-scroll-behavior.ts`** — message-count-based trigger
- Replace pixel-based `topThreshold` with message-count-based approach
- New option: `triggerAfterItems: number` (default: `EVENT_PAGE_SIZE / 2 = 25`)
- Calculate trigger based on average item height × triggerAfterItems, or use an intersection observer on the Nth item from the edge
- Add `onScrollNearBottom` callback for forward pagination (jump-to mode)
- Simpler approach: use a sentinel element at position N from edge, observed via IntersectionObserver

**2.6 Update `StreamContent`** for bidirectional scroll
- Pass both `fetchOlderEvents` and `fetchNewerEvents` to scroll behavior
- When in jump-to mode and user scrolls to newest, transition back to normal mode (live tail)
- Show loading indicators at both top and bottom when fetching

### Phase 3: Jump-to-message from search

**3.1 Update `StreamContent` highlight flow**
- When `highlightMessageId` is set and the message isn't in current events, enter jump-to mode
- Call `getEventsAround` to load context around the target message
- Replace the current event set with the surrounding window
- Enable bidirectional pagination from that point

**3.2 Scroll to highlighted message**
- After events load around target, scroll the highlighted message into view
- Apply existing highlight animation

### Phase 4: Thread panel — load all messages

**4.1 Skip pagination in thread panel**
- In `StreamContent`, detect if the stream is a thread
- For threads: set a high limit (or no limit) on bootstrap, skip infinite scroll hooks
- Alternatively: auto-fetch all older events on mount if `hasOlderEvents` is true for threads

### Phase 5: Disable pull-to-refresh in streams

**5.1 Suppress pull-to-refresh when stream scroll container is active**
- The pull-to-refresh hook in `app-shell.tsx` checks `scrollEl.scrollTop > 1` to yield to scrollable children
- But infinite scroll loads when `scrollTop < threshold`, creating a race
- Solution: add `overscroll-behavior-y: contain` on the stream scroll container (already present: `overscroll-y-contain`)
- If that's not enough, propagate a context flag from stream views to disable pull-to-refresh when a stream is mounted
- The stream container already has `overscroll-y-contain` class — verify this prevents pull-to-refresh from activating when scrolling up inside streams

## File Change Summary

| File | Change |
|------|--------|
| `apps/backend/src/features/streams/event-repository.ts` | Add `beforeSequence`, events-around query |
| `apps/backend/src/features/streams/handlers.ts` | Add `before` param, events-around handler, `hasOlderEvents` in bootstrap |
| `apps/backend/src/features/streams/event-service.ts` | Pass through new params |
| `apps/backend/src/routes.ts` | Register events-around route |
| `packages/types/src/domain.ts` | Update `StreamBootstrap`, add `EventsAroundResponse` |
| `apps/frontend/src/api/streams.ts` | Fix `getEvents`, add `getEventsAround` |
| `apps/frontend/src/lib/constants.ts` | New: `EVENT_PAGE_SIZE` |
| `apps/frontend/src/hooks/use-events.ts` | Bidirectional pagination, jump-to mode |
| `apps/frontend/src/hooks/use-scroll-behavior.ts` | Message-count trigger, bidirectional |
| `apps/frontend/src/components/timeline/stream-content.tsx` | Wire up bidirectional scroll, jump-to-message |
| `apps/frontend/src/components/layout/app-shell.tsx` | Disable pull-to-refresh in streams |

## Open Questions

1. Should the thread panel literally fetch ALL messages in one request, or auto-paginate on mount? (Propose: auto-paginate on mount — keeps consistent API, handles very long threads)
2. When jumping to an old message, should we show a "Jump to latest" floating button? (Propose: yes, shown when not at bottom in jump-to mode)
