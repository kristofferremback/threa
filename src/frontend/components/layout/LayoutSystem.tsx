import { useState, useCallback, useEffect, useRef } from "react"
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels"
import {
  X,
  MessageCircle,
  Hash,
  Users,
  Settings,
  Plus,
  Loader2,
  Building2,
  Sparkles,
  ChevronDown,
} from "lucide-react"
import { ChatInterface, OpenMode } from "../ChatInterface"
import { useAuth } from "../../auth"
import { clsx } from "clsx"

// ============================================================================
// URL State Serialization
// ============================================================================
// URL format: ?p=channel:general,thread:msg_123:general|thread:msg_456:general
// - Pipes (|) separate panes
// - Commas (,) separate tabs within a pane (first tab is active)
// - Colons (:) separate type:id:channelId

function serializePanesToUrl(panes: Pane[]): string {
  if (panes.length === 0) return ""

  const serialized = panes
    .map((pane) => {
      // Put active tab first
      const sortedTabs = [...pane.tabs].sort((a, b) => {
        if (a.id === pane.activeTabId) return -1
        if (b.id === pane.activeTabId) return 1
        return 0
      })

      return sortedTabs
        .map((tab) => {
          if (tab.type === "channel") {
            return `c:${tab.data?.channelId || ""}`
          } else if (tab.type === "thread") {
            return `t:${tab.data?.threadId || ""}:${tab.data?.channelId || ""}`
          }
          return ""
        })
        .filter(Boolean)
        .join(",")
    })
    .filter(Boolean)
    .join("|")

  return serialized
}

function deserializePanesFromUrl(param: string, channels: BootstrapChannel[]): Pane[] | null {
  if (!param) return null

  try {
    const paneStrings = param.split("|").filter(Boolean)
    if (paneStrings.length === 0) return null

    const panes: Pane[] = paneStrings.map((paneStr, paneIndex) => {
      const tabStrings = paneStr.split(",").filter(Boolean)
      const tabs: Tab[] = tabStrings
        .map((tabStr, tabIndex) => {
          const parts = tabStr.split(":")

          if (parts[0] === "c" && parts[1]) {
            // Channel: c:slug
            const channelSlug = parts[1]
            const channel = channels.find((c) => c.slug === channelSlug)
            return {
              id: `channel-${paneIndex}-${tabIndex}`,
              title: channel ? `#${channel.name.replace("#", "")}` : `#${channelSlug}`,
              type: "channel" as const,
              data: { channelId: channelSlug },
            }
          } else if (parts[0] === "t" && parts[1]) {
            // Thread: t:threadId:channelId
            const threadId = parts[1]
            const channelId = parts[2] || ""
            return {
              id: `thread-${paneIndex}-${tabIndex}`,
              title: "Thread",
              type: "thread" as const,
              data: { threadId, channelId },
            }
          }
          return null
        })
        .filter((t): t is Tab => t !== null)

      if (tabs.length === 0) return null

      return {
        id: `pane-${paneIndex}`,
        tabs,
        activeTabId: tabs[0].id, // First tab is active
      }
    }).filter((p): p is Pane => p !== null)

    return panes.length > 0 ? panes : null
  } catch {
    return null
  }
}

function updateUrlWithPanes(panes: Pane[], pushHistory = false) {
  const serialized = serializePanesToUrl(panes)
  const url = new URL(window.location.href)

  if (serialized) {
    url.searchParams.set("p", serialized)
  } else {
    url.searchParams.delete("p")
  }

  // Use pushState for navigation actions, replaceState for minor updates
  if (pushHistory) {
    window.history.pushState({ panes: serialized }, "", url.toString())
  } else {
    window.history.replaceState({ panes: serialized }, "", url.toString())
  }
}

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

interface BootstrapChannel {
  id: string
  name: string
  slug: string
  description: string | null
  topic: string | null
  visibility: "public" | "private" | "direct"
  unread_count: number
  last_read_at: string | null
  notify_level: string
}

interface BootstrapData {
  workspace: {
    id: string
    name: string
    slug: string
    plan_tier: string
  }
  user_role: string
  channels: BootstrapChannel[]
  conversations: any[]
  users: any[]
}

