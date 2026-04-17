# Floating Message Input

## Context

The UI feels cramped — the message input currently sits in a bordered box glued to the bottom of the scroll area, and every message vanishes at the box's top edge. We want the input to feel like a floating pill instead: messages scroll *under* the pill and briefly appear *below* it (in the gap between pill and viewport bottom) before leaving the scroll area, while the default resting position of the most recent message stays visually offset above the pill exactly as it is today. Same behaviour on mobile and desktop, in the main stream view and the thread panel, for real streams and for every kind of draft (scratchpad, channel, DM, thread). All composer controls (toolbar, Aa, emoji, @, attach, send, expand-to-fullscreen, mobile formatting drawer) must keep behaving exactly as today.

## Approach

Turn the composer wrapper into an absolutely-positioned floating pill inside the existing `data-editor-zone` container, reserve space for it inside the scroll content (Virtuoso Footer for virtualized lists, `padding-bottom` for plain-scroll fallbacks), and publish the measured composer height as a CSS custom property so the spacer keeps pace with height changes (mobile-expanded 75dvh, attachments row, formatting drawer, error message). The composer component itself does not change — it already renders as a rounded pill.

## Files to modify

### `apps/frontend/src/components/timeline/message-input.tsx` (~line 459)

- Remove the `border-t` wrapper around the composer pill. Replace with an absolute-positioned wrapper that sits at the bottom of the scroll area with a small gap.
  - New root: `<div ref={selfRef} data-message-composer-root className={cn("pointer-events-none absolute inset-x-0 bottom-0 z-20", expanded && "hidden")}>`
  - Inner centered container keeps `pt-3 px-3 pb-3 sm:px-6 sm:pb-4 mx-auto max-w-[800px] w-full min-w-0 pointer-events-auto` (pb-1 → pb-3/4 gives the "messages briefly appear below" space).
- Add a `ResizeObserver` on `selfRef` that writes `--composer-height` (in px) onto the closest `[data-editor-zone]` ancestor. Clean up on unmount.
- While `expanded`, set `--composer-height` to `0px` (or skip observing) so the Virtuoso Footer collapses behind the fullscreen overlay.
- No changes to `MessageComposer` itself (INV-38, INV-36): all toolbars and controls continue to work untouched.

### `apps/frontend/src/components/timeline/stream-content.tsx`

- Restructure `stream-content.tsx:606-754`: the outer `<div className="flex h-full flex-col">` becomes `<div className="relative h-full">`. The scroll wrapper stays `relative h-full overflow-hidden` (fills the parent). `MessageInput` becomes an absolute-positioned sibling — no longer taking flex space.
- `JoinChannelBar` (lines 737-744): keep as a sibling, but position it absolutely just above the composer pill (e.g. `absolute inset-x-0 bottom-[var(--composer-height,0px)] z-10`), so it never reclaims layout space from the scroll area.
- **Jump-to-latest button (lines 728-735)**: change `bottom-4` → `bottom-[calc(var(--composer-height,0px)+0.5rem)]` so it floats above the pill.
- **Loading "Loading newer messages" pill (lines 675-685)**: same offset — currently uses `bottom-16` / `bottom-2`. Rebase on `--composer-height`.
- **Virtualized path (line 1004)**: add `components={{ Footer: VirtuosoFooterSpacer }}` where `VirtuosoFooterSpacer = () => <div style={{ height: "var(--composer-height, 0px)" }} aria-hidden />`. Confirm `atBottomThreshold={30}` and `followOutput` still behave — Footer is treated as content by Virtuoso, so "at bottom" means "Footer in view", which is exactly what we want (last message offset above the pill at rest).
- **Plain-scroll fallback (line 689)**: add `style={{ paddingBottom: "var(--composer-height, 0px)" }}` (or Tailwind arbitrary `pb-[var(--composer-height,0px)]`).
- **Draft scratchpad scroll (line 612)**: same `padding-bottom: var(--composer-height)` treatment.

### `apps/frontend/src/components/thread/stream-panel.tsx` (lines 327-420, draft branch)

