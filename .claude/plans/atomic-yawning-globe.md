# Fix: mobile composer sometimes hidden until app restart

## Context

On mobile, the message composer sometimes fails to render and only comes back
after the user restarts or switches apps (which fires `visibilitychange`).

The real culprit isn't the system-channel guard — that one is
static (`stream?.type === StreamTypes.SYSTEM` → show a read-only banner) and
can't leak. The sticky flag is `InlineEditContext.isEditingInline`.

How it works today:

- `apps/frontend/src/components/timeline/inline-edit-context.tsx` exposes
  `isEditingInline` / `setEditingInline`. On mobile, `MessageInput` reads it
  and applies `hidden`:
  `const hideForInlineEdit = isMobile && !!inlineEdit?.isEditingInline`
  (`apps/frontend/src/components/timeline/message-input.tsx:201`,
  usage at `:403`).
- `MessageEventCard` is responsible for flipping the flag imperatively:
  `startEditing` calls `setEditingInline(true)`
  (`apps/frontend/src/components/timeline/message-event.tsx:333`);
  `stopEditing` and a cleanup effect call `setEditingInline(false)`
  (`:342`, `:352`).
- Mount-time safeties: `InlineEditProvider` resets on stream change
  (`resetKey={streamId}`, `inline-edit-context.tsx:26-28`) and on
  `visibilitychange` (`:35-43`).

Why it gets stuck: the "am I inline-editing?" state lives in the ancestor
context, but the edit UI lifecycle lives in `MessageEditForm` (a child of
`MessageEventCard`). Any path that tears down the edit UI without flowing
through `stopEditing` or the MessageEventCard unmount path leaves the flag
true. Known fragile paths:

- `MessageEditForm` mobile drawer uses `onOpenChange={(open) => { if (!open)
  setTimeout(onCancel, 300) }}`
  (`apps/frontend/src/components/timeline/message-edit-form.tsx:173-175`).
  If the component unmounts (virtualization, navigation, save completes)
  before the timeout fires, the timeout runs against a stale closure while
  a *different* edit may already be active — races are possible.
- Rapid edit-A → cancel → edit-B within 300 ms lets the delayed `onCancel`
  from A clear (or fail to clear) the shared context flag at the wrong time.
- Any future caller that forgets to pair `setEditingInline(true)` with a
  `false` in every cleanup path silently breaks the composer. The current
  API invites that mistake.

The existing `visibilitychange` and `resetKey` resets exist specifically
because this flag has leaked before. They're band-aids over a fundamentally
leaky API.

## Approach

Make the flag impossible to leak by deriving it from the presence of
mounted inline-edit UIs rather than from imperative setter calls. Use a
ref-count registered from `MessageEditForm` itself via `useEffect` +
cleanup, which cannot desynchronise from component lifecycle.

### Changes

1. **`apps/frontend/src/components/timeline/inline-edit-context.tsx`**
   - Replace the boolean + setter API with a registration API.
   - New context value: `{ isEditingInline: boolean; registerInlineEdit: ()
     => () => void }`.
   - Internally maintain a `useState<number>` count. `registerInlineEdit`
     increments on call, returns a disposer that decrements. `isEditingInline
     = count > 0`.
   - Keep `resetKey` reset (force count back to 0 on stream change — still
     useful as a sanity net in case a consumer mis-uses the hook).
   - Remove the `visibilitychange` handler: with ref-counting it's no longer
     needed and would actively disagree with mounted state if the drawer
     stays open while the tab is backgrounded.
   - Export a small convenience hook `useInlineEditRegistration(active:
     boolean)` that wraps the register/dispose dance in a `useEffect` so
     callers can't forget cleanup.

2. **`apps/frontend/src/components/timeline/message-edit-form.tsx`**
   - At the top of the component, call
     `useInlineEditRegistration(isMobile)`. The form registering itself is
     the new source of truth: if it is mounted on mobile, the main composer
     is hidden; when it unmounts for *any* reason, the registration is
     released automatically.

3. **`apps/frontend/src/components/timeline/message-event.tsx`**
   - Remove all `inlineEdit?.setEditingInline(...)` calls (`:333`, `:342`,
     `:352`) and the now-unused import/ref, plus the unmount-cleanup
     `useEffect` at `:339-345`. `startEditing` / `stopEditing` become pure
     local-state toggles again.

4. **`apps/frontend/src/components/timeline/message-input.tsx`**
   - No logic change; `hideForInlineEdit = isMobile &&
     !!inlineEdit?.isEditingInline` continues to work since
     `isEditingInline` is still exposed.

5. **Tests**
   - Update `apps/frontend/src/components/timeline/message-input.test.tsx`
     and `message-edit-form.test.tsx` if they mock the old context shape.
   - Add a regression test (integration-level, mounting real components per
     INV-39) that covers: open mobile edit drawer, unmount the message row
     while the drawer is open, assert `MessageInput` is visible again.
     Also cover: rapid edit-A → edit-B within the 300 ms drawer close
     animation.

## Files touched

- `apps/frontend/src/components/timeline/inline-edit-context.tsx` (rewrite)
- `apps/frontend/src/components/timeline/message-edit-form.tsx` (add
  registration)
- `apps/frontend/src/components/timeline/message-event.tsx` (remove
  imperative setter usage)
- `apps/frontend/src/components/timeline/message-input.test.tsx` (adjust
  mocks if any)
- `apps/frontend/src/components/timeline/message-edit-form.test.tsx`
  (adjust mocks if any; add regression)

No changes needed in `stream-content.tsx` — the system-channel guard there
is static and unrelated.

## Verification

- `bun run test -- timeline` (unit/integration for the touched files).
- Manual mobile verification in dev:
  1. Open a channel, long-press a message, tap Edit → drawer appears,
     composer hides.
  2. Swipe-dismiss the drawer → composer reappears immediately.
  3. Repeat rapidly (edit → cancel → edit another) within 300 ms; composer
     must never stay hidden.
  4. Start editing, background the app, return → drawer still open and
     composer still hidden (proves visibility reset no longer lies).
  5. Start editing, scroll the edited row out of view so the virtualizer
     unmounts it → composer must reappear.
  6. Navigate to the system channel → read-only banner shows (unchanged).
     Navigate back → composer shows.
- `bun run test:e2e` smoke pass if mobile editor coverage exists there.
