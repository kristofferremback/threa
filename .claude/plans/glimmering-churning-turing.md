# Mobile Pull-Up Tab (Drawer) Overhaul

## Context

Mobile drawers (context menus, settings, message actions, sidebar actions, attachment menu, emoji picker, memory detail, editor, trace viewer, alert dialogs) are inconsistently sized and **do not scroll correctly** when content exceeds the default height. Two divergent patterns exist:

1. **`ResponsiveDialog`** → uses vaul snap points `[0.8, 1]` with `h-[100dvh]` DrawerContent. Dragging-to-expand works, but scrolling at the 0.8 snap is broken: the internal scroll container is 100vh tall while only ~80vh is visible, so the **last ~20vh of content is permanently off-screen** until the user expands to full height.
2. **Direct `Drawer`/`DrawerContent` usage** (majority of call sites) → no snap points, uses `max-h-[85dvh]` which caps the drawer height and disables drag-to-expand. No path to full screen.

Root cause of the main user complaint (content not scrollable at default size): vaul uses `translate3d()` for fractional snap points, so the drawer is always 100dvh in the DOM but translated partially off-screen. The scrollable inner container needs its visible height bound to the current snap — otherwise the "bottom" of the scroll region is never on-screen.

Goal: one consistent drawer primitive where every pull-up tab opens at ~80%, is fully scrollable at that height, can be dragged to full screen, closes with inertia / backdrop tap / notch pull-down, and has breathing room at the bottom.

## Audit — current behavior vs. requirements

