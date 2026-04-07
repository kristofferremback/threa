# Scratchpad Custom AI Instructions

## Goal

Add a scratchpad-only custom instruction setting so users can shape how Ariadne behaves in their personal notes, while keeping shared contexts unchanged. The implementation also refreshes the desktop settings shell so the growing settings surface remains usable.

## What Was Built

### Scratchpad Prompt Preference

Added a new `scratchpadCustomPrompt` user preference and wired it through validation, sparse preference storage, and bootstrap typing so the value can be saved like other settings.

**Files:**
- `packages/types/src/preferences.ts` - Adds the new preference field, default value, and `ai` settings tab.
- `apps/backend/src/features/user-preferences/handlers.ts` - Validates incoming prompt updates.
- `apps/backend/src/features/user-preferences/service.ts` - Persists the prompt through the sparse override pipeline.
- `apps/backend/tests/integration/user-preferences.test.ts` - Verifies the prompt is stored as an override.

### Scratchpad-Scoped Prompt Injection

The companion context now resolves the saved prompt only for scratchpads and scratchpad-root threads, then injects it immediately after Ariadne's base system prompt.

**Files:**
- `apps/backend/src/features/agents/companion/context.ts` - Resolves whether the current stream inherits scratchpad custom instructions.
- `apps/backend/src/features/agents/companion/prompt/system-prompt.ts` - Injects the scratchpad custom instructions section into the final system prompt.
- `apps/backend/src/features/agents/companion/prompt/system-prompt.test.ts` - Verifies injection order and omission when unset.

### AI Settings UI

Added a new desktop settings tab for AI behavior. The scratchpad prompt editor uses the same rich editor surface as the message composer, but with mentions, channels, commands, and emoji parsing disabled so the field behaves like instructions instead of chat input.

**Files:**
- `apps/frontend/src/components/settings/ai-settings.tsx` - New scratchpad instructions editor with explicit save and reset controls.
- `apps/frontend/src/components/settings/index.ts` - Exports the new settings section.
- `apps/frontend/src/components/settings/ai-settings.test.tsx` - Verifies save, clear, and reset behavior.

### Settings Dialog Redesign

Reworked the desktop settings dialog from a cramped pill tab row to a sidebar layout with a larger fixed-height shell and internal scrolling. Mobile keeps the existing responsive tab selector behavior.

**Files:**
- `apps/frontend/src/components/settings/settings-dialog.tsx` - Introduces the sidebar layout, larger dialog sizing, and AI tab wiring.

### Reusable Editor Gating

Extended the rich editor and markdown parser so structured chat features can be selectively disabled. This lets the AI settings field reuse the message composer without unwanted mention or slash-command behavior.

**Files:**
- `apps/frontend/src/components/editor/rich-editor.tsx` - Adds feature flags for mentions, channels, commands, and emoji.
- `apps/frontend/src/components/editor/editor-markdown.ts` - Supports parsing markdown with structured token parsing disabled.
- `apps/frontend/src/components/editor/multiline-blocks.ts` - Passes parser options through paste handling.
- `apps/frontend/src/components/editor/editor-action-bar.tsx` - Lets callers hide mention and emoji actions.
- `apps/frontend/src/components/editor/editor-markdown.test.ts` - Verifies disabled token parsing preserves plain text.

## Design Decisions

### Scratchpad-Only Scope

**Chose:** Apply the custom prompt only in scratchpads and scratchpad-root threads.
**Why:** The user explicitly wanted to start with personal contexts only until the shared-context model is clearer.
**Alternatives considered:** Applying the prompt across every Ariadne invocation, which risks leaking personal instruction styles into shared spaces.

### Inject After the Base System Prompt

**Chose:** Insert the saved instructions immediately after Ariadne's base persona prompt.
**Why:** This matches the requested ordering and keeps persona identity primary while still giving the user durable influence over scratchpad behavior.
**Alternatives considered:** Appending the custom prompt later in the context, which would weaken its priority and make the behavior harder to reason about.

### Reuse the Rich Composer Surface

**Chose:** Reuse the existing rich editor rather than introducing a plain textarea.
**Why:** The user wanted the same writing surface across the app, and reusing the editor keeps formatting, keyboard behavior, and editing feel consistent.
**Alternatives considered:** Shipping a textarea first, which would be cheaper but visually and behaviorally inconsistent.

### Generalize Editor Parsing Controls

**Chose:** Add explicit feature flags to the shared rich editor and markdown parser.
**Why:** The AI settings editor needs the same surface without chat-specific tokenization, and a shared toggle is cleaner than forking the editor.
**Alternatives considered:** Building a one-off settings-only editor or post-processing the parsed document to strip structured nodes.

## Design Evolution

- **Editor choice changed:** Plain settings textarea -> shared rich editor. The user called out the mismatch in writing surfaces, so the implementation switched to the fancy message input and disabled chat-only affordances inside that context.
- **Settings navigation changed:** Expanding pill tabs -> desktop sidebar shell. The original request expanded the settings surface enough that the existing top-row tab treatment was no longer appropriate.

## Schema Changes

No database schema changes or migrations were required. The prompt is stored in the existing sparse user-preferences override model.

## What's NOT Included

- Shared-context custom prompts for channels, DMs, or other public/private collaborative spaces.
- Per-stream or per-thread custom prompt overrides.
- Special autocomplete or AI-specific templating inside the custom prompt editor.
- New backend access rules beyond the existing scratchpad and scratchpad-root thread scoping.

## Status

- [x] Added a persisted scratchpad custom prompt preference.
- [x] Injected the custom prompt into scratchpad and scratchpad-root thread system prompts.
- [x] Added a new AI settings tab with a shared rich editor surface.
- [x] Redesigned the desktop settings dialog to use a sidebar and fixed-height layout.
- [x] Added targeted frontend and backend tests for the new behavior.
