# Stream Panel Refactor - Visual Summary

## Current State → Desired State

### Panel Model

**BEFORE (Current):**

```
┌─────────────────┬─────────────┬─────────────┬─────────────┐
│   Main Stream   │   Panel 1   │   Panel 2   │   Panel 3   │
│                 │  (Thread)   │  (Thread)   │  (Thread)   │
│                 │             │             │             │
└─────────────────┴─────────────┴─────────────┴─────────────┘
                   ↑ All rendered at once, side-by-side
```

**AFTER (Desired):**

```
┌─────────────────┬─────────────────────────────┐
│   Main Stream   │  ┌───────┬───────┬───────┐  │
│                 │  │ Tab 1 │ Tab 2 │ Tab 3 │  │ ← Tabs!
│                 │  └───────┴───────┴───────┘  │
│                 │                             │
│                 │      Active Panel           │
│                 │   (Any stream type)         │
│                 │                             │
└─────────────────┴─────────────────────────────┘
                   ↑ Only ONE panel visible
```

### Stream Type Support

**BEFORE:**

- Panel mainly designed for threads
- Special-case logic for threads everywhere
- Channels/scratchpads in main view only

**AFTER:**

- Panel works for ANY stream type
- Universal `StreamHeader` adapts to type
- Can show threads in main view OR panel

## Key Components

### 1. StreamContent (Already Universal ✅)

**This component already works perfectly!**

```tsx
<StreamContent streamId="stream_123" workspaceId="workspace_123" stream={stream} />
```

Handles:

- ✅ Threads (shows parent message)
- ✅ Channels (shows messages)
- ✅ Scratchpads (shows messages)
- ✅ DMs (shows messages)
- ✅ Drafts (shows empty state)

**No changes needed to StreamContent!**

### 2. StreamHeader (NEW - To Create)

**Universal header that adapts to stream type:**

```tsx
<StreamHeader stream={stream} context="main|panel" onAction={...} />

// Renders:
// - Thread    → Breadcrumbs (#general > Thread)
// - Channel   → #channel-name
// - Scratchpad → "My Notes" (editable)
// - DM        → "Alice, Bob"
```

**Replaces:**

- Current main view header logic (scattered in `stream.tsx`)
- Current panel header logic (scattered in `stream-panel.tsx`)
- `ThreadHeader` becomes `ThreadBreadcrumbs` (one piece of StreamHeader)

### 3. Panel with Tabs (From Kitchen Sink)

**Tab UI from design system:**

```tsx
<div className="thread-panel-header">
  {/* TABS (when multiple panels) */}
  <div className="thread-tabs">
    <div className="thread-tab active">
      <span className="thread-tab-title">Design System</span>
      <X onClick={closeTab} />
    </div>
    <div className="thread-tab">
      <span className="thread-tab-title">Another Stream</span>
      <X onClick={closeTab} />
    </div>
  </div>

  {/* ACTIONS (fullscreen, close, etc.) */}
  <div className="thread-actions">
    <button>
      <Maximize2 />
    </button>
    <button>
      <X />
    </button>
  </div>
</div>
```

## Data Flow Changes

### Panel Context

**BEFORE:**

```typescript
{
  openPanels: [
    { streamId: 'stream_1' },
    { streamId: 'stream_2' },
    { streamId: 'stream_3' },
  ],
  panelMode: 'locked'  // All 3 rendered side-by-side
}
```

**AFTER:**

```typescript
{
  openPanels: [
    { streamId: 'stream_1' },
    { streamId: 'stream_2' },
    { streamId: 'stream_3' },
  ],
  activeTabIndex: 1,  // Only stream_2 is visible
  panelMode: 'locked'
}

// Derived:
activePanelId = openPanels[activeTabIndex]?.streamId  // 'stream_2'
```

### URL Representation

**BEFORE:**

```
/w/workspace_123/s/stream_456?panel=thread_1&panel=thread_2&panel=thread_3
                              ↑ All rendered
```

**AFTER:**

```
/w/workspace_123/s/stream_456?panel=stream_1&panel=stream_2&panel=stream_3&tab=1
                              ↑ All in tabs             ↑ Only stream_2 visible
```

## Implementation Phases

### Phase 1: One Visible Panel ⚡ (Start here)

**Goal:** Only render the active panel, add tab UI.

**Changes:**

1. `panel-context.tsx` - Add `activePanelId`, compute from `activeTabIndex`
2. `stream.tsx` - Remove `ResizablePanelGroup`, render single panel
3. `stream-panel.tsx` - Add tab bar when multiple panels

