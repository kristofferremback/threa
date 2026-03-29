# Editor Inline Mark Escape And Link Editing

## Goal

Fix inline mark editing in the frontend editor so users can reliably escape inline code, edit links without losing selection context, and keep link behavior aligned with Linear-style expectations. The scope is limited to inline code boundaries, link editing UX, and regression coverage around the floating formatting toolbar.

## What Was Built

### Inline code boundary behavior

Inline code now has explicit keyboard boundary handling. Arrow keys can move the caret in and out of inline code without inserting whitespace, and a zero-footprint boundary decoration gives the user visible feedback when the caret crosses that boundary.

**Files:**
- `apps/frontend/src/components/editor/editor-behaviors.ts` - Adds stored-mark boundary handling and a code-boundary decoration plugin for inline code
- `apps/frontend/src/components/editor/atom-aware-marks.ts` - Disables TipTap's default exitable behavior for inline code so the editor uses the custom boundary path instead

### Link mark behavior and link editor lifecycle

Links now behave as non-inclusive marks: typing at the end of a link continues outside the link, while typing inside linked text still extends it. The floating link editor now snapshots the original link URL and selection, opens without racing the click sequence, and restores the original selection before update, remove, or close so actions still target the intended link.

**Files:**
- `apps/frontend/src/components/editor/atom-aware-marks.ts` - Adds a boundary-aware link extension with non-inclusive end behavior
- `apps/frontend/src/components/editor/editor-extensions.ts` - Wires the custom link extension into the editor setup
- `apps/frontend/src/components/editor/editor-toolbar.tsx` - Snapshots link state, keeps the floating toolbar anchored, closes the link editor on outside interactions, and defers link-editor opening to click
- `apps/frontend/src/components/editor/link-editor.tsx` - Restores the captured editor selection before link mutations and initializes from the captured URL
- `apps/frontend/src/components/editor/document-editor-modal.tsx` - Uses the shared link toolbar action in the fullscreen editor toolbar

### Regression coverage

Focused tests were added for code-boundary keyboard behavior, zero-footprint boundary rendering, link mark behavior, and floating link editor state handling.

**Files:**
- `apps/frontend/src/components/editor/editor-behaviors.test.ts` - Covers inline code escape/re-entry, zero-footprint code boundaries, link boundary defaults, and toolbar link exit behavior
- `apps/frontend/src/components/editor/editor-toolbar.test.tsx` - Covers link action sequencing, preserved link snapshots, floating link editor focus, and close behavior
- `apps/frontend/src/components/editor/link-editor.test.tsx` - Covers selection restoration before link updates and close

## Design Decisions

### Keep fake-boundary navigation only for inline code

**Chose:** Preserve left/right boundary navigation for inline code, but remove it for links.
**Why:** The code-mark behavior benefits from feeling like invisible backticks, while the same interaction made links unstable and harder to reason about. Links are simpler and more predictable as non-inclusive marks.
**Alternatives considered:** Sharing the same left/right entry-exit behavior across both `code` and `link`. Rejected because it caused link extension bugs and felt worse than Linear's simpler link behavior.

### Snapshot selection before opening the floating link editor

**Chose:** Capture the selected link URL and selection range before opening the floating link editor and restore that range before applying link mutations.
**Why:** Moving focus into the link input should not retarget update/remove actions to the end of the paragraph or whichever cursor position TipTap keeps after blur.
**Alternatives considered:** Reading live link attributes and current selection directly from the editor on every render. Rejected because the floating editor loses the original context once focus moves away from the editor surface.

### Defer link-editor opening to click instead of pointerdown

**Chose:** Prevent blur on `pointerdown`, but open the floating link editor on `click`.
**Why:** Opening the editor during `pointerdown` changes layout before the click sequence finishes, which can cause the trailing click to land back on the editor shell and move the caret to the end.
**Alternatives considered:** Keeping the existing pointerdown-open behavior and trying to patch the resulting focus race. Rejected because the race comes from opening a layout-changing UI mid-click.

### Show a visible code boundary without moving text

**Chose:** Add a widget decoration at code boundaries with a narrow width and equal negative side margins.
**Why:** This gives the caret a visible inside/outside stop without changing document content and without shifting surrounding text.
**Alternatives considered:** Stored-mark changes only. Rejected because the cursor felt like it had not moved. Adding a normal-width spacer without cancellation was also rejected because it pushed surrounding text around.

## Design Evolution

- **Shared link/code boundary behavior to code-only boundaries:** The initial implementation gave both links and inline code the same arrow-based enter/exit behavior. The final implementation keeps that only for inline code and lets links behave as plain non-inclusive marks.
- **Floating link editor without selection snapshots to snapshot-based mutations:** The initial floating link editor depended on live editor state and lost the original selection when focus moved into the input. The final implementation snapshots the URL and selection before opening.
- **Visible code boundary with layout shift to zero-footprint boundary:** The first boundary decoration created a visible caret stop but shifted surrounding text. The final implementation preserves the stop while cancelling the widget's net inline footprint.

## Schema Changes

None.

## What's NOT Included

- Broader refactors of the editor toolbar or link editor beyond the behavior needed to stabilize inline code and links
- New link-specific arrow entry/exit behavior
- Changes to block formatting, mentions, emoji triggers, or other inline marks outside `code` and `link`

## Status

- [x] Inline code can be escaped and re-entered with arrow keys without inserting whitespace
- [x] Inline code boundaries provide visible caret feedback without changing document content
- [x] Links behave as non-inclusive marks and still extend when edited inside
- [x] Floating link editing preserves the original URL and selection target
- [x] Floating link opening no longer races the click sequence and refocuses the editor unexpectedly
- [x] Regression coverage was added for the new code and link behavior