- Replace the flex-column with `relative flex-1` + absolutely-positioned composer (mirror the main stream change). The `SidePanelContent` already has `data-editor-zone="panel"` — that's where `--composer-height` gets written by the draft composer's own observer.
- Drop `border-t` from line 393 wrapper. Make the scroll div (line 361) add `padding-bottom: var(--composer-height, 0px)`.
- The draft branch builds its own `<MessageComposer>` inline instead of using `<MessageInput>`. Extract the small ResizeObserver logic into a shared hook: **new file** `apps/frontend/src/hooks/use-composer-height-publish.ts` that takes a `ref` and publishes `--composer-height` onto the nearest `[data-editor-zone]`. Reuse from both `message-input.tsx` and the draft branch in `stream-panel.tsx`.
- Keep the draft expanded overlay (lines 332-360) as-is — it already uses `absolute inset-0 z-30`, which sits above the floating pill (z-20).

## Shared hook

**New:** `apps/frontend/src/hooks/use-composer-height-publish.ts`

```ts
export function useComposerHeightPublish(
  ref: React.RefObject<HTMLElement | null>,
  { active = true }: { active?: boolean } = {}
) {
  useEffect(() => {
    const el = ref.current
    if (!el || !active) return
    const zone = el.closest<HTMLElement>("[data-editor-zone]")
    if (!zone) return
    const write = (h: number) => zone.style.setProperty("--composer-height", `${h}px`)
    write(el.getBoundingClientRect().height)
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? el.getBoundingClientRect().height
      write(h)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      zone.style.removeProperty("--composer-height")
    }
  }, [ref, active])
}
```

- Scoping via `[data-editor-zone]` means main-stream composer writes to `<main>` and panel draft composer writes to `SidePanelContent`. Each scroll area consumes its own scope's variable — no cross-pollination between main view and thread panel even when both are open.
- `active=false` while expanded disposes the observer and clears the variable (Footer collapses to 0).

## Expanded overlay interaction

- Floating pill: `z-20`.
- Expanded fullscreen overlay (portaled into `data-editor-zone`): `z-30`, `bg-background`, `absolute inset-0` — already covers the pill. No change needed.
- When expanded, clear `--composer-height` so the Virtuoso Footer spacer collapses (scroll area returns to full height, hidden behind the overlay anyway).

## Pointer events

- Absolute wrapper gets `pointer-events-none`; the inner pill container gets `pointer-events-auto`. The gap around the pill remains click-through, so hover/right-click on messages visible below the pill still works.

## Mobile-expanded composer

- Composer's own `max-h-[75dvh] min-h-[75dvh]` transition grows the pill upward. With absolute positioning from `bottom-0`, the pill grows up from the bottom naturally. The ResizeObserver picks up the new height and the Virtuoso Footer spacer tracks it — messages reflow so the most recent one still sits just above the pill.

## `JoinChannelBar`

- Positioned `absolute inset-x-0 bottom-[var(--composer-height,0px)] z-10` so it docks above the pill. It won't cause layout shift, but we should verify its contents remain visible when the pill is tall on mobile — if it overlaps the pill in pathological cases, add a subtle opaque background.

## Verification

1. `bun install` already ran via SessionStart.
2. `bun run --cwd apps/frontend dev` (or equivalent) — open the main stream view.
3. Manual checks:
   - Default view: last message sits offset above the pill (same spacing as today).
   - Scroll up: messages pass under the pill and are briefly visible in the gap below it.
   - Jump-to-latest button renders above the pill, not clipped.
   - Attachments row + formatting drawer on mobile still grow the pill correctly; messages reflow.
   - Thread panel: open a draft thread, verify same floating behaviour; open a real thread, verify `StreamContent` floats the same way.
   - Drafts: new scratchpad, channel draft, DM draft, thread draft — each composes fine; auto-save unchanged.
   - Expand-to-fullscreen: overlay covers the pill and the scroll area; collapse restores the pill and the scroll offset.
   - Mobile virtual keyboard (dvh): pill stays above the keyboard; messages reflow.
4. `bun run test` for unit/integration.
5. `bun run test:e2e` — particularly any suite touching composer, scroll, or thread panel.

## Risks

- **Virtuoso Footer + `followOutput: "auto"`**: confirm auto-scroll still lands "at bottom" with the Footer present. Footer is part of content, so `followOutput` scrolls so Footer is in view — which visually means last message sits just above the pill. This is the desired behaviour, not a regression.
- **Dynamic `--composer-height` during scroll**: if the pill height changes mid-scroll (e.g. attachment added), Virtuoso re-measures the Footer; brief layout jump possible. Acceptable — matches today's behaviour when the bordered box grows.
- **CSS variable absence**: fallback `var(--composer-height, 0px)` ensures no layout breakage before the observer fires on first paint.
