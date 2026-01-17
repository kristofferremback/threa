# Stream Panel Refactor - Component Hierarchy

## Component Tree Changes

### BEFORE (Current Architecture)

```
StreamPage (stream.tsx)
├─ Main Stream View
│  ├─ header
│  │  ├─ if (isThread) → ThreadHeader
│  │  ├─ else if (isChannel) → h1 with #slug
│  │  ├─ else if (isScratchpad) → EditableName
│  │  └─ else → h1 with displayName
│  └─ main
│     └─ TimelineView
│        └─ StreamContent ✅ (universal)
│
└─ if (panelMode === 'locked')
   └─ ResizablePanelGroup
      ├─ ResizablePanel (main - duplicate of above)
      ├─ ResizablePanel (panel 1)
      │  └─ StreamPanel
      │     ├─ SidePanelHeader
      │     │  ├─ if (isThread) → ThreadHeader
      │     │  └─ else → SidePanelTitle
      │     └─ StreamContent ✅ (universal)
      │
      ├─ ResizablePanel (panel 2)
      │  └─ StreamPanel (same structure)
      │
      └─ ResizablePanel (panel 3)
         └─ StreamPanel (same structure)
```

**Issues:**

- 🔴 Header logic duplicated in main view and StreamPanel
- 🔴 All panels rendered simultaneously (performance)
- 🔴 StreamPanel assumes thread-like structure
- 🔴 Can't easily show thread in main view

### AFTER (New Architecture)

```
StreamPage (stream.tsx)
├─ Main Stream View
│  ├─ header
│  │  └─ StreamHeader ✅ (universal, adapts to stream.type)
│  └─ main
│     └─ TimelineView
│        └─ StreamContent ✅ (universal)
│
└─ if (has panels)
   └─ Single Panel (not resizable group)
      └─ StreamPanel
         ├─ SidePanelHeader
         │  ├─ if (multiple panels)
         │  │  └─ PanelTabs
         │  │     ├─ PanelTab (stream 1)
         │  │     ├─ PanelTab (stream 2) ← active
         │  │     └─ PanelTab (stream 3)
         │  └─ else
         │     └─ StreamHeader ✅ (universal)
         │  └─ PanelActions (fullscreen, close)
         │
         └─ StreamContent ✅ (universal)
            ↑ Only renders ACTIVE panel's stream
```

**Improvements:**

- ✅ Header logic unified in StreamHeader
- ✅ Only active panel rendered (performance)
- ✅ StreamPanel is generic (works for any stream type)
- ✅ Thread can be shown in main view (StreamHeader adapts)
- ✅ Tab UI from kitchen sink design

## Component Details

### 1. StreamHeader (NEW)

**Purpose:** Universal header that adapts to any stream type.

**File:** `apps/frontend/src/components/stream/stream-header.tsx`

```tsx
import { Stream } from "@threa/types"
import { ThreadBreadcrumbs } from "./thread-breadcrumbs"
import { EditableStreamName } from "./editable-stream-name"
import { StreamTypes } from "@threa/types"

interface StreamHeaderProps {
  workspaceId: string
  stream: Stream
  context: "main" | "panel"
  onAction?: {
    onRename?: (name: string) => Promise<void>
    onArchive?: () => Promise<void>
    onUnarchive?: () => Promise<void>
    onBack?: () => void
  }
}

export function StreamHeader({ workspaceId, stream, context, onAction }: StreamHeaderProps) {
  // Thread → show breadcrumbs
  if (stream.type === StreamTypes.THREAD) {
    return <ThreadBreadcrumbs workspaceId={workspaceId} stream={stream} onBack={onAction?.onBack} />
  }

  // Channel → show #slug
  if (stream.type === StreamTypes.CHANNEL) {
    return <h1 className="font-semibold">#{stream.slug}</h1>
  }

  // Scratchpad → show editable name (in main view only)
  if (stream.type === StreamTypes.SCRATCHPAD) {
    if (context === "main" && onAction?.onRename) {
      return <EditableStreamName name={stream.displayName || "New scratchpad"} onRename={onAction.onRename} />
    }
    return <h1 className="font-semibold">{stream.displayName || "New scratchpad"}</h1>
  }

  // DM → show participant names
  if (stream.type === StreamTypes.DM) {
    // TODO: Fetch participants, show "Alice, Bob"
    return <h1 className="font-semibold">{stream.displayName || "Direct Message"}</h1>
  }

  // Fallback
  return <h1 className="font-semibold">{stream.displayName || "Stream"}</h1>
}
```

