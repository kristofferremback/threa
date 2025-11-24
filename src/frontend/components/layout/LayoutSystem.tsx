import { useState, useCallback } from "react"
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels"
import { X, GripVertical, MessageCircle } from "lucide-react"
import { ChatInterface } from "../ChatInterface"
import { useAuth } from "../../auth"
import { clsx } from "clsx"

interface Tab {
  id: string
  title: string
  type: "channel" | "thread"
  data?: {
    channelId?: string
    threadId?: string
  }
}

interface Pane {
  id: string
  tabs: Tab[]
  activeTabId: string
}

export function LayoutSystem() {
  const { isAuthenticated, state, user } = useAuth()
  const [panes, setPanes] = useState<Pane[]>([
    {
      id: "pane-0",
      tabs: [{ id: "general", title: "#general", type: "channel", data: { channelId: "general" } }],
      activeTabId: "general",
    },
  ])

  const [focusedPaneId, setFocusedPaneId] = useState<string>("pane-0")

  // All hooks must be called before any conditional returns
  const openItem = useCallback(
    (item: Omit<Tab, "id">) => {
      setPanes((prev) => {
        const focusedIndex = prev.findIndex((p) => p.id === focusedPaneId)
        if (focusedIndex === -1) return prev

        const targetIndex = focusedIndex + 1
        const newTabId = `${item.type}-${Date.now()}`
        const newTab: Tab = { ...item, id: newTabId }

        // If target pane exists, add to it
        if (targetIndex < prev.length) {
          return prev.map((pane, index) => {
            if (index === targetIndex) {
              return {
                ...pane,
                tabs: [...pane.tabs, newTab],
                activeTabId: newTabId,
              }
            }
            return pane
          })
        }

        // If target pane doesn't exist, create it
        const newPaneId = `pane-${Date.now()}`
        return [
          ...prev,
          {
            id: newPaneId,
            tabs: [newTab],
            activeTabId: newTabId,
          },
        ]
      })
    },
    [focusedPaneId],
  )

  const closeTab = (paneId: string, tabId: string) => {
    setPanes((prev) => {
      const newPanes = prev
        .map((pane) => {
          if (pane.id !== paneId) return pane

          const newTabs = pane.tabs.filter((t) => t.id !== tabId)
          let newActiveId = pane.activeTabId

          if (tabId === pane.activeTabId && newTabs.length > 0) {
            newActiveId = newTabs[newTabs.length - 1].id
          }

          return {
            ...pane,
            tabs: newTabs,
            activeTabId: newActiveId,
          }
        })
        .filter((pane) => pane.tabs.length > 0)

      return newPanes
    })
  }

  const setActiveTab = (paneId: string, tabId: string) => {
    setPanes((prev) => prev.map((p) => (p.id === paneId ? { ...p, activeTabId: tabId } : p)))
    setFocusedPaneId(paneId)
  }

  // Show loading state while checking auth
  if (state === "new" || state === "loading") {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-zinc-950 font-sans">
        <div className="flex flex-col items-center gap-4 text-center">
          <MessageCircle className="h-16 w-16 text-blue-500 animate-pulse" />
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    )
  }

  // Show login screen if not authenticated (regardless of whether it's loaded or error state)
  if (!isAuthenticated) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-zinc-950 font-sans">
        <div className="flex flex-col items-center gap-4 text-center">
          <MessageCircle className="h-16 w-16 text-blue-500" />
          <h2 className="text-2xl font-semibold">Welcome to Threa</h2>
          <p className="text-gray-400">A minimal chat application with WorkOS authentication</p>
          <button
            onClick={() => (window.location.href = "/api/auth/login")}
            className="rounded-md bg-white px-6 py-2.5 text-sm font-medium text-black transition-colors hover:bg-gray-100"
          >
            Login with WorkOS
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen w-full bg-zinc-950 text-white overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 flex-none border-r border-zinc-800 flex flex-col bg-zinc-950">
        <div className="p-4 border-b border-zinc-800 font-semibold text-zinc-100">Workspace</div>
        <div className="p-2 space-y-1">
          {["general", "engineering", "random"].map((channel) => (
            <button
              key={channel}
              onClick={() => {
                // For now, clicking sidebar resets view or opens in focused pane?
                // Let's make it open in focused pane or first pane if focused is thread?
                // Standard behavior: Main pane navigation.
                // For simplicity here: Just log it, or maybe replace first pane content.
                console.log("Navigate to", channel)
              }}
              className="w-full text-left px-3 py-2 rounded hover:bg-zinc-800 text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
            >
              # {channel}
            </button>
          ))}
        </div>
      </div>

      {/* Main Layout Area */}
      <div className="flex-1 min-w-0">
        <PanelGroup direction="horizontal">
          {panes.map((pane, index) => (
            <div key={pane.id} className="contents">
              {/* Resize Handle */}
              {index > 0 && (
                <PanelResizeHandle className="w-1 bg-zinc-800 hover:bg-blue-500 transition-colors flex flex-col justify-center items-center group outline-none">
                  <div className="h-8 w-0.5 rounded-full bg-zinc-600 group-hover:bg-white/50" />
                </PanelResizeHandle>
              )}

              <Panel
                minSize={20}
                defaultSize={100 / panes.length}
                className={clsx(
                  "flex flex-col border-r border-zinc-800 transition-all duration-200 outline-none",
                  focusedPaneId === pane.id ? "ring-1 ring-blue-500/20 z-10" : "",
                )}
                onClick={() => setFocusedPaneId(pane.id)}
              >
                {/* Tabs Header */}
                <div className="flex h-9 items-center bg-zinc-900 border-b border-zinc-800 overflow-x-auto no-scrollbar">
                  {pane.tabs.map((tab) => (
                    <div
                      key={tab.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        setActiveTab(pane.id, tab.id)
                      }}
                      className={clsx(
                        "flex items-center gap-2 px-3 py-1.5 text-xs font-medium cursor-pointer min-w-fit border-r border-zinc-800/50 h-full select-none",
                        pane.activeTabId === tab.id
                          ? "bg-zinc-800 text-zinc-100 border-t-2 border-t-blue-500"
                          : "bg-zinc-900 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300",
                      )}
                    >
                      <span className="truncate max-w-[120px]">{tab.title}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          closeTab(pane.id, tab.id)
                        }}
                        className="rounded hover:bg-zinc-600 text-zinc-500 hover:text-zinc-200 p-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Content */}
                <div className="flex-1 relative bg-zinc-950 min-h-0">
                  {pane.tabs.map((tab) => (
                    <div
                      key={tab.id}
                      className={clsx(
                        "absolute inset-0 h-full w-full",
                        pane.activeTabId === tab.id ? "z-10 block" : "z-0 hidden",
                      )}
                      style={{ display: pane.activeTabId === tab.id ? "flex" : "none", flexDirection: "column" }}
                    >
                      <ChatInterface
                        channelId={tab.data?.channelId}
                        threadId={tab.data?.threadId}
                        title={tab.title}
                        onOpenThread={(msgId) => {
                          setFocusedPaneId(pane.id) // Ensure source is focused
                          openItem({
                            title: `Thread ${msgId.slice(0, 4)}...`,
                            type: "thread",
                            data: { threadId: msgId },
                          })
                        }}
                      />
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          ))}
        </PanelGroup>
      </div>
    </div>
  )
}
