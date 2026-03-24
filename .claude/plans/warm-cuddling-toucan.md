# Message Reactions — Implementation Plan

## Context

The backend for message reactions is already complete: dedicated `reactions` table, repository methods, event service with outbox pattern, API endpoints, and socket event handling. The frontend socket handlers and API client methods also exist. What's missing is the entire frontend UI — no reaction display on messages, no emoji picker for adding reactions, and no mobile reaction support.

This plan adds Slack-style reaction UX: emoji pills below messages, a reaction button in the message toolbar, an emoji picker popover, mobile support via the action drawer, and a "view all reactions" dialog.

## Step 1: Wire reactions into MessagePayload

**File:** `apps/frontend/src/components/timeline/message-event.tsx`

- Add `reactions?: Record<string, string[]>` to the `MessagePayload` interface (line 29)
- This connects the already-cached reaction data (from socket handlers) to message rendering

## Step 2: Create `ReactionEmojiPicker` component

**New file:** `apps/frontend/src/components/timeline/reaction-emoji-picker.tsx`

A standalone emoji picker popover for reactions, adapted from the editor's `EmojiGrid`. Key differences from the editor version:
- Not coupled to TipTap's `SuggestionListRef` — uses Popover/Floating UI directly
- Anchored to a trigger button (the smiley icon or a pill's "+")
- Includes search/filter input at top
- Uses `useWorkspaceEmoji()` for emoji data and `useEmojiSuggestion`-style sorting
- Calls `messagesApi.addReaction()` on selection and closes
- Uses Radix Popover (from Shadcn) for the container, Floating UI for smart positioning
- Renders the same virtualized `EmojiButton` grid pattern

**Reuse:** Emoji data from `useWorkspaceEmoji(workspaceId)`, sorting logic from `use-emoji-suggestion.tsx`

## Step 3: Create `MessageReactions` display component

**New file:** `apps/frontend/src/components/timeline/message-reactions.tsx`

Renders reaction pills below message content. Props: `reactions: Record<string, string[]>`, `workspaceId`, `messageId`, `currentUserId`.

Behavior:
- Sort by count (descending), show top 5 unique emojis as pills
- Each pill: `[emoji] [count]` — highlighted if current user has reacted
- Click pill → toggle reaction (add if not reacted, remove if already reacted) via `messagesApi`
- If more than 5 unique emojis, show a `+N more` pill that opens the "all reactions" dialog
- Show a small `+` (add reaction) button at the end of the pills row that opens the `ReactionEmojiPicker`
- Use `WorkspaceEmoji` or `toEmoji()` to render shortcodes as emoji characters
- Use `Tooltip` from Shadcn on each pill to show who reacted (names from `useActors`)

## Step 4: Create `AllReactionsPopover` component

**New file:** `apps/frontend/src/components/timeline/all-reactions-popover.tsx`

A popover anchored near the reaction pills showing all reactions grouped by emoji (like Slack's reaction detail).

- Tab-like filter row: "All" + one chip per emoji — clicking filters to that emoji's reactors
- Below: list of users who reacted (with avatar + name), filtered by selected emoji tab
- Uses `useActors` to resolve user IDs to display names
- Uses Radix Popover (Shadcn) for container, anchored to the "+N more" pill or a dedicated trigger
- Lightweight and contextual — no full-screen dialog

## Step 5: Add reaction button to desktop message toolbar

**File:** `apps/frontend/src/components/timeline/message-event.tsx`

In `SentMessageEvent`, modify the `actions` prop passed to `MessageLayout`:
- Add a smiley-face (`SmilePlus` from lucide) button to the LEFT of the existing `MessageContextMenu` button
- Both buttons in the same hover-reveal container
- Clicking the smiley opens `ReactionEmojiPicker` anchored to the button
- The picker uses Floating UI with `flip()` and `shift()` middleware so it stays visible regardless of message position

## Step 6: Add reactions to mobile action drawer

**File:** `apps/frontend/src/components/timeline/message-action-drawer.tsx`

- Add a row of 6 quick-reaction emoji buttons at the top of the drawer (between the message preview and the action list). Uses personalized sorting from `emojiWeights` in workspace bootstrap, falling back to common defaults (thumbs up, heart, laugh, surprised, sad, fire) when no usage data exists
- Add an "Add reaction" action item that opens the full emoji picker in a nested drawer or modal
- Pass `workspaceId`, `messageId`, and `onReact` callback through `MessageActionContext`

**File:** `apps/frontend/src/components/timeline/message-actions.ts`
- Add `workspaceId`, `messageId` to `MessageActionContext` if not already present (messageId is there, workspaceId is not)
- Add `onReact?: (emoji: string) => void` callback

## Step 7: Integrate `MessageReactions` into message layout

**File:** `apps/frontend/src/components/timeline/message-event.tsx`

In `SentMessageEvent`, render `MessageReactions` between the message content and the thread footer:
- Pass it as part of the `footer` prop or as a separate element after the `MessageLayout`
- Only render when `payload.reactions` has entries
- Pass `currentUserId` so it can highlight the user's own reactions

## Step 8: Mobile long-press on reaction pill

**File:** `apps/frontend/src/components/timeline/message-reactions.tsx`

- On mobile, long-pressing a reaction pill opens the `AllReactionsPopover` to see who reacted
- Tapping a pill still toggles the reaction (same as desktop click)
- Use existing `useLongPress` hook

## Files Summary

### New files
1. `apps/frontend/src/components/timeline/reaction-emoji-picker.tsx` — Standalone emoji picker popover
2. `apps/frontend/src/components/timeline/message-reactions.tsx` — Reaction pills display
3. `apps/frontend/src/components/timeline/all-reactions-popover.tsx` — "View all reactions" popover

### Modified files
1. `apps/frontend/src/components/timeline/message-event.tsx` — Add `reactions` to payload, render `MessageReactions`, add reaction button to toolbar
2. `apps/frontend/src/components/timeline/message-action-drawer.tsx` — Quick-reaction row at top
3. `apps/frontend/src/components/timeline/message-actions.ts` — Add `workspaceId` and `onReact` to context
4. `apps/frontend/src/components/timeline/message-context-menu.tsx` — No changes needed (reaction button is separate)

### Existing code to reuse
- `useWorkspaceEmoji(workspaceId)` from `hooks/use-workspace-emoji.ts` — emoji data + lookup
- `messagesApi.addReaction/removeReaction` from `api/messages.ts` — API calls
- `useLongPress` from `hooks/use-long-press.ts` — mobile long-press gesture
- `useActors` from `hooks/use-actors.ts` — resolve user IDs to names for tooltips
- `EmojiButton` pattern from `editor/triggers/emoji-grid.tsx` — virtualized emoji rendering
- `useVirtualizer` from `@tanstack/react-virtual` — for large emoji grid
- Floating UI (`useFloating`, `flip`, `shift`, `offset`) — picker positioning
- Shadcn `Popover`, `Tooltip`, `Button` — UI primitives

## Verification

1. **Desktop**: Hover a message → see smiley button left of 3-dot menu → click → emoji picker opens anchored to button → select emoji → pill appears below message → click pill to toggle → hover pill to see tooltip with names
2. **Mobile**: Long-press message → drawer opens with quick-reaction row at top → tap emoji → reaction added → long-press a reaction pill → see all reactions dialog
3. **Multiple reactions**: Add 6+ different emojis → only 5 pills shown + "+N more" → click "+N more" → all reactions popover opens showing grouped reactors
4. **Real-time**: Have another user add a reaction → pill appears in real-time via existing socket handlers
5. **Run tests**: `bun run test` and `bun run test:e2e` to verify nothing breaks