### 2. ThreadBreadcrumbs (RENAME from ThreadHeader)

**Purpose:** Show breadcrumb navigation for threads (one piece of StreamHeader).

**File:** `apps/frontend/src/components/thread/thread-breadcrumbs.tsx`

```tsx
// Rename thread-header.tsx → thread-breadcrumbs.tsx
// Keep existing implementation, just rename
export function ThreadBreadcrumbs({ workspaceId, stream, onBack }: Props) {
  // ... existing implementation
}
```

### 3. PanelTabs (NEW)

**Purpose:** Tab bar for multiple open panels (from kitchen sink design).

**File:** `apps/frontend/src/components/thread/panel-tabs.tsx`

```tsx
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

interface PanelTab {
  streamId: string
  name: string
}

interface PanelTabsProps {
  tabs: PanelTab[]
  activeIndex: number
  onSelectTab: (index: number) => void
  onCloseTab: (streamId: string) => void
}

export function PanelTabs({ tabs, activeIndex, onSelectTab, onCloseTab }: PanelTabsProps) {
  return (
    <div className="flex gap-1">
      {tabs.map((tab, index) => (
        <div
          key={tab.streamId}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm cursor-pointer transition-all max-w-[150px]",
            "hover:bg-muted/50 hover:text-foreground",
            index === activeIndex ? "bg-primary/10 text-primary" : "text-muted-foreground"
          )}
          onClick={() => onSelectTab(index)}
        >
          <span className="truncate">{tab.name}</span>
          <button
            className="opacity-0 hover:opacity-100 group-hover:opacity-60 transition-opacity"
            onClick={(e) => {
              e.stopPropagation()
              onCloseTab(tab.streamId)
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
```

### 4. StreamPanel (UPDATED)

**Purpose:** Generic panel that can show ANY stream type.

**File:** `apps/frontend/src/components/thread/stream-panel.tsx`

```tsx
import { usePanel } from "@/contexts"
import { useStreamBootstrap } from "@/hooks"
import { StreamContent } from "@/components/timeline"
import { StreamHeader } from "@/components/stream/stream-header"
import { PanelTabs } from "./panel-tabs"
import { PanelActions } from "./panel-actions"
import { SidePanel, SidePanelHeader, SidePanelContent } from "@/components/ui/side-panel"

interface StreamPanelProps {
  workspaceId: string
}

export function StreamPanel({ workspaceId }: StreamPanelProps) {
  const { openPanels, activeTabIndex, setActiveTab, closePanel, expandPanel, exitFullscreen, panelMode } = usePanel()

  // Get active panel info
  const activePanel = openPanels[activeTabIndex]
  if (!activePanel) return null

  // Fetch only the ACTIVE panel's stream
  const { data: bootstrap } = useStreamBootstrap(workspaceId, activePanel.streamId)
  const stream = bootstrap?.stream

  // Get tab names for all panels
  const tabs = openPanels.map((panel, index) => {
    // Could fetch names in parallel, or use cached data
    // For now, use streamId as fallback
    return {
      streamId: panel.streamId,
      name: stream?.displayName || `Stream ${index + 1}`,
    }
  })

  const showTabs = openPanels.length > 1
  const isFullscreen = panelMode === "fullscreen"

  return (
    <SidePanel>
      <SidePanelHeader>
        {/* Tabs when multiple panels open */}
        {showTabs && (
          <PanelTabs tabs={tabs} activeIndex={activeTabIndex} onSelectTab={setActiveTab} onCloseTab={closePanel} />
        )}

        {/* Single stream header when only one panel */}
        {!showTabs && stream && (
          <StreamHeader
            workspaceId={workspaceId}
            stream={stream}
            context="panel"
            onAction={{ onBack: () => closePanel(stream.id) }}
          />
        )}

        {/* Panel actions (fullscreen, close) */}
        <PanelActions
          isFullscreen={isFullscreen}
          onToggleFullscreen={isFullscreen ? exitFullscreen : expandPanel}
          onClose={() => closePanel(activePanel.streamId)}
        />
      </SidePanelHeader>

      <SidePanelContent>
        {/* Only render ACTIVE panel's content */}
        <StreamContent workspaceId={workspaceId} streamId={activePanel.streamId} stream={stream} />
      </SidePanelContent>
    </SidePanel>
  )
}
```

### 5. StreamPage (UPDATED)

