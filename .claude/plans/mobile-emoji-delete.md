# Mobile Emoji Delete

## Goal

Fix Firefox Android composer deletion around emoji without regressing the editor's core rich-text behavior. The composer should stop relying on contenteditable=false emoji atoms for new input, preserve canonical shortcode markdown at system boundaries, and keep local LAN testing usable from a phone.

## What Was Built

### Composer Emoji Editing

New emoji input in the rich editor is represented as editable text instead of new inline emoji atom nodes. Legacy emoji atom nodes remain in the schema for old JSON content and round trips, but composer surfaces convert them to text on load.

**Files:**
- `apps/frontend/src/components/editor/triggers/emoji-extension.ts` - inserts emoji suggestion/input-rule results as text and keeps legacy atom rendering.
- `apps/frontend/src/components/editor/rich-editor.tsx` - parses composer markdown with `emojiAsText`, converts legacy emoji atoms in incoming editor JSON, and wires grapheme deletion into `beforeinput`.
- `apps/frontend/src/components/editor/document-editor-modal.tsx` - uses the same editable emoji parsing and grapheme delete handling in the expanded document editor.
- `packages/prosemirror/src/markdown.ts` - adds `emojiAsText` parse option so callers can choose text emoji rather than atom nodes.

### Firefox Android Delete Handling

The mobile delete path now has two scoped safeguards:

- Inline atom deletion remains for legacy mention/channel/emoji atoms, including pending DOM selection flush before handling Android `beforeinput`.
- Multi-code-unit text graphemes are deleted as one visible character before Firefox can split surrogate pairs or ZWJ sequences.

**Files:**
- `apps/frontend/src/components/editor/multiline-blocks.ts` - adds inline atom deletion hardening and grapheme-aware delete handling.
- `apps/frontend/src/components/editor/multiline-blocks.test.ts` - covers legacy atom deletion, typed emoji-as-text, adjacent emoji, split surrogate recovery, selected ranges ending inside an emoji, and ZWJ emoji sequences.

### Markdown Normalization

Rich clients may now send raw emoji text in `contentJson`, so backend message handlers normalize the derived markdown projection to existing shortcode form.

**Files:**
- `apps/backend/src/features/messaging/handlers.ts` - normalizes JSON-derived `contentMarkdown` through `normalizeMessage`.
- `packages/prosemirror/src/markdown.test.ts` - covers `emojiAsText` parsing while preserving default atom parsing for wire-format round trips.

### LAN Dev And Worktree Setup

The dev stack can be run on an explicit LAN host for phone testing, and worktree setup now repairs existing but unseeded cloned databases.

**Files:**
- `scripts/dev.ts` - accepts `LAN_HOST`/`LAN_IP`, treats those as LAN mode, and feeds the host into dev service environment.
- `apps/workspace-router/src/index.ts` - preserves upstream forwarding headers only for local proxy targets so Tailscale auth redirects work without trusting spoofed production headers.
- `apps/workspace-router/src/index.test.ts` - covers local forwarded header preservation and remote forwarded header spoof protection.
- `scripts/setup-worktree.ts` - detects empty existing target databases and clones from the source DB.
- `.gitignore` - ignores `.wrangler/` local worker output.

## Design Decisions

### Use Editable Emoji Text For New Composer Input

**Chose:** Insert resolved native emoji as text for new shortcode conversion and emoji picker selection.

**Why:** Firefox Android struggles with deleting adjacent contenteditable=false inline atoms. Mentions and channels are still atoms, but their visible text is ASCII chip content; emoji expose surrogate pair and ZWJ deletion problems that Firefox can split.

**Alternatives considered:** Keep emoji as atoms and intercept harder. This improved one path but still required multiple backspaces and created broken selection states between adjacent emoji.

### Keep The Emoji Atom Schema For Compatibility

**Chose:** Preserve the existing `emoji` node type and default shared markdown parser behavior.

**Why:** Older message JSON and wire-format round trips may still contain emoji nodes. Removing the node would be a larger data compatibility change.

**Alternatives considered:** Delete the emoji node entirely. That would reduce code but risk breaking legacy content hydration.

### Normalize Markdown At The Backend Boundary

**Chose:** Allow editable emoji text in `contentJson`, but normalize `contentMarkdown` to shortcodes.

**Why:** The editor needs text for mobile deletion, while storage, usage tracking, and external consumers already expect canonical shortcode markdown.

### Limit Forwarded Header Trust To Local Targets

**Chose:** Preserve incoming `X-Forwarded-*` headers only when proxying to a local backend/control-plane target.

**Why:** Local Vite to Wrangler proxying needs the original Tailscale host for auth redirects. Production must not trust client-supplied forwarding headers.

## Design Evolution

- **Atom tuning to text model:** The initial attempt tried to make emoji atoms easier to delete on Android. That still fought browser selection behavior and caused editor regressions, so the final implementation avoids creating new emoji atoms.
- **Text model plus grapheme guard:** Plain emoji text fixed the atom selection problem but Firefox could still delete one UTF-16 code unit at a time. The final `beforeinput` handler deletes whole multi-code-unit graphemes only when needed.
- **Header preservation hardened:** The local auth redirect fix originally preserved forwarding headers too broadly. Self-review changed this to local-target-only preservation.

## Schema Changes

None.

## What's NOT Included

- Custom image emoji support. Image emoji would need a separate design that avoids reintroducing inline contenteditable=false atoms in the composer.
- A production data migration for existing emoji atom JSON. Existing content is converted when loaded into composer surfaces.
- Browser automation for Firefox Android. The behavior was manually tested through the LAN dev server and covered with unit tests for the ProseMirror input paths.

## Status

- [x] New composer emoji are editable text.
- [x] Legacy emoji atom JSON still hydrates.
- [x] Firefox Android grapheme deletion path is covered by focused tests.
- [x] LAN dev auth redirects can use a Tailscale host.
- [x] Worktree setup handles empty existing cloned databases.
- [x] Router forwarding header trust is scoped to local proxy targets.
