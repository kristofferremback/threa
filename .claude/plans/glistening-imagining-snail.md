# Mobile Partial Quote Reply via Expandable Preview

## Context

On desktop, users can highlight text in messages and a floating "Quote" button appears to create partial quotes. On mobile, text selection is disabled (`select-none`) because long-press opens the message context menu (Vaul bottom-sheet drawer). Currently, mobile can only quote the full message via the "Quote reply" action or swipe-to-quote.

The goal is to let mobile users select specific text to quote by making the message preview in the context menu drawer expandable into a full message view with text selection.

## Approach: Two-mode Drawer

Add an `expanded` state to `MessageActionDrawer`. Tapping the preview toggles the drawer into a "selection mode" where the full message is shown with text selection enabled.

### Normal mode (current behavior)
- Message preview (author + 2-line clamp)
- Quick reactions row
- Action list (quote reply, edit, delete, etc.)

### Expanded/selection mode (new)
- Header: back arrow + "Select text to quote"
- Full message content, scrollable, with text selection enabled
- Floating "Quote" button at bottom when text is selected

## Key Technical Solution: `data-vaul-no-drag`

The critical challenge is that Vaul captures touch events for drag-to-dismiss, which conflicts with text selection. Vaul supports a `data-vaul-no-drag` attribute on child elements — this tells the drawer to ignore drag events originating from that element. We apply this to the expanded message content area, allowing native text selection and scrolling to work within the drawer while the handle still allows dismissal.

## Files to Modify

### 1. `apps/frontend/src/components/timeline/message-action-drawer.tsx`
Main changes:

- Add `expanded` boolean state, reset to `false` in `onOpenChange`
- **Normal mode**: Make the preview section tappable (add `onClick={() => setExpanded(true)}` and visual affordance — small "Tap to select quote" hint text or expand icon in preview corner). Only show this affordance when `context.onQuoteReplyWithSnippet` exists (i.e., quote reply is available)
- **Expanded mode**: Replace entire drawer body with:
  - Header row: back button (ChevronLeft icon) + "Select text to quote" title
  - Scrollable content area with `data-vaul-no-drag` attribute and `select-text` CSS class
  - Full message rendered via `<MarkdownContent content={context.contentMarkdown} />`
  - Fixed footer with "Quote" button, enabled only when text is selected
- Track text selection via `selectionchange` event listener (similar pattern to `text-selection-quote.tsx` but scoped to the expanded content ref)
- On "Quote" tap: call `context.onQuoteReplyWithSnippet(selectedText)`, then `onOpenChange(false)`
- On "Back" tap: `setExpanded(false)`, clear selection

### 2. `apps/frontend/src/components/timeline/message-actions.ts`
- Add to `MessageActionContext`:
  ```ts
  onQuoteReplyWithSnippet?: (snippet: string) => void
  ```

### 3. `apps/frontend/src/components/timeline/message-event.tsx`
- Wire up `onQuoteReplyWithSnippet` in the `actionContext` useMemo (alongside existing `onQuoteReply`):
  ```ts
  onQuoteReplyWithSnippet: quoteReplyCtx
    ? (snippet: string) =>
        quoteReplyCtx.triggerQuoteReply({
          messageId: payload.messageId,
          streamId,
          authorName: actorName,
          authorId: event.actorId ?? "",
          actorType: event.actorType ?? "user",
          snippet,
        })
    : undefined,
  ```
- Add `quoteReplyCtx` to the existing dependency array (already there)

## Existing Code to Reuse

- `QuoteReplyContext.triggerQuoteReply()` — exact same data flow as desktop partial quote
- `MarkdownContent` component — same renderer used in the current preview (just without `line-clamp-2`)
- `selectionchange` listener pattern from `text-selection-quote.tsx` (lines 58-100) — adapt for scoped use within the drawer content ref
- `QuoteReplyData` interface — unchanged, the only difference is the `snippet` field content

## Design Decisions

- **Keep both quote options**: The existing "Quote reply" action in the action list stays as-is (full-message quote). The expandable preview is a separate path for partial quotes. Users get both.
- **Text hint affordance**: Small muted text "Tap to select quote" below the preview bubble signals it's tappable. Only shown when `context.onQuoteReplyWithSnippet` exists.

## Edge Cases

- **Short messages (1-2 lines)**: Expanding still works fine — user sees the same content but with selection enabled. The hint text signals the purpose.
- **Drawer close resets state**: `onOpenChange` callback resets `expanded` to false so re-opening starts in normal mode.
- **User selects all text**: Functionally a full quote — acceptable behavior.
- **Empty selection after expanding**: User can tap "Back" to return to normal mode and use other actions.

## UX Flow

1. User long-presses a message → drawer opens (normal mode)
2. User sees preview with a subtle "Tap to select quote" hint
3. User taps preview → drawer transitions to selection mode (full message, scrollable)
4. User long-presses text in the message → native selection handles appear
5. User drags selection handles to highlight desired text
6. "Quote" button becomes active at the bottom
7. User taps "Quote" → partial quote inserted in composer, drawer closes

## Verification

1. Test on mobile viewport (< 640px) that:
   - Long-press opens drawer with tappable preview
   - Tapping preview expands to full message
   - Text selection works (no conflict with Vaul drag-to-dismiss)
   - Scrolling works for long messages in expanded view
   - "Quote" button appears when text is selected
   - Tapping "Quote" inserts partial snippet in composer
   - "Back" returns to normal drawer mode
   - Closing and re-opening drawer resets to normal mode
2. Test that existing flows still work:
   - "Quote reply" action still quotes full message
   - Swipe-to-quote still works
   - Desktop text selection quote unchanged
3. Run `bun run test` for unit/integration tests
