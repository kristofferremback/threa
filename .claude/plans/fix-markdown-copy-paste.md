# Fix: Markdown paste silently fails when content contains horizontal rules

## Goal

Fix a bug where pasting markdown content containing `---` (horizontal rules) into the message composer results in nothing being pasted — the entire paste content is silently dropped.

## What Was Built

### Added HorizontalRule extension to the TipTap editor

`parseMarkdown` from `@threa/prosemirror` correctly parses `---` into `{ type: "horizontalRule" }` nodes. However, the TipTap editor had no `HorizontalRule` extension registered, so when `insertContent` tried to create nodes from the parsed JSON, `schema.nodeType("horizontalRule")` threw `RangeError: Unknown node type: horizontalRule`.

TipTap's `createNodeFromContent` catches this error internally and returns empty content (when `errorOnInvalidContent` is false). The command then succeeds with nothing to insert, and the paste handler calls `event.preventDefault()` thinking it handled the paste. The user sees nothing pasted.

**Files:**
- `apps/frontend/package.json` — Added `@tiptap/extension-horizontal-rule` dependency
- `apps/frontend/src/components/editor/editor-extensions.ts` — Imported and registered `HorizontalRule` extension in the editor

## Design Decisions

### Register HorizontalRule as a standard block extension

**Chose:** Added `@tiptap/extension-horizontal-rule` to the editor extensions array alongside other block-level extensions (Blockquote, CodeBlock, etc.)
**Why:** The parser already handles `---` correctly; the gap was only in the editor schema. Adding the extension is the minimal, correct fix that makes paste work for any content containing horizontal rules.
**Alternatives considered:** Filtering `horizontalRule` nodes out of parsed content before insertion — this would silently drop content, which is worse UX. Adding a try-catch in the paste handler — this would treat the symptom, not the cause.

## What's NOT Included

- No changes to the markdown parser/serializer — those correctly handle horizontal rules already
- No CSS changes — the existing ProseMirror prose styling handles `<hr>` elements
- No keyboard shortcut additions — `---` already auto-converts via input rules if the HorizontalRule extension is present

## Status

- [x] Added `@tiptap/extension-horizontal-rule` to `apps/frontend/package.json`
- [x] Imported and registered `HorizontalRule` in `editor-extensions.ts`
- [x] TypeScript typecheck passes
- [x] All 104 markdown test pass (including existing horizontal rule round-trip tests)
