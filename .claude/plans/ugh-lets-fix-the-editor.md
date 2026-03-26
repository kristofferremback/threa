# Editor Multiline Block Handling

## Goal

Fix multiline block editing regressions in the composer and fullscreen editor so code blocks and blockquotes behave consistently across desktop and mobile. The scope of this change is limited to multiline block toggling, multiline paste, and exiting multiline blocks after a second newline.

## What Was Built

### Shared multiline block behavior

A dedicated multiline block helper now owns the risky editor transitions for code blocks and blockquotes. This includes partial unwrapping when a multiline style is toggled off, multiline-aware paste handling, and shared newline handling for both keyboard and mobile `beforeinput` flows.

**Files:**
- `apps/frontend/src/components/editor/multiline-blocks.ts` - Shared multiline toggle, paste, and newline logic for code blocks and blockquotes
- `apps/frontend/src/components/editor/editor-behaviors.ts` - Reuses the shared multiline helpers for keyboard shortcuts and newline behavior

### Composer and fullscreen editor wiring

Both editor entry points now route paste and mobile newline behavior through the same shared helpers. Toolbar toggles were also switched to the shared multiline toggle path so desktop composer and fullscreen modal no longer disagree about how multiline blocks are removed.

**Files:**
- `apps/frontend/src/components/editor/rich-editor.tsx` - Uses shared multiline paste and `beforeinput` handling in the main composer
- `apps/frontend/src/components/editor/document-editor-modal.tsx` - Uses the same shared multiline logic in the fullscreen editor
- `apps/frontend/src/components/editor/editor-toolbar.tsx` - Routes quote/code block toolbar actions through the shared toggle helper

### Regression coverage

Added focused unit coverage for the extracted multiline helper and expanded Playwright coverage so the changed desktop and mobile block behaviors are exercised in a browser.

**Files:**
- `apps/frontend/src/components/editor/multiline-blocks.test.ts` - Unit coverage for partial unwrap, multiline paste, and mobile newline escape
- `tests/browser/rich-text-editing.spec.ts` - Browser coverage for first-line unwrap, partial unwrap, multiline paste, desktop escape, and mobile `beforeinput` escape

## Design Decisions

### Centralize multiline block state transitions

**Chose:** Extract the code block and blockquote toggle, paste, and newline behavior into `multiline-blocks.ts`.
**Why:** The regressions were caused by desktop and mobile flows using different code paths. A single helper reduces divergence between keyboard shortcuts, toolbar actions, inline composer behavior, and the fullscreen modal.
**Alternatives considered:** Patching the existing handlers in place in each component. Rejected because it would keep the logic split across multiple entry points and make future regressions more likely.

### Treat multiline block removal as a structural edit, not a plain toggle

**Chose:** When toggling off a multiline block, unwrap either the whole block or only the targeted lines depending on cursor/selection position.
**Why:** This matches the requested UX and preserves surrounding block structure instead of deleting formatting wholesale.
**Alternatives considered:** Keeping the existing all-or-nothing toggle behavior. Rejected because it destroys surrounding block structure and breaks the requested line-level removal behavior.

### Reuse the same newline semantics on desktop and mobile

**Chose:** Route desktop enter handling and mobile `beforeinput` handling through the same newline helper.
**Why:** The mobile bug existed because the browser path differed from the keyboard path. Sharing the logic keeps second-newline escape behavior aligned.
**Alternatives considered:** Special-casing mobile only. Rejected because it would reintroduce drift between platforms.

## Design Evolution

- **Desktop-only behavior to shared behavior:** The original behavior depended on separate desktop keyboard and mobile input paths. The final implementation moved those transitions into a shared helper so both environments follow the same escape and paste rules.

## Schema Changes

None.

## What's NOT Included

- Broader editor cleanup outside multiline code blocks and blockquotes
- Changes to non-multiline styles such as headings, lists, or inline formatting
- Additional mobile UX polish beyond making multiline block behavior consistent and test-covered

## Status

- [x] Keep multiline paste inside code blocks and blockquotes
- [x] Exit multiline blocks on the second newline on desktop and mobile
- [x] Support first-line, current-line, and selected-line multiline block unwrapping
- [x] Add unit coverage for shared multiline behavior
- [x] Add Playwright coverage for desktop and mobile multiline block behavior
