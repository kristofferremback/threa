# vi.mock → scoped spyOn Migration (INV-48)

## Goal

Migrate all `vi.mock()` call sites in the frontend test suite to scoped `vi.spyOn()` patterns (or real provider/harness wrappers), then promote the ESLint rule from `warn` → `error`.

**INV-48:** "Avoid `mock.module()` for shared modules; prefer scoped `spyOn` patterns." `vi.mock` is Vitest's equivalent of Bun's `mock.module` and falls under the same invariant (extended via PR #374, currently at `warn`).

## Constraints

- **Test files only.** Production code stays untouched. Tests are pass/fail and safe to patch.
- **Single mega-PR on branch `claude/vi-mock-migration`** — shipped after all phases are done. Phases exist for working-memory reasons (commit + user-compact between each), not for separate PRs.
- No `vi.mock` or `eslint-disable no-restricted-syntax` in final state (rule goes to `error`).

## Scope

- **55 frontend test files**, **170 `vi.mock` call sites** (as of origin/main `f237d60`).
- Shared helpers `src/test/mocks/router.tsx` and `src/test/mocks/hooks.ts` only reference `vi.mock` in JSDoc — docs update, not migration. Consumers of those helpers change their usage pattern.

## Migration Conventions

### A. Module spy via namespace import (primary pattern)

Replace factory-mocks of named exports with `import * as ns` + `vi.spyOn` in `beforeEach`.

```ts
// Before
vi.mock("./editor-behaviors", () => ({
  indentSelection: vi.fn(),
  handleLinkToolbarAction: vi.fn(() => "opened"),
}))

// After
import * as editorBehaviors from "./editor-behaviors"

beforeEach(() => {
  vi.spyOn(editorBehaviors, "indentSelection").mockImplementation(() => {})
  vi.spyOn(editorBehaviors, "handleLinkToolbarAction").mockImplementation(() => "opened")
})

afterEach(() => {
  vi.restoreAllMocks()
})
```

Vitest live-bindings make the spy visible to the module-under-test's `import { indentSelection } from "./editor-behaviors"` consumers.

### B. `vi.mocked(fn)` → captured spy reference

```ts
// Before
vi.mocked(handleLinkToolbarAction).mockReturnValue("opened")

// After (per-test)
vi.spyOn(editorBehaviors, "handleLinkToolbarAction").mockReturnValue("opened")
```

### C. Partial mocks (`importOriginal`)

```ts
// Before
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>()
  return { ...actual, useNavigate: () => mockNavigate }
})

// After
import * as routerDom from "react-router-dom"

beforeEach(() => {
  vi.spyOn(routerDom, "useNavigate").mockReturnValue(mockNavigate)
})
```

### D. Shared factories (`createHooksMock`, `createRouterMock`)

Factories stay but the _application_ changes from `vi.mock()` to a spy loop. Add a new helper `src/test/mocks/apply-spies.ts`:

```ts
export function applyModuleSpies<T extends Record<string, any>>(namespace: T, implementations: Partial<T>) {
  for (const [key, impl] of Object.entries(implementations)) {
    vi.spyOn(namespace, key as keyof T & string).mockImplementation(impl as never)
  }
}
```

Usage:

```ts
import * as hooks from "@/hooks"
import { createHooksMock, applyModuleSpies } from "@/test/mocks"

beforeEach(() => {
  applyModuleSpies(
    hooks,
    createHooksMock({
      /* ... */
    })
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})
```

Update JSDoc in `createHooksMock` and `createRouterMock` to document the new usage.

### E. Test-harness replacement (when spyOn doesn't fit)

For cases where the mock exists purely to avoid rendering a Router/Toaster/Provider, prefer the real provider in a test wrapper:

- `react-router-dom` → wrap with `<MemoryRouter>` instead of mocking.
- `sonner` Toaster → mount the real `<Toaster />` in the test harness or omit it entirely.
- `@/contexts` providers (Auth, Workspace, Preferences) → wrap with the real provider and inject state through its documented API.

### F. `vi.hoisted` cleanup

When a test uses `vi.hoisted()` to share state with a hoisted `vi.mock()`, the hoisting becomes unnecessary after migration. Move state to module scope (top of file) or closure scope.

### G. Last-resort escape hatch

If a specific pattern is genuinely incompatible with `spyOn` (e.g., frozen namespace, default-export quirks, bundler-specific transforms), document it in a code comment and file a follow-up — **do not ship `eslint-disable` in the mega-PR**. Promotion to `error` is blocked until all 170 sites are converted.

## File Inventory (bucketed by `vi.mock` count)

### Bucket S — Simple (1 vi.mock, 18 files)

```
src/components/relative-time.test.tsx
src/components/workspace-emoji.test.tsx
src/components/trace/trace-step.test.tsx
src/components/ui/markdown-content.test.tsx
src/components/settings/keyboard-settings.test.tsx
src/components/timeline/attachment-list.test.tsx
src/components/timeline/edited-indicator.test.tsx
src/components/timeline/join-channel-bar.test.tsx
src/components/timeline/message-context-menu.test.tsx
src/contexts/pending-messages-context.test.tsx
src/hooks/use-attachments.test.ts
src/hooks/use-keyboard-shortcuts.test.tsx
src/hooks/use-stream-or-draft.test.tsx
src/hooks/use-streams.test.tsx
src/hooks/use-unread-divider.test.ts
src/hooks/use-workspace-emoji.test.ts
src/lib/markdown/blockquote-block.test.tsx
src/stores/workspace-store.test.tsx
```

### Bucket M — Medium (2–3 vi.mock, 15 files)

```
src/components/composer/message-composer.test.tsx (2)
src/components/layout/connection-status.test.tsx (2)
src/components/settings/ai-settings.test.tsx (2)
src/components/timeline/link-preview-list.test.tsx (2)
src/components/timeline/message-link-preview-card.test.tsx (2)
src/hooks/use-actors.test.ts (2)
src/hooks/use-auto-mark-as-read.test.ts (2)
src/hooks/use-draft-composer.test.ts (2)
src/hooks/use-draft-message.test.ts (2)
src/lib/markdown/code-block.test.tsx (2)
src/pages/workspace-select.test.tsx (2)
src/routes/index.test.tsx (2)
src/components/timeline/agent-session-event.test.tsx (3)
src/components/timeline/event-item.test.tsx (3)
src/components/ui/sonner.test.tsx (3)
```

### Bucket L — Larger (4–5 vi.mock, 10 files)

```
src/components/trace/trace-dialog.test.tsx (4)
src/components/workspace-settings/workspace-settings-dialog.test.tsx (4)
src/hooks/use-coordinated-stream-queries.test.ts (4)
src/pages/memory.test.tsx (4)
src/pages/user-setup.test.tsx (4)
src/components/editor/document-editor-modal.test.tsx (5)
src/components/layout/sidebar/sidebar-actions.test.tsx (5)
src/components/layout/sidebar/sidebar-footer.test.tsx (5)
src/components/stream-settings/stream-settings-dialog.test.tsx (5)
src/components/timeline/message-edit-form.test.tsx (5)
```

### Bucket XL — Complex (6+ vi.mock, 9 files)

```
src/components/timeline/message-input.test.tsx (6)
src/components/editor/editor-toolbar.test.tsx (7)
src/components/layout/sidebar/scratchpad-item.test.tsx (7)
src/components/quick-switcher/quick-switcher.integration.test.tsx (7)
src/components/timeline/message-event.test.tsx (7)
src/contexts/coordinated-loading-context.test.tsx (7)
src/components/settings/settings-dialog.test.tsx (8)
src/components/layout/sidebar/stream-item.test.tsx (8)
src/hooks/use-message-queue.test.ts (11)
```

Total: **52 test files** (plus 2 helper files for JSDoc/API updates = 55 overall touchpoints).

## Phases

Each phase: migrate the listed files, run tests, typecheck, lint, then commit. User compacts the session between phases.

### Phase 0 — Pre-flight baseline

1. `cd apps/frontend && bun run test 2>&1 | tail -20` — record pass count on origin/main.
2. `bun run typecheck` — verify clean.
3. `bun run lint 2>&1 | grep -c "warning"` — expect 159 `vi.mock` warnings (our baseline).
4. Commit is not needed at Phase 0 — just confirm baseline.

### Phase 1 — Foundation + pilot (2–3 files, ~5 call sites)

- Add `src/test/mocks/apply-spies.ts` (helper from Convention D).
- Re-export from `src/test/mocks/index.ts` (if present) or create barrel.
- Update JSDoc in `src/test/mocks/router.tsx` and `src/test/mocks/hooks.ts` to show the `applyModuleSpies` usage pattern (remove the old `vi.mock("...", () => createHooksMock())` example).
- Migrate pilot files to validate each convention:
  - `src/components/relative-time.test.tsx` (Convention A, simplest)
  - `src/hooks/use-unread-divider.test.ts` (Convention A, ts-only)
  - `src/hooks/use-workspace-emoji.test.ts` (Convention A, hook mock)
- Verify: tests pass for each file, no new lint errors, typecheck clean.
- Commit: `chore(frontend/tests): pilot vi.mock → spyOn migration (INV-48)`

### Phase 2 — Remaining Bucket S (15 files)

- Migrate everything else in Bucket S (18 − 3 pilot = 15).
- Verify after each file with `bun run test <path>`.
- Lint warning count drops by 15.
- Commit: `chore(frontend/tests): migrate simple vi.mock sites (INV-48)`

### Phase 3 — Bucket M part 1 (8 files)

- Take the first 8 Bucket M files (2-count first, then 3-count).
- Commit: `chore(frontend/tests): migrate 2-mock test files (INV-48)`

### Phase 4 — Bucket M part 2 (7 files)

- Remaining Bucket M.
- Commit: `chore(frontend/tests): migrate 3-mock test files (INV-48)`

### Phase 5 — Bucket L part 1 (5 files)

- 4-count files from Bucket L.
- Commit: `chore(frontend/tests): migrate 4-mock test files (INV-48)`

### Phase 6 — Bucket L part 2 (5 files)

- 5-count files from Bucket L.
- Commit: `chore(frontend/tests): migrate 5-mock test files (INV-48)`

### Phase 7 — Bucket XL part 1 (4 files)

- 6–7 count files (first four):
  - `message-input.test.tsx`
  - `editor-toolbar.test.tsx`
  - `scratchpad-item.test.tsx`
  - `quick-switcher.integration.test.tsx`
- Commit: `chore(frontend/tests): migrate complex mock-heavy files part 1 (INV-48)`

### Phase 8 — Bucket XL part 2 (5 files)

- Remaining XL:
  - `message-event.test.tsx` (7)
  - `coordinated-loading-context.test.tsx` (7)
  - `settings-dialog.test.tsx` (8)
  - `stream-item.test.tsx` (8)
  - `use-message-queue.test.ts` (11)
- Commit: `chore(frontend/tests): migrate remaining complex mock-heavy files (INV-48)`

### Phase 9 — Promote rule to error

1. In `eslint/threa-plugin.js`:
   - Update `viMockRestrictedSyntax.message`: drop "Will be promoted to error after migration."
   - Update the preceding comment block accordingly.
2. In `apps/frontend/eslint.config.js`:
   - Change `["warn", viMockRestrictedSyntax]` → `["error", viMockRestrictedSyntax]`.
   - Update top-of-file doc comment: remove "vi.mock warns until existing usage is migrated" → "no vi.mock" language parallel to mock.module.
3. Run `bun run lint`, expect 0 errors, 0 `vi.mock` warnings.
4. Run `bun run typecheck` and `bun run test` — full green.
5. Commit: `chore(eslint): promote vi.mock rule from warn to error (INV-48)`

### Phase 10 — Final verification + push

- `bun run --cwd apps/frontend lint` (0 errors)
- `bun run --cwd apps/frontend typecheck` (clean)
- `bun run --cwd apps/frontend test` (all green)
- `bun run --cwd apps/backend lint` (make sure nothing backend-side broke — unlikely since no backend changes)
- Optional: E2E smoke (`bun run test:e2e`) only if a migrated test looked particularly risky.
- `git push -u origin claude/vi-mock-migration`

## Per-Phase Checklist (apply to every phase)

1. `cd apps/frontend`
2. Open each file, identify vi.mock pattern, apply the relevant Convention (A–F).
3. Add `afterEach(() => vi.restoreAllMocks())` if not already present.
4. Remove now-unused factory-only imports.
5. Run the specific test file: `bun run test <relative-path>`.
6. If failures: diagnose (live-binding issue? missing provider? `vi.hoisted` leftover?) and fix in-place.
7. After all files in the phase are green, run: `bun run test` (full suite) and `bun run typecheck`.
8. `bun run lint` — warnings only, no errors. Warning count decreases.
9. Commit on `claude/vi-mock-migration` (no `--no-verify` unless a pre-existing hook issue recurs; check typecheck + lint both green first).
10. Stop and notify user that the phase is complete and the session is ready to compact.

## Known Risks / Watchpoints

- **`dexie-react-hooks` in `workspace-store.test.tsx`** — may need harness replacement (Convention E) rather than spy.
- **Default exports** (e.g., `vi.mock("react-router-dom", () => ({ default: ... }))`) — spy `vi.spyOn(ns, "default")` rarely works; use namespace re-import or harness.
- **`sonner.test.tsx`** — Toaster itself is being tested; use real `<Toaster />` harness (Convention E).
- **Hoisted mock state** — when a test has `const foo = vi.hoisted(() => ...)`, unhoisting may change evaluation order. Verify the test still sets up state correctly.
- **`@tiptap/*` modules** — editor-related tests mock these heavily. Namespace spyOn works; watch for ESM interop warnings.

## Resume-From-Anywhere

If the session is compacted mid-phase:

1. `git status` — find the current branch (`claude/vi-mock-migration`).
2. `git log --oneline -10` — identify last completed phase by the commit message.
3. `grep -rln "vi\.mock" apps/frontend/src --include="*.ts" --include="*.tsx" | wc -l` — remaining files.
4. Cross-reference with the File Inventory above to find the next bucket.
5. Continue from the corresponding phase.

## Done Criteria

- [ ] 0 `vi.mock(` occurrences in `apps/frontend/src/**/*.{ts,tsx}` (except JSDoc if any remains, though the goal is none).
- [ ] `apps/frontend/eslint.config.js` has `viMockRestrictedSyntax` at `"error"` level.
- [ ] `bun run --cwd apps/frontend lint` — 0 errors, 0 `no-restricted-syntax` warnings for `vi.mock`.
- [ ] `bun run --cwd apps/frontend typecheck` — clean.
- [ ] `bun run --cwd apps/frontend test` — all green (no new skips, no regressions vs. origin/main baseline).
- [ ] Branch `claude/vi-mock-migration` pushed to origin.
