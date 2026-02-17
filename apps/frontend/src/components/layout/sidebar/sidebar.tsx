import { useCallback, useEffect, useMemo, useRef } from "react"
import { RefreshCw } from "lucide-react"
import { useNavigate, useParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/auth"
import {
  useActivityCounts,
  useAllDrafts,
  useCreateStream,
  useDraftScratchpads,
  useUnreadCounts,
  useWorkspaceBootstrap,
  workspaceKeys,
} from "@/hooks"
import { useCoordinatedLoading, useSidebar } from "@/contexts"
import { Button } from "@/components/ui/button"
import { SidebarShell } from "./sidebar-shell"
import { SidebarHeader } from "./sidebar-header"
import { SidebarQuickLinks } from "./quick-links"
import { SidebarStreamList } from "./sidebar-stream-list"
import { HeaderSkeleton, QuickLinksSkeleton, StreamListSkeleton } from "./skeletons"
import { SidebarFooter } from "./sidebar-footer"
import { ALL_SECTIONS, SMART_SECTIONS } from "./config"
import { calculateUrgency, categorizeStream, sortStreams } from "./utils"
import type { StreamItemData } from "./types"
import { StreamTypes, Visibilities } from "@threa/types"

interface SidebarProps {
  workspaceId: string
}

export function Sidebar({ workspaceId }: SidebarProps) {
  const { phase } = useCoordinatedLoading()
  const {
    viewMode,
    setViewMode,
    collapsedSections,
    toggleSectionCollapsed,
    setSidebarHeight,
    setScrollContainerOffset,
  } = useSidebar()
  const { streamId: activeStreamId, "*": splat } = useParams<{ streamId: string; "*": string }>()
  const { data: bootstrap, isLoading, error, retryBootstrap } = useWorkspaceBootstrap(workspaceId)
  const createStream = useCreateStream(workspaceId)
  const { createDraft } = useDraftScratchpads(workspaceId)
  const { getUnreadCount } = useUnreadCounts(workspaceId)
  const { getMentionCount, unreadActivityCount } = useActivityCounts(workspaceId)
  const { drafts: allDrafts } = useAllDrafts(workspaceId)
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const draftCount = allDrafts.length
  const isDraftsPage = splat === "drafts" || window.location.pathname.endsWith("/drafts")
  const isActivityPage = splat === "activity" || window.location.pathname.endsWith("/activity")

  // Build set of streams the user is a member of (for filtering public channels)
  const memberStreamIds = useMemo(() => {
    const ids = new Set<string>()
    for (const m of bootstrap?.streamMemberships ?? []) ids.add(m.streamId)
    return ids
  }, [bootstrap?.streamMemberships])

  // Build set of muted streams (for suppressing unread badges)
  const mutedStreamIdSet = useMemo(() => new Set(bootstrap?.mutedStreamIds ?? []), [bootstrap?.mutedStreamIds])

  // Process streams into enriched data with urgency and section
  const processedStreams = useMemo(() => {
    if (!bootstrap?.streams) return []

    return bootstrap.streams
      .filter((stream) => {
        // Non-public streams always appear (bootstrap only includes them if user has access)
        if (stream.visibility !== Visibilities.PUBLIC) return true
        // Public channels: only show if user is a member
        return memberStreamIds.has(stream.id)
      })
      .map((stream): StreamItemData => {
        const unreadCount = getUnreadCount(stream.id)
        const mentionCount = getMentionCount(stream.id)
        const isMuted = mutedStreamIdSet.has(stream.id)
        const urgency = calculateUrgency(stream, unreadCount, mentionCount, isMuted)
        const section = categorizeStream(stream, unreadCount, urgency)

        return {
          ...stream,
          urgency,
          section,
        }
      })
  }, [bootstrap?.streams, memberStreamIds, mutedStreamIdSet, getUnreadCount, getMentionCount])

  // System streams are auto-created infrastructure — don't count toward "has content"
  const hasUserStreams = processedStreams.some((s) => s.type !== StreamTypes.SYSTEM)

  // Organize streams by section
  const streamsBySection = useMemo(() => {
    const important: StreamItemData[] = []
    const recentCandidates: StreamItemData[] = [] // All streams that could go in Recent
    const pinned: StreamItemData[] = []
    const other: StreamItemData[] = []

    for (const stream of processedStreams) {
      switch (stream.section) {
        case "important":
          important.push(stream)
          break
        case "recent":
          recentCandidates.push(stream)
          break
        case "pinned":
          pinned.push(stream)
          break
        case "other":
          other.push(stream)
          break
      }
    }

    // Sort each section using configured sort types
    sortStreams(important, SMART_SECTIONS.important.sortType, getUnreadCount)
    sortStreams(pinned, SMART_SECTIONS.pinned.sortType, getUnreadCount)
    sortStreams(other, SMART_SECTIONS.other.sortType, getUnreadCount)

    // Recent section: special filtering logic
    // Show unreads OR up to 5 most recent (excluding items already in Important)
    // - If no unreads: show at most 5 recent streams
    // - If <5 unreads: show unreads + remaining reads up to 5 total
    // - If ≥5 unreads: show all unreads
    sortStreams(recentCandidates, SMART_SECTIONS.recent.sortType, getUnreadCount)

    const recentUnreads = recentCandidates.filter((s) => getUnreadCount(s.id) > 0)
    const recentReads = recentCandidates.filter((s) => getUnreadCount(s.id) === 0)

    let recent: StreamItemData[]
    if (recentUnreads.length >= 5) {
      // Show all unreads when there are 5 or more
      recent = recentUnreads
    } else {
      // Show unreads + fill remaining slots with reads (up to 5 total)
      const remainingSlots = 5 - recentUnreads.length
      recent = [...recentUnreads, ...recentReads.slice(0, remainingSlots)]
    }

    // Limit Important to 10
    return {
      important: important.slice(0, 10),
      recent,
      pinned,
      other,
    }
  }, [processedStreams, getUnreadCount])

  // Organize streams by type for "All" view
  const streamsByType = useMemo(() => {
    const scratchpads: StreamItemData[] = []
    const channels: StreamItemData[] = []
    const dms: StreamItemData[] = []

    for (const stream of processedStreams) {
      if (stream.type === StreamTypes.SCRATCHPAD) {
        scratchpads.push(stream)
      } else if (stream.type === StreamTypes.CHANNEL) {
        channels.push(stream)
      } else if (stream.type === StreamTypes.DM || stream.type === StreamTypes.SYSTEM) {
        dms.push(stream)
      }
      // Note: threads are not shown in All view
    }

    // Sort each section using configured sort types
    sortStreams(scratchpads, ALL_SECTIONS.scratchpads.sortType, getUnreadCount)
    sortStreams(channels, ALL_SECTIONS.channels.sortType, getUnreadCount)
    sortStreams(dms, ALL_SECTIONS.dms.sortType, getUnreadCount)

    return { scratchpads, channels, dms }
  }, [processedStreams, getUnreadCount])

  const isSectionCollapsed = useCallback((section: string) => collapsedSections.includes(section), [collapsedSections])

  // Track sidebar and scroll container dimensions for position calculations
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = scrollContainerRef.current
    const sidebar = sidebarRef.current
    if (!container || !sidebar) return

    const updateDimensions = () => {
      // Get sidebar total height
      setSidebarHeight(sidebar.offsetHeight)

      // Calculate scroll container offset from sidebar top
      // This accounts for header + quick links sections
      const containerRect = container.getBoundingClientRect()
      const sidebarRect = sidebar.getBoundingClientRect()
      setScrollContainerOffset(containerRect.top - sidebarRect.top)
    }

    // Initial measurement
    updateDimensions()

    // Observe size changes on both elements
    const observer = new ResizeObserver(updateDimensions)
    observer.observe(container)
    observer.observe(sidebar)

    return () => observer.disconnect()
  }, [setSidebarHeight, setScrollContainerOffset])

  // During initial coordinated loading, show skeleton
  if (phase !== "ready") {
    return (
      <SidebarShell
        header={<HeaderSkeleton />}
        quickLinks={<QuickLinksSkeleton />}
        streamList={<StreamListSkeleton />}
      />
    )
  }

  // Show error state with retry button
  if (error && !bootstrap) {
    return (
      <SidebarShell
        header={<HeaderSkeleton />}
        quickLinks={null}
        streamList={
          <div className="flex flex-col items-center justify-center h-full p-4 text-center">
            <p className="text-sm text-muted-foreground mb-3">Failed to load workspace</p>
            <Button variant="outline" size="sm" onClick={retryBootstrap} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </div>
        }
      />
    )
  }

  const handleCreateScratchpad = async () => {
    const draftId = await createDraft("on")
    navigate(`/w/${workspaceId}/s/${draftId}`)
  }

  const handleCreateChannel = async () => {
    const name = prompt("Channel name:")
    if (!name?.trim()) return
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
    if (!slug) return

    const stream = await createStream.mutateAsync({ type: StreamTypes.CHANNEL, slug })
    queryClient.invalidateQueries({ queryKey: workspaceKeys.bootstrap(workspaceId) })
    navigate(`/w/${workspaceId}/s/${stream.id}`)
  }

  return (
    <SidebarShell
      sidebarRef={sidebarRef}
      header={
        <SidebarHeader
          workspaceName={bootstrap?.workspace.name ?? "Loading..."}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          hideViewToggle={!hasUserStreams}
        />
      }
      quickLinks={
        <SidebarQuickLinks
          workspaceId={workspaceId}
          isDraftsPage={isDraftsPage}
          draftCount={draftCount}
          isActivityPage={isActivityPage}
          unreadActivityCount={unreadActivityCount}
        />
      }
      streamList={
        <SidebarStreamList
          workspaceId={workspaceId}
          viewMode={viewMode}
          isLoading={isLoading}
          hasError={Boolean(error)}
          hasUserStreams={hasUserStreams}
          activeStreamId={activeStreamId}
          processedStreams={processedStreams}
          streamsBySection={streamsBySection}
          streamsByType={streamsByType}
          getUnreadCount={getUnreadCount}
          getMentionCount={getMentionCount}
          isSectionCollapsed={isSectionCollapsed}
          onToggleSectionCollapsed={toggleSectionCollapsed}
          onCreateScratchpad={handleCreateScratchpad}
          onCreateChannel={handleCreateChannel}
          scrollContainerRef={scrollContainerRef}
        />
      }
      footer={
        <SidebarFooter
          workspaceId={workspaceId}
          currentMember={bootstrap?.members.find((m) => m.userId === user?.id) ?? null}
        />
      }
    />
  )
}
