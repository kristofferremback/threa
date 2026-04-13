# Fix: mobile stream composer still hidden after refresh

## Problem

After refresh, users sometimes land on a mobile stream with the message
composer invisible. No drawer visible either — just missing input. Five
previous attempts (notably #297 introducing `InlineEditProvider`, #299
switching to ref-counted registrations, and #306 adding deferred / visibility
verification safety nets) narrowed the class of bugs but did not eliminate
them.

The common thread: the composer's visibility was driven by **React state**
(a ref count of mounted edit surfaces) stored in a context. Anything that
desynchronised the count from actual mounted forms —

- hydration races with `PendingMessagesProvider` restoring `_status:
  "editing"` from IDB after the timeline has already rendered,
- virtualisation cycles unmounting edit rows while vaul's portal animation
  is in flight,
- React strict mode double-mount quirks,
- service worker stale CSS/JS,
- closed tab before `cancelEditing`'s 300 ms `setTimeout` could fire —

left `isEditingInline` stuck `true`, which kept `display: none` on the
composer even though no edit UI was actually mounted anywhere.

## Approach

Stop hiding the composer via React state. Hide it via a pure CSS `:has()`
rule that reads DOM presence directly:

```css
@media (max-width: 639px) {
  body:has([data-inline-edit]) [data-message-composer-root] {
    display: none;
  }
}
```

`MessageEditForm` and `UnsentMessageEditForm` already render a
`data-inline-edit` wrapper around their editor. On mobile both live inside
a vaul `Drawer`, which portals to `document.body` — `body:has()` descends
into portals, so the selector matches whenever (and only when) an edit
surface is actually mounted in the document. When the form unmounts for any
reason, the attribute is gone from the DOM on the next commit and the
composer reappears on the next style recalculation. There is no state to
leak.

`data-message-composer-root` is a new marker on `MessageInput`'s outer
wrapper so only the stream composer is affected (desktop composers and
thread-panel composers are not impacted; the latter already does not hide
when editing and that behaviour is preserved).

## Changes

1. **Delete** `apps/frontend/src/components/timeline/inline-edit-context.tsx`
   and its test. The ref-count machinery, `visibilitychange` reset, and 2 s
   deferred verification are all obsolete.
2. **`apps/frontend/src/components/timeline/message-input.tsx`** — drop
   `useInlineEdit` / `hideForInlineEdit`; tag the wrapper with
   `data-message-composer-root`; keep the `expanded → hidden` behaviour.
3. **`apps/frontend/src/components/timeline/message-edit-form.tsx`** and
   **`unsent-message-edit-form.tsx`** — remove `useInlineEditRegistration`
   calls. The `data-inline-edit` wrappers stay as the DOM signal.
4. **`apps/frontend/src/components/timeline/stream-content.tsx`** — drop the
   `InlineEditProvider` wrapper.
5. **`apps/frontend/src/components/timeline/message-event.tsx`** — refresh
   the stopEditing comment to reflect the new CSS-only mechanism.
6. **`apps/frontend/src/index.css`** — add the `:has()` rule inside
   `@layer base`, gated by `@media (max-width: 639px)` to match the existing
   mobile breakpoint (`use-mobile.tsx`: `MOBILE_BREAKPOINT = 640`).
7. **`apps/frontend/src/index.css.test.ts`** — regression test that reads
   the CSS file and asserts the critical selector + media query + display
   declaration are all present. Deleting the rule breaks the test.

## Why this cannot regress the class of bugs

- The old failure mode was "React says hide but no edit UI mounted". The
  new selector is literally `body:has([data-inline-edit])` — if no element
  matches, the composer is visible. There is no intermediary state.
- Mobile: `isPanelOpen` mode swaps the main `StreamContent` out for the
  thread-panel `StreamContent`, so at most one `MessageInput` exists at a
  time. Global `:has` is sufficient and accurate.
- Desktop: the `@media (max-width: 639px)` gate means the rule does not
  apply; desktop already did not hide the composer during inline edit and
  that is preserved.

## Verification

- `bunx vitest run` → 1132 tests pass, including the new CSS regression
  test.
- `bunx tsc -p apps/frontend --noEmit` → clean.
- Manual mobile verification (to be done by user):
  1. Open DM, tap Edit on a message → drawer shows, composer hides.
  2. Swipe-dismiss the drawer → composer reappears when the form unmounts
     (after the 300 ms `cancelEditing` delay, matching existing behaviour).
  3. Start editing a pending/failed message, force-kill the tab, reopen →
     drawer re-opens with the editing message (IDB-backed), composer
     hides. Dismissing the drawer restores the composer.
  4. Refresh a DM with no pending edit state → composer visible immediately.
  5. Virtualise the editing row off-screen (scroll away while drawer open)
     → form + drawer tear down, composer reappears.