**Result:** Multiple panels show as tabs, only one visible at a time.

### Phase 2: Universal Stream Header

**Goal:** Single header component for all stream types.

**Changes:**

1. Create `stream-header.tsx` - Universal header
2. Update `stream.tsx` main view - Use `StreamHeader`
3. Update `stream-panel.tsx` - Use `StreamHeader`
4. Rename `thread-header.tsx` → `thread-breadcrumbs.tsx`

**Result:** Headers adapt to stream type automatically.

### Phase 3: Tab Polish

**Goal:** Match kitchen sink design exactly.

**Changes:**

1. Create `panel-tab.tsx` component
2. Style to match `.thread-tab` CSS
3. Add close button per tab
4. Add active state highlighting

**Result:** Beautiful, consistent tab UI.

### Phase 4: Generic Panel Support

**Goal:** ANY stream can be opened in panel.

**Changes:**

1. Update links/navigation to use `openPanel(streamId)` for any stream
2. Test opening channels, scratchpads in panel
3. Remove thread-specific assumptions

**Result:** Panel is truly generic.

## Variance Extraction (INV-29)

Following **INV-29: Extract variance, share behavior**:

### BEFORE (Scattered variance):

```tsx
// stream.tsx - duplicated logic
if (isThread) {
  header = <ThreadHeader />
} else if (isChannel) {
  header = <h1>#{stream.slug}</h1>
} else if (isScratchpad) {
  header = <EditableName />
}

// stream-panel.tsx - duplicated again
if (isThread) {
  header = <ThreadHeader />
} else {
  header = <SidePanelTitle>{stream.displayName}</SidePanelTitle>
}
```

### AFTER (Extracted variance):

```tsx
// stream-header.tsx - variance extracted once
function StreamHeader({ stream, context }: Props) {
  // Decision logic in one place
  const variant = getHeaderVariant(stream.type, context)

  // Shared rendering flow
  return renderHeader(variant, stream)
}

// Usage everywhere
<StreamHeader stream={stream} context="main" />
<StreamHeader stream={stream} context="panel" />
```

## Testing Strategy

### Unit Tests

- `StreamHeader` renders correct variant for each stream type
- `PanelTab` component displays and handles clicks correctly
- Panel context computes `activePanelId` correctly

### Integration Tests

- Opening multiple panels creates tabs
- Clicking tab switches active panel
- Closing tab removes from `openPanels`
- Only active panel's content is rendered

### E2E Tests

- Can open channel in panel
- Can open scratchpad in panel
- Can open thread in panel
- Can open thread in main view
- Multiple panels show as tabs

## Benefits Summary

1. **Less cluttered UI** - One panel visible instead of 3
2. **Familiar UX** - Tabs are well-understood (Slack, VS Code, browsers)
3. **Generic panels** - Not coupled to threads
4. **Reusable headers** - `StreamHeader` works everywhere
5. **Simpler state** - Only render active panel
6. **Better performance** - Less DOM, less React rendering
7. **Easier to reason about** - One code path for headers

## Risks & Mitigations

### Risk: Breaking existing navigation

- **Mitigation:** Keep URL structure backward compatible, migrate gradually

### Risk: Tab UI feels cramped with many panels

- **Mitigation:** Enforce max 3 panels (already done), truncate tab titles

### Risk: Users expect threads in panels, channels in main view

- **Mitigation:** Support both, but default behavior stays same initially

### Risk: State management complexity

- **Mitigation:** Keep panel state in URL, derive everything from URL

## Decisions Made

1. **Should threads always open in panels?**
   - ✅ **Decision:** Support both panel and main view, default to panel

2. **What happens when clicking a panel tab that's already active?**
   - 🔄 **Decision:** TBD during implementation (scroll to top or no-op)

3. **Should we keep fullscreen mode?**
   - ✅ **Decision:** Remove fullscreen mode - users can resize panel instead

4. **Max number of tabs?**
   - ✅ **Decision:** No hard limit, but show dropdown/overflow menu when >3 tabs (use Shadcn components)

## Success Criteria

✅ Only one panel visible at a time
✅ Multiple panels show as tabs (matching kitchen sink design)
✅ Any stream type can be opened in panel (channels, scratchpads, threads)
✅ Thread can be shown in main view (not just panel)
✅ Headers adapt to stream type automatically
✅ No duplicated header logic between main view and panel
✅ No special-casing for threads in panel code

## Next Steps

1. **Review this plan** - Get feedback from team
2. **Create Linear issues** - One per phase
3. **Implement Phase 1** - One visible panel, tab UI
4. **Iterate** - Test with real usage, adjust based on feedback