| Requirement | Status | Notes |
|---|---|---|
| Default open at 70–80% | Partial | `ResponsiveDialog` defaults to `0.8`. Direct `Drawer` sites use `max-h-[85dvh]` (close, but can't be expanded). |
| Drag to full screen | Partial | `ResponsiveDialog` only. Direct sites are height-capped. |
| Visible content fully scrollable at default height | **Broken** | Main bug. At 0.8 snap with `h-[100dvh]`, scroll container extends past the visible region. `max-h-[85dvh]` sites scroll only if children apply `flex-1 min-h-0 overflow-y-auto` (inconsistent). |
| Notch at top for pull-down-to-close | Works | `DrawerContent` already renders `<div class="mx-auto mt-4 h-2 w-[100px] rounded-full bg-muted" />` at `apps/frontend/src/components/ui/drawer.tsx:49`. |
| Tap outside to close | Works | vaul `DrawerOverlay` default behavior. |
| Close with inertia | Works | vaul native drag physics. |
| Bottom padding so content isn't flush with the edge | Partial | Only footers (`pb-[max(16px,env(safe-area-inset-bottom))]`) and a few ad-hoc `pb-8`s. No systematic padding on scroll body. |

## Design — a single drawer primitive

### Core idea

Extend `apps/frontend/src/components/ui/drawer.tsx` so that every pull-up tab shares one snap-aware, scroll-safe structure. Sites only choose which body content to render; snap points, notch, scroll wrapper, and padding are handled centrally.

### New/changed components in `drawer.tsx`

1. **`Drawer` (root)** — change defaults:
   - Default `snapPoints={[0.8, 1]}` (can be overridden via prop; pass `snapPoints={undefined}` to opt out).
   - Manage `activeSnapPoint` state internally when `snapPoints` is set and `activeSnapPoint` isn't externally controlled.
   - Expose `activeSnapPoint` via a new `DrawerSnapContext` so the body can size itself.
   - Keep existing `repositionInputs={false}` (documented keyboard/dvh interaction).

2. **`DrawerContent`** — become the full-height, flex-column shell:
   - Always `h-[100dvh]` (already required for vaul transform-based snap math).
   - Render notch → optional header slot → `DrawerBody` as children, in a `flex flex-col`.
   - Keep notch visible and draggable (vaul drag is on the whole DrawerContent by default; notch remains a visual affordance).

3. **`DrawerBody` (new)** — the scroll-safe inner region, consumed by all call sites:
   - Reads `activeSnapPoint` from context.
   - Computes an inline `max-height` equal to `calc(100dvh * activeSnap - headerHeight - notchHeight)` when snap is a fractional number, or full when snap is `1` / a string CSS value. This is the fix that makes the visible portion fully scrollable at the default 0.8 snap.
   - Renders `<div data-vaul-no-drag class="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-[max(24px,env(safe-area-inset-bottom))]">`.
   - `pb-[max(24px,env(safe-area-inset-bottom))]` gives bottom breathing room above the home indicator (interpreting "bottom padding so bottom content can be centered" as: last item should not sit flush with the visible bottom edge).

4. **`DrawerHeader`** — unchanged API, but rendered as `flex-none` so flex math is predictable. Keep it outside the scroll region so the notch + title remain sticky at the top.

### Migration of call sites

Replace each site's hand-rolled structure with `<DrawerContent>` + `<DrawerHeader>` (optional) + `<DrawerBody>`. Drop `max-h-[85dvh]` and local `overflow-y-auto` plumbing — the primitive owns it.

Call sites to update:

- `apps/frontend/src/components/ui/responsive-dialog.tsx` — already close; remove redundant `h-[100dvh]` (now owned by DrawerContent), ensure it forwards children into `DrawerBody` or lets callers opt out for edge cases (editor/trace viewer that need custom layouts).
- `apps/frontend/src/components/ui/responsive-alert-dialog.tsx:56` — drop `max-h-[85dvh]`, adopt snap points.
- `apps/frontend/src/components/layout/sidebar/sidebar-actions.tsx:181` — stream/channel context menu.
- `apps/frontend/src/components/timeline/message-action-drawer.tsx:154` — message context menu (already has the `expanded` toggle hack; replace with snap points).
- `apps/frontend/src/components/timeline/unsent-message-action-drawer.tsx:37`
- `apps/frontend/src/components/timeline/attachment-list.tsx:81` — image actions.
- `apps/frontend/src/components/timeline/reaction-emoji-picker.tsx:576`
- `apps/frontend/src/components/timeline/reaction-details.tsx`
- `apps/frontend/src/components/timeline/message-edit-form.tsx:199` — currently toggles `!h-[100dvh]` manually; replace with snap points.
- `apps/frontend/src/components/timeline/unsent-message-edit-form.tsx:184`
- `apps/frontend/src/pages/memory.tsx:773` — memory detail panel (already has `flex-1 min-h-0 overflow-y-auto`; migrate to `DrawerBody`).

### Opt-outs

Two sites currently expand to full height on demand (`message-edit-form`, `unsent-message-edit-form`) because a ProseMirror editor + virtual keyboard needs predictable height. These can pass `snapPoints={[1]}` or keep the existing toggle — confirm during implementation.

## Critical files to modify

- `apps/frontend/src/components/ui/drawer.tsx` — primitive changes (root defaults, `DrawerContent` shell, new `DrawerBody`, snap context).
- `apps/frontend/src/components/ui/responsive-dialog.tsx` — simplify; state moves down to `Drawer` root.
- `apps/frontend/src/components/ui/responsive-alert-dialog.tsx` — simplify; use new `DrawerBody`.
- All 10 call sites listed above.
- Existing drawer tests: `memory.test.tsx`, `message-edit-form.test.tsx`, `sidebar-actions.test.tsx`, `sidebar-footer.test.tsx`, `stream-item.test.tsx` — update any assertions that reference `max-h-[85dvh]`.

## Reuse / existing patterns

- `useIsMobile` (`apps/frontend/src/hooks/use-mobile.tsx`) — already gates drawer vs dialog.
- vaul's `snapPoints` / `activeSnapPoint` / `setActiveSnapPoint` / `fadeFromIndex` — already used correctly in `responsive-dialog.tsx`; lift the same pattern into `Drawer` root.
- `data-vaul-no-drag` convention — already used in `message-action-drawer.tsx:362` and `memory.tsx:785`; codified in `DrawerBody`.
- Safe-area inset helper pattern `pb-[max(Npx,env(safe-area-inset-bottom))]` — already used in `ResponsiveDialogFooter`; reuse in `DrawerBody`.

## Verification

1. **Unit / RTL** — update tests that asserted old `max-h-[85dvh]` class; add a test that mounts a tall drawer (content > viewport), asserts `overflow-y-auto` scroll container exists and has a bounded max-height tied to active snap.
2. **Manual on mobile breakpoint (< 640px)** via `bun run dev`:
   - Open each of the 10 drawer sites.
   - Verify: opens at ~80%, notch visible, bottom of content reachable by scrolling at 80% snap, drag-up to full screen snaps cleanly, drag-down from notch closes with inertia, tap on backdrop closes, last item has ~24px breathing room above home indicator, virtual keyboard (in editor sites) doesn't cause height collapse.
   - Test long-content case (message-action-drawer expanded, memory detail with many memos, reaction list with many reactions).
3. **E2E**: run `bun run test:e2e` — Playwright mobile viewport suite will catch regressions on drawer-dependent flows (message actions, sidebar actions). Add one spec that scrolls to the bottom of a long drawer at the default snap.
4. **Desktop sanity** — confirm desktop Dialog path is untouched (ResponsiveDialog + ResponsiveAlertDialog still render Radix Dialog at ≥ 640px).
