# Reaction Details: Who Reacted With What

## Context

Users can toggle reactions on messages, but there is currently no way to see **who** reacted. `message-reactions.tsx:108-148` shows at most a truncated `Tooltip` like "Alice, Bob and 3 more" on desktop, and **nothing at all** on mobile (the tooltip is suppressed when `useIsMobile()` is true). This is worse than Slack, which shows a full details popover on hover (desktop) and a bottom sheet on long-press (mobile).

Goal: match Slack's UX. Hover a reaction pill on desktop → popover listing each user who reacted with that emoji. Long-press a reaction pill on mobile → bottom sheet with the same info, plus the ability to cycle between emojis.

Happily, the heavy lifting already exists: `AllReactionsPopover` (`apps/frontend/src/components/timeline/all-reactions-popover.tsx`) already renders tabbed reactor lists and is used for the "+N" overflow chip. The data is already on the message (`reactions: Record<emoji, userIds[]>`) and `useActors().getActorName()` resolves user IDs. No backend or type changes are needed.

## Approach

### 1. Extract a shared content component

Refactor `all-reactions-popover.tsx` by splitting the emoji-tabs + user-list body into a new exported component:

```tsx
// apps/frontend/src/components/timeline/reaction-details-content.tsx
export function ReactionDetailsContent({
  reactions,
  workspaceId,
  defaultEmoji,   // NEW: preselect a specific emoji tab
}: Props)
```

This is the same JSX that currently lives inside `PopoverContent` in `all-reactions-popover.tsx:52-105`. Move `sortedEntries`, `selectedEmoji`, `displayedUsers`, and the tab/list markup into the new component. Initialize `selectedEmoji` from `defaultEmoji` when provided.

`AllReactionsPopover` becomes a thin wrapper: `<Popover>…<PopoverContent><ReactionDetailsContent .../></PopoverContent></Popover>` with no `defaultEmoji`. Its overflow-button usage in `message-reactions.tsx:66-75` is unchanged.

### 2. New `ReactionPillDetails` wrapper component (same file as content, or `reaction-details.tsx`)

```tsx
<ReactionPillDetails emoji={shortcode} reactions={...} workspaceId={...}>
  {pill /* the <button> */}
</ReactionPillDetails>
```

Internally branches on `useIsMobile()`:

- **Desktop**: wrap `children` in Shadcn `HoverCard` (`components/ui/hover-card.tsx`, already present) with `openDelay={350}` `closeDelay={120}`. `<HoverCardContent className="w-[260px] p-0" side="top" align="start">` renders `<ReactionDetailsContent defaultEmoji={emoji} />`. HoverCardTrigger with `asChild` preserves the button's `onClick` (toggle reaction still works on click).
- **Mobile**: wrap `children` in Shadcn `Drawer` (`components/ui/drawer.tsx`, already used by `message-action-drawer.tsx`), with controlled `open` state. `useLongPress({ onLongPress: () => setOpen(true), threshold: 500 })` attaches handlers to the pill via a wrapper `<span>` (the Drawer doesn't provide a trigger we need — we spread long-press handlers onto the pill wrapper). Tap still toggles reaction; long-press opens the drawer. Drawer body renders `<ReactionDetailsContent defaultEmoji={emoji} />` plus a standard drawer header.

Rationale for Drawer over Popover on mobile: matches Slack (bottom sheet), and the app already uses `Drawer` for long-press mobile actions (`message-action-drawer.tsx`), keeping patterns consistent.

### 3. Wire into `message-reactions.tsx`

In `ReactionPill` (`message-reactions.tsx:104-150`):

- Remove the existing `Tooltip`/`TooltipTrigger`/`TooltipContent` block and the `tooltipText` memo (lines 108-112, 142-149).
- Remove the `if (isMobile) return pill` early-return.
- Always wrap the pill in `<ReactionPillDetails emoji={shortcode} reactions={allReactions} workspaceId={workspaceId}>` — which means `ReactionPill` now needs access to the full `reactions` record (and `shortcode`), not just `userIds` and the resolved emoji. Update `ReactionPillProps` and the call site at line 54-64 accordingly: pass `shortcode` and `reactions` through.
- Drop the `isMobile` prop from `ReactionPillProps` since the wrapper handles it. Keep the existing desktop hover fade-to-X behavior by reading `useIsMobile()` inside `ReactionPill` instead (or keep passing it — minor stylistic choice; keep passing to avoid an extra hook call per pill).

### 4. Files to modify

- `apps/frontend/src/components/timeline/all-reactions-popover.tsx` — extract body into `ReactionDetailsContent`, make it a thin wrapper.
- `apps/frontend/src/components/timeline/reaction-details.tsx` (**new**) — exports `ReactionDetailsContent` and `ReactionPillDetails`.
- `apps/frontend/src/components/timeline/message-reactions.tsx` — use `ReactionPillDetails`, drop Tooltip path, thread `shortcode` + `reactions` into `ReactionPill`.

No new dependencies; `hover-card.tsx`, `drawer.tsx`, `popover.tsx`, `use-long-press.ts`, `use-mobile.tsx`, `useActors`, and `useWorkspaceEmoji` are all in place.

### 5. Reused existing utilities

- `useLongPress` (`apps/frontend/src/hooks/use-long-press.ts`) — mobile trigger with haptic + scroll cancel
- `useIsMobile` (`apps/frontend/src/hooks/use-mobile.tsx`) — platform branch
- `useActors().getActorName()` — ID → name resolution
- `useWorkspaceEmoji().toEmoji()` — shortcode → unicode
- Shadcn `HoverCard`, `Drawer` — already styled primitives

## Verification

1. `bun run test --filter frontend` — all existing frontend unit tests still pass (no reaction-specific suite exists; nothing should regress in `message-event.test.tsx` etc.).
2. Manual desktop (`bun run dev`):
   - Hover a reaction pill → popover appears after ~350ms with reactor names and the tab for that emoji preselected. Move pointer away → closes.
   - Click the pill → reaction still toggles (own reaction adds/removes correctly).
   - "+N" overflow chip still opens `AllReactionsPopover` with no default tab.
3. Manual mobile (DevTools mobile emulation or real device):
   - Tap a pill → toggles reaction, no drawer.
   - Long-press (500ms) → bottom drawer opens showing the tapped emoji's reactors; tab bar lets you switch emojis.
   - Scroll while pressing → drawer does not open (long-press cancels past 10px).
4. Regression check: `AllReactionsPopover` used by overflow button still renders identically.