// ============================================================================
// Loading Screen
// ============================================================================
function LoadingScreen() {
  return (
    <div className="flex h-screen w-full items-center justify-center" style={{ background: "var(--gradient-bg)" }}>
      <div className="flex flex-col items-center gap-6 text-center animate-fade-in">
        <div className="relative">
          <div className="absolute inset-0 blur-2xl opacity-50" style={{ background: "var(--gradient-accent)" }} />
          <MessageCircle className="h-16 w-16 relative" style={{ color: "var(--accent-primary)" }} />
        </div>
        <div className="flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
          <Loader2 className="h-4 w-4 animate-spin" />
          <span style={{ fontFamily: "var(--font-mono)" }}>Initializing...</span>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Login Screen
// ============================================================================
function LoginScreen() {
  return (
    <div className="flex h-screen w-full items-center justify-center" style={{ background: "var(--gradient-bg)" }}>
      <div className="flex flex-col items-center gap-8 text-center max-w-md px-6 animate-fade-in">
        {/* Logo */}
        <div className="relative">
          <div
            className="absolute inset-0 blur-3xl opacity-30"
            style={{ background: "var(--gradient-accent)", transform: "scale(2)" }}
          />
          <div className="relative flex items-center gap-3">
            <MessageCircle className="h-12 w-12" style={{ color: "var(--accent-primary)" }} />
            <span className="text-4xl font-bold tracking-tight" style={{ fontFamily: "var(--font-sans)" }}>
              threa
            </span>
          </div>
        </div>

        {/* Tagline */}
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
            Conversations that flow
          </h1>
          <p style={{ color: "var(--text-secondary)", lineHeight: 1.6 }}>
            A modern chat platform built for teams who value context and clarity.
          </p>
        </div>

        {/* Login Button */}
        <button
          onClick={() => (window.location.href = "/api/auth/login")}
          className="group relative overflow-hidden rounded-xl px-8 py-3.5 font-medium transition-all hover:scale-[1.02] active:scale-[0.98]"
          style={{
            background: "var(--gradient-accent)",
            color: "white",
            boxShadow: "0 0 30px var(--accent-glow)",
          }}
        >
          <span className="relative z-10 flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Continue with WorkOS
          </span>
          <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>

        {/* Footer */}
        <p className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          Enterprise-grade authentication
        </p>
      </div>
    </div>
  )
}

// ============================================================================
// No Workspace Screen
// ============================================================================
function NoWorkspaceScreen({ onCreateWorkspace }: { onCreateWorkspace: () => void }) {
  return (
    <div className="flex h-screen w-full items-center justify-center" style={{ background: "var(--gradient-bg)" }}>
      <div className="flex flex-col items-center gap-8 text-center max-w-lg px-6 animate-fade-in">
        {/* Icon */}
        <div
          className="p-6 rounded-2xl"
          style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-subtle)" }}
        >
          <Building2 className="h-12 w-12" style={{ color: "var(--text-secondary)" }} />
        </div>

        {/* Message */}
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
            No workspace yet
          </h1>
          <p style={{ color: "var(--text-secondary)", lineHeight: 1.6 }}>
            You're not a member of any workspace. Create a new one to get started, or ask your administrator to add you
            to an existing workspace.
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button
            onClick={onCreateWorkspace}
            className="group relative overflow-hidden rounded-xl px-6 py-3 font-medium transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{
              background: "var(--gradient-accent)",
              color: "white",
              boxShadow: "0 0 20px var(--accent-glow)",
            }}
          >
            <span className="relative z-10 flex items-center justify-center gap-2">
              <Plus className="h-4 w-4" />
              Create Workspace
            </span>
          </button>

          <button
            onClick={() => (window.location.href = "/api/auth/logout")}
            className="rounded-xl px-6 py-3 font-medium transition-colors"
            style={{
              background: "var(--bg-tertiary)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            Sign out
          </button>
        </div>

        {/* Help text */}
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Need help? Contact your organization admin.
        </p>
      </div>
    </div>
  )
}

// ============================================================================
// Create Workspace Modal
// ============================================================================
function CreateWorkspaceModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("")
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!name.trim() || isCreating) return

    setIsCreating(true)
    setError(null)

    try {
      const res = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: name.trim() }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to create workspace")
      }

      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setIsCreating(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleCreate()
    } else if (e.key === "Escape") {
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.8)" }}>
      <div
        className="w-full max-w-md rounded-2xl p-6 animate-fade-in"
        style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-subtle)" }}
        onKeyDown={handleKeyDown}
      >
        <h2 className="text-xl font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
          Create a workspace
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm mb-2" style={{ color: "var(--text-secondary)" }}>
              Workspace name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Inc."
              className="w-full rounded-lg px-4 py-3 text-sm outline-none transition-colors"
              style={{
                background: "var(--bg-tertiary)",
                border: "1px solid var(--border-subtle)",
                color: "var(--text-primary)",
              }}
              autoFocus
            />
          </div>

          {error && (
            <p className="text-sm" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={onClose}
              className="flex-1 rounded-lg px-4 py-2.5 font-medium transition-colors"
              style={{
                background: "var(--bg-tertiary)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!name.trim() || isCreating}
              className="flex-1 rounded-lg px-4 py-2.5 font-medium transition-all disabled:opacity-50"
              style={{
                background: "var(--accent-secondary)",
                color: "white",
              }}
            >
              {isCreating ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Sidebar
// ============================================================================
function Sidebar({
  workspace,
  channels,
  activeChannelSlug,
  onSelectChannel,
}: {
  workspace: BootstrapData["workspace"]
  channels: BootstrapChannel[]
  activeChannelSlug: string | null
  onSelectChannel: (channel: BootstrapChannel) => void
}) {
  return (
    <div
      className="w-64 flex-none flex flex-col h-full"
      style={{ background: "var(--bg-secondary)", borderRight: "1px solid var(--border-subtle)" }}
    >
      {/* Workspace Header */}
      <div
        className="p-4 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center font-semibold text-sm"
            style={{ background: "var(--gradient-accent)" }}
          >
            {workspace.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div
              className="font-semibold text-sm truncate"
              style={{ color: "var(--text-primary)", fontFamily: "var(--font-sans)" }}
            >
              {workspace.name}
            </div>
            <div className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
              {workspace.plan_tier}
            </div>
          </div>
        </div>
        <ChevronDown className="h-4 w-4 flex-shrink-0" style={{ color: "var(--text-muted)" }} />
      </div>

      {/* Channels */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="mb-2 px-2 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
            Channels
          </span>
          <button
            className="p-1 rounded hover:bg-white/10 transition-colors"
            style={{ color: "var(--text-muted)" }}
            title="Add channel"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="space-y-0.5">
          {channels.map((channel) => (
            <button
              key={channel.id}
              onClick={() => onSelectChannel(channel)}
              className={clsx(
                "w-full text-left px-2 py-1.5 rounded-lg flex items-center gap-2 transition-colors group",
                activeChannelSlug === channel.slug ? "bg-white/10" : "hover:bg-white/5",
              )}
            >
              <Hash
                className="h-4 w-4 flex-shrink-0"
                style={{ color: activeChannelSlug === channel.slug ? "var(--accent-primary)" : "var(--text-muted)" }}
              />
              <span
                className="text-sm truncate flex-1"
                style={{
                  color: activeChannelSlug === channel.slug ? "var(--text-primary)" : "var(--text-secondary)",
                  fontWeight: channel.unread_count > 0 ? 600 : 400,
                }}
              >
                {channel.name.replace("#", "")}
              </span>
              {channel.unread_count > 0 && (
                <span
                  className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                  style={{ background: "var(--accent-secondary)", color: "white" }}
                >
                  {channel.unread_count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* User Footer */}
      <div className="p-3" style={{ borderTop: "1px solid var(--border-subtle)" }}>
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium"
            style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}
          >
            U
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm truncate" style={{ color: "var(--text-primary)" }}>
              You
            </div>
            <div className="text-xs flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ background: "var(--success)" }} />
              <span style={{ color: "var(--text-muted)" }}>Online</span>
            </div>
          </div>
          <button
            className="p-1.5 rounded hover:bg-white/10 transition-colors"
            style={{ color: "var(--text-muted)" }}
            title="Settings"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Main Layout
// ============================================================================
export function LayoutSystem() {
  const { isAuthenticated, state, user } = useAuth()

  // Bootstrap state
  const [bootstrapData, setBootstrapData] = useState<BootstrapData | null>(null)
  const [bootstrapLoading, setBootstrapLoading] = useState(false)
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)
  const [noWorkspace, setNoWorkspace] = useState(false)
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false)

  // Pane state
  const [panes, setPanes] = useState<Pane[]>([])
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null)
  const [activeChannelSlug, setActiveChannelSlug] = useState<string | null>(null)
  const initializedFromUrl = useRef(false)

  // Fetch bootstrap data when authenticated
  useEffect(() => {
    if (!isAuthenticated || state !== "loaded") return

    const fetchBootstrap = async () => {
      setBootstrapLoading(true)
      setBootstrapError(null)

      try {
        // First, get user's workspaces
        const meRes = await fetch("/api/auth/me", { credentials: "include" })
        if (!meRes.ok) throw new Error("Failed to fetch user")

        // For now, get first workspace from workspace_members
        // In a real app, you'd have a workspace selector
        const wsRes = await fetch("/api/workspace/default/bootstrap", { credentials: "include" })

        if (wsRes.status === 404 || wsRes.status === 403) {
          // No workspace
          setNoWorkspace(true)
          setBootstrapLoading(false)
          return
        }

        if (!wsRes.ok) {
          throw new Error("Failed to fetch workspace data")
        }

        const data = (await wsRes.json()) as BootstrapData
        setBootstrapData(data)

        // Try to restore panes from URL
        const urlParams = new URLSearchParams(window.location.search)
        const paneParam = urlParams.get("p")
        const restoredPanes = deserializePanesFromUrl(paneParam || "", data.channels)

        if (restoredPanes && restoredPanes.length > 0) {
          // Restore from URL
          setPanes(restoredPanes)
          setFocusedPaneId(restoredPanes[0].id)

          // Set active channel from first channel tab found
          const firstChannelTab = restoredPanes
            .flatMap((p) => p.tabs)
            .find((t) => t.type === "channel")
          if (firstChannelTab?.data?.channelId) {
            setActiveChannelSlug(firstChannelTab.data.channelId)
          }
          initializedFromUrl.current = true
        } else if (data.channels.length > 0) {
          // Default: Initialize panes with first channel
          const firstChannel = data.channels[0]
          setActiveChannelSlug(firstChannel.slug)
          const defaultPanes: Pane[] = [
            {
              id: "pane-0",
              tabs: [
                {
                  id: firstChannel.slug,
                  title: `#${firstChannel.name.replace("#", "")}`,
                  type: "channel",
                  data: { channelId: firstChannel.slug },
                },
              ],
              activeTabId: firstChannel.slug,
            },
          ]
          setPanes(defaultPanes)
          setFocusedPaneId("pane-0")
          // Update URL with default state
          updateUrlWithPanes(defaultPanes)
        }
      } catch (err) {
        console.error("Bootstrap error:", err)
        setBootstrapError(err instanceof Error ? err.message : "Failed to load workspace")
      } finally {
        setBootstrapLoading(false)
      }
    }

    fetchBootstrap()
  }, [isAuthenticated, state])

  // Sync pane changes to URL
  useEffect(() => {
    // Skip the initial render and URL restoration
    if (panes.length > 0 && bootstrapData) {
      updateUrlWithPanes(panes, shouldPushHistory.current)
      shouldPushHistory.current = false
    }
  }, [panes, bootstrapData])

  // Handle browser back/forward navigation
  useEffect(() => {
    if (!bootstrapData) return

    const handlePopState = () => {
      const urlParams = new URLSearchParams(window.location.search)
      const paneParam = urlParams.get("p")
      const restoredPanes = deserializePanesFromUrl(paneParam || "", bootstrapData.channels)

      if (restoredPanes && restoredPanes.length > 0) {
        setPanes(restoredPanes)
        setFocusedPaneId(restoredPanes[0].id)

        const firstChannelTab = restoredPanes
          .flatMap((p) => p.tabs)
          .find((t) => t.type === "channel")
        if (firstChannelTab?.data?.channelId) {
          setActiveChannelSlug(firstChannelTab.data.channelId)
        }
      }
    }

    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [bootstrapData])

  // Track if we should push to history on next pane update
  const shouldPushHistory = useRef(false)

  // Open item in a new pane to the side
  const openItemToSide = useCallback(
    (item: Omit<Tab, "id">) => {
      shouldPushHistory.current = true
      setPanes((prev) => {
        const focusedIndex = prev.findIndex((p) => p.id === focusedPaneId)
        if (focusedIndex === -1) return prev

        const targetIndex = focusedIndex + 1
        const newTabId = `${item.type}-${Date.now()}`
        const newTab: Tab = { ...item, id: newTabId }

        if (targetIndex < prev.length) {
          // Add to existing pane on the right
          return prev.map((pane, index) => {
            if (index === targetIndex) {
              return { ...pane, tabs: [...pane.tabs, newTab], activeTabId: newTabId }
            }
            return pane
          })
        }

        // Create new pane
        const newPaneId = `pane-${Date.now()}`
        return [...prev, { id: newPaneId, tabs: [newTab], activeTabId: newTabId }]
      })
    },
    [focusedPaneId],
  )

  // Replace current tab in focused pane
  const openItemInPlace = useCallback(
    (item: Omit<Tab, "id">) => {
      shouldPushHistory.current = true
      setPanes((prev) => {
        const focusedIndex = prev.findIndex((p) => p.id === focusedPaneId)
        if (focusedIndex === -1) return prev

        const newTabId = `${item.type}-${Date.now()}`
        const newTab: Tab = { ...item, id: newTabId }

        return prev.map((pane, index) => {
          if (index === focusedIndex) {
            // Replace the active tab
            const newTabs = pane.tabs.map((tab) => (tab.id === pane.activeTabId ? newTab : tab))
            return { ...pane, tabs: newTabs, activeTabId: newTabId }
          }
          return pane
        })
      })
    },
    [focusedPaneId],
  )

  // Open item based on mode
  const openItem = useCallback(
    (item: Omit<Tab, "id">, mode: OpenMode = "side") => {
      if (mode === "newTab") {
        // Open in new browser tab with proper URL state
        // Create a single-pane URL for the new tab
        const newTabUrl = new URL(window.location.origin)
        if (item.type === "thread" && item.data?.threadId) {
          newTabUrl.searchParams.set("p", `t:${item.data.threadId}:${item.data.channelId || ""}`)
        } else if (item.type === "channel" && item.data?.channelId) {
          newTabUrl.searchParams.set("p", `c:${item.data.channelId}`)
        }
        window.open(newTabUrl.toString(), "_blank")
        return
      }

      if (mode === "replace") {
        openItemInPlace(item)
      } else {
        openItemToSide(item)
      }
    },
    [openItemInPlace, openItemToSide],
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
          return { ...pane, tabs: newTabs, activeTabId: newActiveId }
        })
        .filter((pane) => pane.tabs.length > 0)
      return newPanes
    })
  }

  const setActiveTab = (paneId: string, tabId: string) => {
    setPanes((prev) => prev.map((p) => (p.id === paneId ? { ...p, activeTabId: tabId } : p)))
    setFocusedPaneId(paneId)
  }

  const handleSelectChannel = (channel: BootstrapChannel) => {
    setActiveChannelSlug(channel.slug)
    shouldPushHistory.current = true
    // Update first pane's first tab to this channel
    setPanes((prev) => {
      if (prev.length === 0) {
        return [
          {
            id: "pane-0",
            tabs: [
              {
                id: channel.slug,
                title: `#${channel.name.replace("#", "")}`,
                type: "channel",
                data: { channelId: channel.slug },
              },
            ],
            activeTabId: channel.slug,
          },
        ]
      }
      return prev.map((pane, idx) => {
        if (idx === 0) {
          // Replace active tab or first tab
          const existingTab = pane.tabs.find((t) => t.data?.channelId === channel.slug)
          if (existingTab) {
            return { ...pane, activeTabId: existingTab.id }
          }
          const newTab: Tab = {
            id: channel.slug,
            title: `#${channel.name.replace("#", "")}`,
            type: "channel",
            data: { channelId: channel.slug },
          }
          return { ...pane, tabs: [newTab, ...pane.tabs.slice(1)], activeTabId: newTab.id }
        }
        return pane
      })
    })
  }

  // Loading states
  if (state === "new" || state === "loading") {
    return <LoadingScreen />
  }

  if (!isAuthenticated) {
    return <LoginScreen />
  }

  if (bootstrapLoading) {
    return <LoadingScreen />
  }

  if (noWorkspace) {
    return (
      <>
        <NoWorkspaceScreen onCreateWorkspace={() => setShowCreateWorkspace(true)} />
        {showCreateWorkspace && (
          <CreateWorkspaceModal
            onClose={() => setShowCreateWorkspace(false)}
            onCreated={() => {
              setShowCreateWorkspace(false)
              setNoWorkspace(false)
              // Trigger re-fetch
              window.location.reload()
            }}
          />
        )}
      </>
    )
  }

  if (bootstrapError || !bootstrapData) {
    return (
      <div className="flex h-screen w-full items-center justify-center" style={{ background: "var(--gradient-bg)" }}>
        <div className="text-center max-w-md px-6">
          <p style={{ color: "var(--danger)" }}>{bootstrapError || "Failed to load workspace"}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 rounded-lg"
            style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen w-full overflow-hidden" style={{ background: "var(--bg-primary)" }}>
      {/* Sidebar */}
      <Sidebar
        workspace={bootstrapData.workspace}
        channels={bootstrapData.channels}
        activeChannelSlug={activeChannelSlug}
        onSelectChannel={handleSelectChannel}
      />

      {/* Main Layout Area */}
      <div className="flex-1 min-w-0">
        {panes.length === 0 ? (
          <div className="flex h-full items-center justify-center" style={{ color: "var(--text-muted)" }}>
            <div className="text-center">
              <Hash className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Select a channel to start</p>
            </div>
          </div>
        ) : (
          <PanelGroup direction="horizontal">
            {panes.map((pane, index) => (
              <div key={pane.id} className="contents">
                {index > 0 && (
                  <PanelResizeHandle
                    className="w-1 transition-colors flex flex-col justify-center items-center group outline-none"
                    style={{ background: "var(--border-subtle)" }}
                  >
                    <div
                      className="h-8 w-0.5 rounded-full transition-colors"
                      style={{ background: "var(--border-default)" }}
                    />
                  </PanelResizeHandle>
                )}

                <Panel
                  minSize={20}
                  defaultSize={100 / panes.length}
                  className={clsx("flex flex-col transition-all duration-200 outline-none")}
                  style={{
                    borderRight: index < panes.length - 1 ? "1px solid var(--border-subtle)" : undefined,
                  }}
                  onClick={() => setFocusedPaneId(pane.id)}
                >
                  {/* Tabs Header */}
                  <div
                    className="flex h-10 items-center overflow-x-auto no-scrollbar"
                    style={{ background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-subtle)" }}
                  >
                    {pane.tabs.map((tab) => (
                      <div
                        key={tab.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          setActiveTab(pane.id, tab.id)
                        }}
                        className={clsx(
                          "flex items-center gap-2 px-3 py-2 text-xs font-medium cursor-pointer min-w-fit h-full select-none transition-colors",
                          pane.activeTabId === tab.id ? "bg-white/5" : "hover:bg-white/5",
                        )}
                        style={{
                          color: pane.activeTabId === tab.id ? "var(--text-primary)" : "var(--text-muted)",
                          borderBottom: pane.activeTabId === tab.id ? "2px solid var(--accent-primary)" : "2px solid transparent",
                        }}
                      >
                        {tab.type === "channel" ? (
                          <Hash className="h-3.5 w-3.5" />
                        ) : (
                          <MessageCircle className="h-3.5 w-3.5" />
                        )}
                        <span className="truncate max-w-[120px]">{tab.title}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            closeTab(pane.id, tab.id)
                          }}
                          className="rounded p-0.5 hover:bg-white/10 transition-colors"
                          style={{ color: "var(--text-muted)" }}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>

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
                        <ChatInterface
                          workspaceId={bootstrapData.workspace.id}
                          channelId={tab.data?.channelId}
                          threadId={tab.data?.threadId}
                          title={tab.title}
                          onOpenThread={(msgId, msgChannelId, mode) => {
                            setFocusedPaneId(pane.id)
                            openItem(
                              {
                                title: `Thread`,
                                type: "thread",
                                data: { threadId: msgId, channelId: msgChannelId },
                              },
                              mode,
                            )
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>
            ))}
          </PanelGroup>
        )}
      </div>
    </div>
  )
}
