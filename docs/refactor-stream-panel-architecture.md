# Refactor: Stream Panel Architecture

## Problem Statement

The current panel system has several issues:

1. **Multiple panels get messy** - Can have 3 panels open side-by-side, which clutters the UI
2. **Too tightly coupled to threads** - Panel is designed primarily for threads, not generic streams
3. **Can't show threads in main view easily** - Thread display is split between panel-specific logic and main view logic
4. **Can't show multiple non-thread streams** - Want to open scratchpad + channel, or two channels side-by-side

**Core insight:** The panel should be able to show ANY stream type, not just threads. And we should only show ONE panel at a time (like Slack), with tabs for multiple streams.

## Current Architecture

### Good Parts ✅

**`StreamContent` is already universal:**

```tsx
// Works for ANY stream type:
<StreamContent workspaceId={workspaceId} streamId={streamId} isDraft={isDraft} stream={stream} />
```

- Handles threads (shows parent message via `ThreadParentMessage`)
- Handles drafts (shows empty state)
- Handles channels, DMs, scratchpads (shows messages)
- Already used in both main view AND panels

### Coupling Issues ❌

**1. Panel UI is coupled to "side panel" concept:**

```tsx
// stream-panel.tsx
<SidePanel>
  <SidePanelHeader>
    {isThread ? <ThreadHeader /> : <SidePanelTitle>}
  </SidePanelHeader>
</SidePanel>
```

**2. Headers are stream-type specific:**

- `ThreadHeader` - breadcrumbs for threads only
- Main view header - different logic for threads vs channels vs scratchpads
- Panel header - special-cases threads

**3. Multiple panels rendered simultaneously:**

```tsx
// stream.tsx - renders ALL panels at once
{
  openPanels.map((panel) => (
    <ResizablePanel>
      <StreamPanel streamId={panel.streamId} />
    </ResizablePanel>
  ))
}
```

**4. Panel context allows multiple panels:**

```typescript
// panel-context.tsx
openPanels: PanelInfo[]  // Can have 3 panels open
```

## New Architecture

### Design Principle

**One universal stream renderer (`StreamContent`) + Context-specific chrome (headers, panel UI)**

### 1. One Panel, Multiple Tabs (Like Slack)

**URL Model:**

```
Current: ?panel=stream_1&panel=stream_2&panel=stream_3
New:     ?panel=stream_1&panel=stream_2&tab=0
```

- Multiple streams can be "open" in panel
- Only ONE is visible at a time
- Tabs at top of panel (like kitchen sink design)
- `tab` param selects which is active

**Benefits:**

- Less cluttered UI
- Easier to manage cognitive load
- Matches familiar pattern (Slack, VS Code)

### 2. Universal Stream Header Component

Create `StreamHeader` that works for ANY stream type:

```tsx
interface StreamHeaderProps {
  workspaceId: string
  stream: Stream
  context: "main" | "panel"
  onAction?: {
    onRename?: (name: string) => void
    onArchive?: () => void
    onClose?: () => void
  }
}

function StreamHeader({ workspaceId, stream, context, onAction }: StreamHeaderProps) {
  switch (stream.type) {
    case StreamTypes.THREAD:
      return <ThreadBreadcrumbs stream={stream} />

    case StreamTypes.CHANNEL:
      return <h1 className="font-semibold">#{stream.slug}</h1>

    case StreamTypes.SCRATCHPAD:
      return <EditableName name={stream.displayName} onRename={onAction?.onRename} />

    case StreamTypes.DM:
      return <ParticipantNames stream={stream} />
  }
}
```

**Usage:**

```tsx
// Main view (stream.tsx)
<header>
  <StreamHeader stream={stream} context="main" onAction={{ onRename, onArchive }} />
</header>

// Panel view (stream-panel.tsx)
<SidePanelHeader>
  <StreamHeader stream={stream} context="panel" onAction={{ onClose }} />
</SidePanelHeader>
```

### 3. Tab UI in Panel (From Kitchen Sink)

Reference design from `docs/design-system-kitchen-sink.html`:

```html
<div class="thread-panel-header">
  <div class="thread-tabs">
    <div class="thread-tab active">
      <span class="thread-tab-title">Design System</span>
    </div>
    <div class="thread-tab">
      <span class="thread-tab-title">Another Thread</span>
      <X class="close-btn" />
    </div>
  </div>
  <div class="thread-actions">
    <!-- Fullscreen, close, etc. -->
  </div>
</div>
```

**Component structure:**

```tsx
<SidePanel>
  <SidePanelHeader>
    {/* Tab bar */}
    {openPanels.length > 1 && (
      <div className="flex gap-1">
        {openPanels.map((panel, index) => (
          <Tab
            key={panel.streamId}
            active={index === activeTabIndex}
            onSelect={() => setActiveTab(index)}
            onClose={() => closePanel(panel.streamId)}
          >
            {getStreamName(panel)}
          </Tab>
        ))}
      </div>
    )}

    {/* Single stream header when only one panel */}
    {openPanels.length === 1 && <StreamHeader stream={activeStream} context="panel" />}

    {/* Actions (fullscreen, close) */}
    <PanelActions />
  </SidePanelHeader>

  <SidePanelContent>
    {/* Only render the ACTIVE panel */}
    <StreamContent streamId={activePanelId} workspaceId={workspaceId} stream={activeStream} />
  </SidePanelContent>
</SidePanel>
```

### 4. Panel Context Changes