**Purpose:** Main page that shows stream + optional panel.

**File:** `apps/frontend/src/pages/stream.tsx`

```tsx
export function StreamPage() {
  const { workspaceId, streamId } = useParams()
  const { stream, rename, archive, unarchive } = useStreamOrDraft(workspaceId!, streamId!)
  const { openPanels, panelMode } = usePanel()

  const hasPanels = openPanels.length > 0

  // Main stream content
  const mainStreamContent = (
    <div className="flex h-full flex-col">
      <header className="flex h-11 items-center justify-between border-b px-4">
        {/* UNIVERSAL HEADER - adapts to stream type */}
        <StreamHeader
          workspaceId={workspaceId}
          stream={stream}
          context="main"
          onAction={{ onRename: rename, onArchive: archive, onUnarchive: unarchive }}
        />

        {/* Stream actions (conversations, settings, etc.) */}
        <StreamActions stream={stream} />
      </header>

      <main className="flex-1 overflow-hidden">
        <TimelineView />
      </main>
    </div>
  )

  // Fullscreen mode: only show the panel
  if (panelMode === "fullscreen" && hasPanels) {
    return <StreamPanel workspaceId={workspaceId} />
  }

  // Locked mode: show main stream + panel side-by-side
  if (panelMode === "locked" && hasPanels) {
    return (
      <ResizablePanelGroup orientation="horizontal" className="h-full">
        <ResizablePanel id="main" defaultSize={60} minSize={30}>
          {mainStreamContent}
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel id="panel" defaultSize={40} minSize={30}>
          <StreamPanel workspaceId={workspaceId} />
        </ResizablePanel>
      </ResizablePanelGroup>
    )
  }

  // Default: just main stream
  return mainStreamContent
}
```

## File Checklist

### Files to Create

- [ ] `apps/frontend/src/components/stream/stream-header.tsx`
- [ ] `apps/frontend/src/components/stream/editable-stream-name.tsx` (extract from stream.tsx)
- [ ] `apps/frontend/src/components/thread/panel-tabs.tsx`
- [ ] `apps/frontend/src/components/thread/panel-actions.tsx` (extract from stream-panel.tsx)

### Files to Update

- [ ] `apps/frontend/src/components/thread/stream-panel.tsx` - Use tabs, render only active
- [ ] `apps/frontend/src/pages/stream.tsx` - Use StreamHeader, simplified panel logic
- [ ] `apps/frontend/src/contexts/panel-context.tsx` - Add activePanelId, setActiveTab

### Files to Rename

- [ ] `apps/frontend/src/components/thread/thread-header.tsx` → `thread-breadcrumbs.tsx`

### Files to Delete (Maybe)

- [ ] None yet - but might consolidate some panel logic

## Migration Strategy

### Step 1: Create New Components (No Breaking Changes)

1. Create `StreamHeader` component
2. Create `PanelTabs` component
3. Create `PanelActions` component

**Result:** New components exist but aren't used yet.

### Step 2: Update Panel to Use Tabs (Small Breaking Change)

1. Update `StreamPanel` to use `PanelTabs` when multiple panels
2. Update `StreamPanel` to only render active panel
3. Test that switching tabs works

**Result:** Panels show tabs, only one visible.

### Step 3: Update Main View to Use StreamHeader (No Breaking Change)

1. Update `stream.tsx` main view header to use `StreamHeader`
2. Remove duplicated header logic
3. Test all stream types (thread, channel, scratchpad, DM)

**Result:** Main view uses unified header component.

### Step 4: Update Panel to Use StreamHeader (No Breaking Change)

1. Update `StreamPanel` to use `StreamHeader` when single panel
2. Remove duplicated header logic
3. Rename `ThreadHeader` → `ThreadBreadcrumbs`

**Result:** Panel uses unified header component.

### Step 5: Clean Up (No Breaking Changes)

1. Remove old header code from `stream.tsx`
2. Remove old header code from `stream-panel.tsx`
3. Update tests

**Result:** Duplicated code removed, tests passing.

## Testing Plan

### Unit Tests

**StreamHeader:**

