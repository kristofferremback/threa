# Markdown Paste Horizontal Rule Support

## Goal

Fix a composer paste failure where otherwise valid markdown could be consumed by the paste handler but not inserted into the TipTap editor. The repro content included fenced TypeScript, blockquotes, attachment references, links, emoji shortcodes, and `---` separators. The shared markdown parser represents `---` as `horizontalRule`, but the composer schema did not register that node type.

## What Was Built

### Editor schema support for horizontal rules

Added a minimal TipTap node extension for the shared parser's `horizontalRule` JSON node and registered it in the composer/editor extension list. This keeps the frontend editor schema aligned with the shared markdown parser/serializer contract.

**Files:**
- `apps/frontend/src/components/editor/horizontal-rule-extension.ts` — defines the `horizontalRule` block node and renders it as `<hr>`.
- `apps/frontend/src/components/editor/editor-extensions.ts` — registers `HorizontalRuleExtension` with the existing editor schema.

### Regression coverage for the paste repro

Added a test that pastes the full problematic markdown shape: TypeScript generics/JSX inside a fenced code block, blockquotes, links, attachment references, emoji shortcode text, and horizontal rule separators. The test asserts the paste is handled and that the attachment reference survives serialization.

**Files:**
- `apps/frontend/src/components/editor/multiline-blocks.test.ts` — adds the regression case for multiline markdown paste with horizontal rules.

## Design Decisions

### Register the parser-emitted node instead of filtering it out

**Chose:** Add a `horizontalRule` TipTap node extension.
**Why:** `horizontalRule` is already part of the shared markdown JSON contract (`parseMarkdown` emits it and `serializeToMarkdown` serializes it). Supporting the node in the editor preserves user-authored separators instead of silently dropping or rewriting them.
**Alternatives considered:** Strip `horizontalRule` nodes in the paste path, but that would create parser/editor drift and lose pasted content.

### Keep the node extension minimal

**Chose:** Implement only schema registration and HTML rendering/parsing.
**Why:** The bug only requires the editor to accept and render parser-produced horizontal rules. Toolbar commands or input rules for authoring horizontal rules interactively are out of scope.
**Alternatives considered:** Add full command support mirroring TipTap's official HorizontalRule extension; deferred because no UI path needs it for this fix.

## Design Evolution

No significant course corrections. Investigation narrowed the failure from the full paste payload to the `---` separators becoming unsupported `horizontalRule` nodes.

## Schema Changes

None.

## What's NOT Included

- No new toolbar button or slash command for inserting horizontal rules.
- No changes to the shared markdown parser/serializer.
- No backend/API changes.

## Status

- [x] Reproduced the paste failure via a regression test.
- [x] Registered `horizontalRule` in the TipTap editor schema.
- [x] Verified the focused editor test suite passes.
- [x] Verified frontend TypeScript typecheck passes.
