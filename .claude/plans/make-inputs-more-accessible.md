# Message Editor Accessibility

## Goal

Improve the message composer's keyboard accessibility for THR-117 by giving keyboard users a reliable way to leave the editor when Tab is reserved for indentation, clarifying the editor's semantics for assistive technology, and fixing keyboard-only gaps in the composer formatting controls.

## What Was Built

### Composer Escape Flow And Instructions

The composer now exposes explicit keyboard instructions to screen readers and supports the intended Escape flow: pressing Escape while the editor is focused blurs the editor, and in fullscreen mode a second Escape closes the expanded editor after focus has moved to the fullscreen shell.

**Files:**
- `apps/frontend/src/components/composer/message-composer.tsx` - adds screen-reader instructions, fullscreen shell focus management, and wires composer editors into Escape blur behavior
- `apps/frontend/src/components/timeline/message-input.tsx` - updates expanded composer close handling so it only closes after Escape is no longer being handled by the focused editor
- `apps/frontend/src/components/thread/stream-panel.tsx` - mirrors the expanded Escape close behavior for the thread panel draft composer

### Rich Editor Accessibility Semantics

The shared rich editor now exposes proper textbox semantics for the TipTap contenteditable surface, including an accessible name, multiline semantics, and linked instructions. Escape-to-blur is implemented in the editor key path as an opt-in behavior so composer surfaces can use it without changing inline edit cancellation semantics, and editor labels are now explicit per surface instead of relying on a misleading shared default.

**Files:**
- `apps/frontend/src/components/editor/rich-editor.tsx` - adds ARIA support for the editor surface, requires explicit labels, and implements an opt-in Escape blur path
- `apps/frontend/src/components/timeline/message-edit-form.tsx` - labels the inline message edit surface as `Edit message` instead of inheriting composer semantics

### Keyboard-Accessible Formatting Controls

The inline formatting toolbar is no longer mouse-only when it is intentionally opened inside the composer. Its buttons and style picker stay keyboard-reachable in inline mode while preserving the existing focus-preserving pointer behavior.

**Files:**
- `apps/frontend/src/components/editor/editor-toolbar.tsx` - makes inline toolbar controls reachable and activatable from the keyboard

### Verification Coverage

Component tests cover the new editor semantics and toolbar keyboard behavior, and browser tests verify the named textbox, Escape blur, and double-Escape fullscreen flow.

**Files:**
- `apps/frontend/src/components/composer/message-composer.test.tsx` - verifies accessible naming and instruction text
- `apps/frontend/src/components/editor/editor-toolbar.test.tsx` - verifies inline toolbar tab order and keyboard activation
- `apps/frontend/src/components/timeline/message-edit-form.test.tsx` - verifies the inline edit surface exposes the correct accessible name
- `tests/browser/message-send-mode.spec.ts` - verifies named textbox exposure, Escape blur, and fullscreen double-Escape behavior

## Design Decisions

### Escape Blur Lives In The Editor, Not A Wrapper

**Chose:** Handle Escape-to-blur inside `RichEditor` as an opt-in behavior.
**Why:** Browser verification showed wrapper-level key handlers were too late in the event flow and did not reliably beat TipTap's own key handling.
**Alternatives considered:** A composer-level wrapper listener was attempted first, but it failed to blur consistently in real browser tests.

### Fullscreen Uses Focus Transfer To A Shell

**Chose:** Move focus from the fullscreen editor to a focusable shell after the first Escape.
**Why:** This makes the second Escape deterministic and gives the fullscreen close behavior a stable keyboard target.
**Alternatives considered:** Relying on blur alone left focus in an ambiguous state and made the second Escape inconsistent.

### Toolbar Keyboard Access Is Limited To Inline Mode

**Chose:** Restore tab order and keyboard activation for formatting controls only when the toolbar is rendered inline.
**Why:** The inline toolbar is part of the explicit composer UI and should be reachable; the floating selection toolbar can stay pointer-oriented to avoid unwanted tab stops during general editing.
**Alternatives considered:** Making every toolbar rendering keyboard-focusable would add noise to the floating selection experience.

### Editor Labels Must Be Explicit At Each Surface

**Chose:** Remove the default `RichEditor` label and require each caller to pass an explicit `ariaLabel`.
**Why:** Review feedback surfaced that a shared default misidentified inline message editing as `Message input`, which would announce the wrong purpose to assistive technology.
**Alternatives considered:** Keeping a generic default such as `Rich text editor` was possible, but still leaves the responsibility implicit and makes regressions easier to miss.

## Design Evolution

- **Escape handling location:** Initial wrapper-level Escape blur handling in the composer evolved into editor-level handling inside `RichEditor` after Playwright showed the wrapper approach did not actually blur the focused TipTap surface.
- **Fullscreen close sequencing:** Initial fullscreen close logic relied on the existing document listener. Browser verification exposed that blur and close could happen in the same Escape sequence, so the implementation shifted to an explicit blur-then-focus-shell-then-close flow.
- **Toolbar activation behavior:** Initial keyboard-accessible toolbar changes moved actions onto `onClick`, but review feedback showed that touch activation would stop firing after `preventDefault()` on `pointerdown`. The final implementation splits pointer activation to `onPointerDown` and keyboard activation to `onClick` with `detail === 0`.
- **Editor accessible naming:** Initial editor semantics used a `RichEditor` default label of `Message input`. Review feedback exposed that inline message editing inherited that label, so the implementation changed to require explicit labels and set `Edit message` at the inline edit call site.

## Schema Changes

None.

## What's NOT Included

- No refactor of unrelated editor surfaces such as inline message edit beyond preserving their existing Escape semantics
- No changes to attachment behavior, send-mode rules, or general editor formatting behavior outside accessibility and keyboard access
- No broad accessibility audit across the entire app beyond the message input/editor flow requested here

## Status

- [x] Add Escape-to-blur support for composer editors
- [x] Preserve fullscreen close behavior via double Escape
- [x] Expose proper textbox semantics and keyboard instructions for assistive tech
- [x] Require explicit editor labels so each surface announces the correct purpose
- [x] Make inline formatting controls keyboard-accessible
- [x] Verify the new behavior with targeted unit and browser tests
