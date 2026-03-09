# Mobile Editor Indentation Controls & Toolbar UX

## Goal

Add explicit indent and dedent controls to the mobile editor formatting bar, and fix the mobile toolbar UX so it feels great on touch devices: horizontal scrolling works, buttons don't steal focus (keeping the keyboard open), tap states are clean with no sticky hover, toolbar state reflects editor state instantly, and Enter inserts newlines instead of sending.

## What Was Built

### Shared indentation commands

The editor's existing Tab and Shift+Tab behavior was extracted into reusable `indentSelection` and `dedentSelection` helpers so toolbar buttons and keyboard shortcuts both use the same command path.

**Files:**
- `apps/frontend/src/components/editor/editor-behaviors.ts` - exports shared indentation commands and routes keyboard Tab handling through them.
- `apps/frontend/src/components/editor/editor-behaviors.test.ts` - verifies indentation for regular text blocks and dedentation inside code blocks.

### Mobile formatting toolbar controls

The inline editor toolbar now supports an optional special input section with dedicated indent and dedent buttons. That section is only enabled for the mobile composer formatting bar, leaving the desktop selection toolbar and fullscreen editor toolbar unchanged.

**Files:**
- `apps/frontend/src/components/editor/editor-toolbar.tsx` - adds mobile-only indent/dedent buttons behind a dedicated prop.
- `apps/frontend/src/components/editor/editor-toolbar.test.tsx` - verifies the buttons render only when enabled and dispatch the shared commands.

### Mobile toolbar UX fixes

Fixed several touch interaction issues that made the initial implementation feel broken on real devices.

**Horizontal scrolling** — Removed `snap-x snap-mandatory` and `shrink-0` from the scroll container, removed `stopPropagation` on touch events that was blocking native scroll, added `overscroll-x-contain touch-pan-x` for smooth panning.

**Focus protection (container-level)** — A single `onMouseDown` handler on the action bar container prevents focus theft for all child buttons, keeping the virtual keyboard open. `mousedown` fires after touch gesture recognition (doesn't block scroll) but before the browser transfers focus. Individual buttons use plain `onClick` for their actions — no per-button `onPointerDown` boilerplate needed.

**Focus protection (toolbar)** — Mobile toolbar buttons use `onMouseDown` for focus prevention and `onClick` for actions (split handlers). The StylePicker uses `onPointerDown` to intercept before Radix's internal handler.

**No sticky hover on tap** — Mobile toolbar buttons use `hover:bg-transparent hover:text-current` to neutralize the Shadcn ghost variant's `hover:bg-accent` (which sticks on touch devices). `active:bg-muted` provides tap feedback while finger is down. For toggled-on buttons, `hover:bg-muted-foreground/20` matches the active background so the sticky hover doesn't override it (CSS pseudo-class specificity: `:hover` > base class).

**Instant toolbar state** — Subscribed to editor `transaction` events via `useReducer` + `forceRender`, so `isActive()` reflects immediately when toggling marks without waiting for the next keystroke.

**Enter doesn't send on mobile** — `effectiveSendMode` now includes `isMobile`, so Enter inserts newlines and only the send button sends.

**Files:**
- `apps/frontend/src/components/editor/editor-toolbar.tsx` - scroll container, button event handling, hover/active styling, transaction subscription.
- `apps/frontend/src/components/composer/message-composer.tsx` - container-level focus protection, simplified button handlers, mobile send mode.
- `apps/frontend/src/components/editor/editor-toolbar.test.tsx` - tests for hover neutralization and toggled-on hover preservation.
- `apps/frontend/src/components/composer/message-composer.test.tsx` - updated to use click events matching new handler pattern.

## Design Decisions

### Reuse existing Tab behavior

**Chose:** Extract the existing keyboard indentation logic into exported helpers and have both keyboard shortcuts and toolbar buttons call them.
**Why:** This keeps indentation behavior consistent across desktop keyboards and mobile touch controls while minimizing new editor logic.

### Container-level focus protection over per-button handlers

**Chose:** A single `onMouseDown` handler on the action bar container instead of `onPointerDown` on each button.
**Why:** Scales automatically to new buttons, uses `mousedown` which doesn't interfere with touch scroll (unlike `pointerdown`), and eliminates per-button boilerplate.

### hover:bg-transparent + conditional hover for active state

**Chose:** Neutralize ghost hover with `hover:bg-transparent`, then override with `hover:bg-muted-foreground/20` when the button is toggled on.
**Why:** CSS `:hover` sticks on touch devices and has higher specificity than base utility classes. Using `hover:bg-transparent` prevents the sticky highlight, and the conditional override ensures the toggled-on background survives the sticky hover.

### Enter as newline on mobile

**Chose:** Override `messageSendMode` to `"cmdEnter"` on mobile.
**Why:** On mobile, Enter is the primary way to create newlines. Accidentally sending half-written messages on Enter is frustrating. The send button is always visible and reachable.

## Schema Changes

None.

## What's NOT Included

- No desktop toolbar changes beyond reusing the shared indentation helpers.
- No new editor node types or markdown serialization changes.
- No browser E2E coverage in this patch.

## Status

- [x] Added shared indent and dedent editor commands.
- [x] Added mobile-only indent and dedent controls to the inline formatting toolbar.
- [x] Fixed horizontal scrolling in mobile toolbar.
- [x] Fixed focus protection (container-level for action bar, per-button for toolbar).
- [x] Fixed sticky hover on mobile (neutralize ghost hover, preserve active state).
- [x] Fixed instant toolbar state (transaction subscription).
- [x] Changed Enter to newline on mobile (send via button only).
- [x] Added focused unit and component test coverage.
- [x] Browser-level manual verification on mobile viewport.
