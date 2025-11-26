import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels"
import { X, Hash, MessageCircle, Bell } from "lucide-react"
import { clsx } from "clsx"
import type { Pane, Tab } from "../../types"

interface PaneSystemProps {
  panes: Pane[]
  focusedPaneId: string | null
  onFocusPane: (paneId: string) => void
  onSetActiveTab: (paneId: string, tabId: string) => void
  onCloseTab: (paneId: string, tabId: string) => void
  renderContent: (tab: Tab, paneId: string) => React.ReactNode
}

export function PaneSystem({
  panes,
  focusedPaneId,
  onFocusPane,
  onSetActiveTab,
  onCloseTab,
  renderContent,
}: PaneSystemProps) {
  if (panes.length === 0) {
    return <EmptyPaneState />
  }

  return (
    <PanelGroup direction="horizontal">
      {panes.map((pane, index) => (
        <PaneItem
          key={pane.id}
          pane={pane}
          index={index}
          isLast={index === panes.length - 1}
          isFocused={pane.id === focusedPaneId}
          onFocus={() => onFocusPane(pane.id)}
          onSetActiveTab={(tabId) => onSetActiveTab(pane.id, tabId)}
          onCloseTab={(tabId) => onCloseTab(pane.id, tabId)}
          renderContent={renderContent}
        />
      ))}
    </PanelGroup>
  )
}

function EmptyPaneState() {
  return (
    <div className="flex h-full items-center justify-center" style={{ color: "var(--text-muted)" }}>
      <div className="text-center">
        <Hash className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>Select a channel to start</p>
      </div>
    </div>
  )
}

interface PaneItemProps {
  pane: Pane
  index: number
  isLast: boolean
  isFocused: boolean
  onFocus: () => void
  onSetActiveTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  renderContent: (tab: Tab, paneId: string) => React.ReactNode
}

function PaneItem({
  pane,
  index,
  isLast,
  isFocused,
  onFocus,
  onSetActiveTab,
  onCloseTab,
  renderContent,
}: PaneItemProps) {
  return (
    <div className="contents">
      {index > 0 && <PaneResizeHandle />}

      <Panel
        minSize={20}
        defaultSize={100}
        className={clsx("flex flex-col outline-none")}
        style={{
          borderRight: !isLast ? "1px solid var(--border-subtle)" : undefined,
        }}
        onClick={onFocus}
      >
        {/* Tabs Header */}
        <TabBar tabs={pane.tabs} activeTabId={pane.activeTabId} onSelectTab={onSetActiveTab} onCloseTab={onCloseTab} />

        {/* Content */}
        <div className="flex-1 relative min-h-0" style={{ background: "var(--bg-primary)" }}>
          {pane.tabs.map((tab) => (
            <div
              key={tab.id}
              className={clsx("absolute inset-0 h-full w-full")}
              style={{
                display: pane.activeTabId === tab.id ? "flex" : "none",
                flexDirection: "column",
              }}
            >
              {renderContent(tab, pane.id)}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}

function PaneResizeHandle() {
  return (
    <PanelResizeHandle
      className="w-1 transition-colors flex flex-col justify-center items-center group outline-none"
      style={{ background: "var(--border-subtle)" }}
    >
      <div className="h-8 w-0.5 rounded-full transition-colors" style={{ background: "var(--border-default)" }} />
    </PanelResizeHandle>
  )
}

interface TabBarProps {
  tabs: Tab[]
  activeTabId: string
  onSelectTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
}

function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab }: TabBarProps) {
  return (
    <div
      className="flex h-10 items-center overflow-x-auto no-scrollbar"
      style={{ background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-subtle)" }}
    >
      {tabs.map((tab) => (
        <TabItem
          key={tab.id}
          tab={tab}
          isActive={activeTabId === tab.id}
          onSelect={() => onSelectTab(tab.id)}
          onClose={() => onCloseTab(tab.id)}
        />
      ))}
    </div>
  )
}

interface TabItemProps {
  tab: Tab
  isActive: boolean
  onSelect: () => void
  onClose: () => void
}

function TabItem({ tab, isActive, onSelect, onClose }: TabItemProps) {
  return (
    <div
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
      }}
      className={clsx(
        "flex items-center gap-2 px-3 py-2 text-xs font-medium cursor-pointer min-w-fit h-full select-none transition-colors",
        isActive ? "bg-[var(--hover-overlay)]" : "hover:bg-[var(--hover-overlay)]",
      )}
      style={{
        color: isActive ? "var(--text-primary)" : "var(--text-muted)",
        borderBottom: isActive ? "2px solid var(--accent-primary)" : "2px solid transparent",
      }}
    >
      {tab.type === "channel" ? (
        <Hash className="h-3.5 w-3.5" />
      ) : tab.type === "activity" ? (
        <Bell className="h-3.5 w-3.5" />
      ) : (
        <MessageCircle className="h-3.5 w-3.5" />
      )}
      <span className="truncate max-w-[120px]">{tab.title}</span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        className="rounded p-0.5 hover:bg-[var(--hover-overlay-strong)] transition-colors"
        style={{ color: "var(--text-muted)" }}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}