**Before:**

```typescript
interface PanelContextValue {
  openPanels: PanelInfo[] // All panels rendered
  panelMode: "overlay" | "locked" | "fullscreen"
}
```

**After:**

```typescript
interface PanelContextValue {
  openPanels: PanelInfo[] // All panels in tabs
  activePanelId: string | null // Which one is visible
  activeTabIndex: number // Which tab is selected
  panelMode: "overlay" | "locked" | "fullscreen"

  // New methods
  setActivePanel: (streamId: string) => void
  switchToPanel: (streamId: string) => void // Open if not open, activate if already open
}
```

**URL sync:**

- `?panel=stream_1&panel=stream_2` - Two panels open
- `?tab=1` - Second tab is active (defaults to 0)
- `activePanelId = openPanels[activeTabIndex]?.streamId`

## Implementation Plan

### Phase 1: Change Panel Model (One Visible Panel, Tabs)

**Goal:** Only render one panel at a time, but support multiple panels in tabs.

**Files to change:**

1. `panel-context.tsx`:
   - Keep `openPanels` array
   - Add `activePanelId` derived from `activeTabIndex`
   - Add `switchToPanel(streamId)` helper

2. `stream.tsx`:
   - Remove `ResizablePanelGroup` with multiple panels
   - Render single `StreamPanel` for active panel
   - Add tab bar above panel when multiple panels open

3. `stream-panel.tsx`:
   - Add tab bar UI in header when `openPanels.length > 1`
   - Only render content for active panel

**Testing:**

- Opening multiple panels creates tabs, only shows one
- Clicking tabs switches between panels
- Closing a tab removes it from `openPanels`

### Phase 2: Create Universal Stream Header

**Goal:** Single component that renders appropriate header for any stream type.

**Files to create:**

1. `stream-header.tsx` - Universal header component
   - Takes `stream`, `context`, `onAction` props
   - Switches on `stream.type`
   - Reuses existing components (`ThreadHeader`, etc.) or creates new ones

**Files to update:** 2. `stream.tsx` - Use `StreamHeader` in main view header 3. `stream-panel.tsx` - Use `StreamHeader` in panel header 4. `thread-header.tsx` - Maybe rename to `thread-breadcrumbs.tsx` since it's now just one piece

**Testing:**

- Threads show breadcrumbs in both main and panel views
- Channels show #slug in both views
- Scratchpads show editable name in main view
- Panel header adapts to stream type

### Phase 3: Tab UI Implementation

**Goal:** Match kitchen sink design for panel tabs.

**Files to change:**

1. Create `panel-tab.tsx` component:
   - Shows stream name (abbreviated)
   - Active state styling
   - Close button
   - Click to activate

2. Update `stream-panel.tsx`:
   - Render tab bar when multiple panels
   - Wire up tab switching
   - Style matching kitchen sink

**Testing:**

- Multiple panels show as tabs
- Clicking tab switches view
- Close button removes panel
- Active tab is highlighted

### Phase 4: Support Any Stream Type in Panel

**Goal:** Ensure ANY stream can be opened in panel, not just threads.

**Files to change:**

1. Update navigation/links to use `openPanel(streamId)` for any stream
2. Update panel header to not assume thread
3. Test opening: channel, scratchpad, DM in panel

**Testing:**

- Click "open in panel" on channel → opens channel in panel
- Click "open in panel" on scratchpad → opens scratchpad in panel
- Multiple different stream types can be in tabs

### Phase 5: Clean Up & Polish

1. Consider renaming components:
   - `ThreadDraftPanel` → `DraftReplyPanel` (more generic)
   - `ThreadHeader` → `ThreadBreadcrumbs` (more specific)

2. Remove unused code:
   - `ResizablePanelGroup` logic for multiple panels
   - Thread-specific assumptions in panel code

3. Update documentation:
   - Update CLAUDE.md with new panel architecture
   - Document that panels can show any stream type

## Invariants to Follow

- **INV-13:** Construct, don't assemble - `StreamHeader` should be constructed with dependencies, not assembled at call site
- **INV-18:** No inline components - Extract any new components to separate files
- **INV-29:** Extract variance, share behavior - Header decision logic is extracted, but shared rendering flow

## Benefits of New Architecture

1. **Less cluttered UI** - Only one panel visible at a time
2. **Familiar UX** - Tabs pattern is well-understood (Slack, browsers)
3. **Generic panels** - Can show ANY stream type, not just threads
4. **Threads in main view** - No special-casing needed, `StreamContent` already handles it
5. **Reusable components** - `StreamHeader` works for main view AND panel
6. **Simpler rendering** - Only render active panel, not all panels

## Open Questions

1. **Should we keep fullscreen mode?**
   - Current: `?pmode=fullscreen` shows only the panel
   - Proposal: Keep it, but only applies to active panel

2. **How to handle "open in new tab" for threads?**
   - Current: Opens thread in panel
   - Could: Open thread in main view (navigate) OR add to panel tabs

3. **Max number of tabs?**
   - Current: Hard limit of 3 panels
   - Proposal: Keep limit, or allow more but make tabs scrollable?

4. **Should main view ever show non-URL stream?**
   - Example: Could main view temporarily show a panel's stream?
   - Or always keep main view = URL streamId?

## Next Steps

1. Review this plan with team
2. Create Linear issue for each phase
3. Implement Phase 1 (one visible panel, tabs)
4. Iterate based on usage