```tsx
describe('StreamHeader', () => {
  it('renders breadcrumbs for threads', () => {
    const stream = { type: StreamTypes.THREAD, ... }
    render(<StreamHeader stream={stream} context="main" />)
    expect(screen.getByText('Thread')).toBeInTheDocument()
  })

  it('renders #slug for channels', () => {
    const stream = { type: StreamTypes.CHANNEL, slug: 'general', ... }
    render(<StreamHeader stream={stream} context="main" />)
    expect(screen.getByText('#general')).toBeInTheDocument()
  })

  it('renders editable name for scratchpads in main view', () => {
    const stream = { type: StreamTypes.SCRATCHPAD, displayName: 'My Notes', ... }
    const onRename = vi.fn()
    render(<StreamHeader stream={stream} context="main" onAction={{ onRename }} />)
    // Test that clicking triggers edit mode
  })
})
```

**PanelTabs:**

```tsx
describe("PanelTabs", () => {
  it("renders all tabs", () => {
    const tabs = [
      { streamId: "1", name: "Stream 1" },
      { streamId: "2", name: "Stream 2" },
    ]
    render(<PanelTabs tabs={tabs} activeIndex={0} onSelectTab={vi.fn()} onCloseTab={vi.fn()} />)
    expect(screen.getByText("Stream 1")).toBeInTheDocument()
    expect(screen.getByText("Stream 2")).toBeInTheDocument()
  })

  it("highlights active tab", () => {
    const tabs = [
      { streamId: "1", name: "Active" },
      { streamId: "2", name: "Inactive" },
    ]
    const { container } = render(<PanelTabs tabs={tabs} activeIndex={0} onSelectTab={vi.fn()} onCloseTab={vi.fn()} />)
    const activeTab = screen.getByText("Active").closest("div")
    expect(activeTab).toHaveClass("bg-primary/10")
  })

  it("calls onSelectTab when clicking tab", async () => {
    const onSelectTab = vi.fn()
    const tabs = [{ streamId: "1", name: "Tab 1" }]
    render(<PanelTabs tabs={tabs} activeIndex={0} onSelectTab={onSelectTab} onCloseTab={vi.fn()} />)

    await userEvent.click(screen.getByText("Tab 1"))
    expect(onSelectTab).toHaveBeenCalledWith(0)
  })

  it("calls onCloseTab when clicking close button", async () => {
    const onCloseTab = vi.fn()
    const tabs = [{ streamId: "1", name: "Tab 1" }]
    render(<PanelTabs tabs={tabs} activeIndex={0} onSelectTab={vi.fn()} onCloseTab={onCloseTab} />)

    const closeButton = screen.getByRole("button")
    await userEvent.click(closeButton)
    expect(onCloseTab).toHaveBeenCalledWith("1")
  })
})
```

### Integration Tests

```tsx
describe("StreamPanel with tabs", () => {
  it("only renders active panel content", () => {
    // Setup: 3 panels open, activeTabIndex = 1
    // Expect: Only stream_2's StreamContent is rendered
  })

  it("switches content when tab is clicked", () => {
    // Setup: 2 panels open
    // Action: Click second tab
    // Expect: StreamContent for second stream is rendered
  })

  it("removes panel when tab is closed", () => {
    // Setup: 3 panels open
    // Action: Close middle tab
    // Expect: Only 2 tabs remain, active switches to next tab
  })
})
```

### E2E Tests

```tsx
test("can open multiple streams in panel", async () => {
  // Open channel in panel
  // Open scratchpad in panel
  // Verify both show as tabs
  // Switch between them
  // Close one
})

test("thread can be shown in main view", async () => {
  // Navigate to thread URL directly
  // Verify breadcrumbs show in main view header
  // Verify parent message shown
})
```

## Performance Considerations

### Before (Current)

- 3 panels open = 3 `StreamContent` components rendered
- 3 `useStreamBootstrap` queries active
- 3 subscription to stream rooms
- 3 event lists in memory

### After (New)

- 3 panels open = 1 `StreamContent` component rendered (active one)
- 1 `useStreamBootstrap` query for active panel
- 1 subscription to stream room (active one)
- 1 event list in memory

**Performance improvement:** ~66% reduction in rendering, queries, and memory when 3 panels open.

**Trade-off:** Switching tabs requires fetching data for new active panel. But React Query caching mitigates this.

## Conclusion

This refactor achieves:

1. ✅ Less cluttered UI (one visible panel)
2. ✅ Familiar tab UX (Slack-like)
3. ✅ Generic panels (any stream type)
4. ✅ Unified header logic (`StreamHeader`)
5. ✅ Better performance (only render active)
6. ✅ Simpler code (less duplication)

The key insight: **`StreamContent` is already universal** - we just need to unify the chrome (headers, tabs) around it.
