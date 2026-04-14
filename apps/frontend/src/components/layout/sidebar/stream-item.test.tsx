import { act, forwardRef, type MouseEvent, type ReactNode, type TouchEvent } from "react"
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest"
import { fireEvent, render, screen } from "@/test"
import { StreamTypes, Visibilities } from "@threa/types"
import { StreamItem } from "./stream-item"
import type { StreamItemData } from "./types"

const { collapseOnMobile, openStreamSettings, setMenuOpen } = vi.hoisted(() => ({
  collapseOnMobile: vi.fn(),
  openStreamSettings: vi.fn(),
  setMenuOpen: vi.fn(),
}))

const mobileState = vi.hoisted(() => ({
  isMobileValue: true,
}))

vi.mock("react-router-dom", () => ({
  Link: forwardRef<
    HTMLAnchorElement,
    {
      to: string
      children: ReactNode
      className?: string
      onClick?: (e: MouseEvent<HTMLAnchorElement>) => void
      onTouchStart?: (e: TouchEvent<HTMLAnchorElement>) => void
      onTouchEnd?: (e: TouchEvent<HTMLAnchorElement>) => void
      onTouchMove?: (e: TouchEvent<HTMLAnchorElement>) => void
      onContextMenu?: (e: MouseEvent<HTMLAnchorElement>) => void
    }
  >(function MockLink({ to, children, className, onClick, onTouchStart, onTouchEnd, onTouchMove, onContextMenu }, ref) {
    return (
      <a
        ref={ref}
        href={to}
        className={className}
        onClick={onClick}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onTouchMove={onTouchMove}
        onContextMenu={onContextMenu}
      >
        {children}
      </a>
    )
  }),
}))

vi.mock("@/contexts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/contexts")>()
  return {
    ...actual,
    useSidebar: () => ({
      collapseOnMobile,
      setMenuOpen,
      setUrgencyBlock: vi.fn(),
      sidebarHeight: 0,
      scrollContainerOffset: 0,
    }),
  }
})

vi.mock("@/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks")>()
  return {
    ...actual,
    isDraftId: () => false,
    useActors: () => ({
      getActorName: () => "Ariadne",
      getActorAvatar: () => null,
    }),
  }
})

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mobileState.isMobileValue,
}))

vi.mock("@/components/relative-time", () => ({
  RelativeTime: ({ date, className }: { date: string; className?: string }) => (
    <span className={className}>{date}</span>
  ),
}))

vi.mock("@/components/ui/drawer", () => ({
  Drawer: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
  DrawerContent: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  DrawerBody: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  DrawerDescription: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  DrawerTitle: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}))

vi.mock("@/components/stream-settings/use-stream-settings", () => ({
  useStreamSettings: () => ({
    openStreamSettings,
  }),
}))

vi.mock("./use-urgency-tracking", () => ({
  useUrgencyTracking: () => {},
}))

function createStream(overrides: Partial<StreamItemData> = {}): StreamItemData {
  return {
    id: "stream_general",
    workspaceId: "workspace_1",
    type: StreamTypes.CHANNEL,
    displayName: "General",
    slug: "general",
    description: null,
    visibility: Visibilities.PUBLIC,
    parentStreamId: null,
    parentMessageId: null,
    rootStreamId: null,
    companionMode: "off",
    companionPersonaId: null,
    createdBy: "user_1",
    createdAt: "2026-03-03T09:00:00Z",
    updatedAt: "2026-03-03T09:00:00Z",
    archivedAt: null,
    urgency: "activity",
    section: "recent",
    lastMessagePreview: {
      authorId: "user_1",
      authorType: "persona",
      content: "Latest update from the stream",
      createdAt: "2026-03-03T10:00:00Z",
    },
    ...overrides,
  }
}

describe("StreamItem", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    collapseOnMobile.mockReset()
    openStreamSettings.mockReset()
    setMenuOpen.mockReset()
    mobileState.isMobileValue = true
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("opens the mobile action drawer with the latest preview on long press", async () => {
    const stream = createStream()

    render(
      <StreamItem
        workspaceId="workspace_1"
        stream={stream}
        isActive={false}
        unreadCount={1}
        mentionCount={0}
        allStreams={[stream]}
      />
    )

    const link = screen.getByRole("link", { name: /general/i })

    fireEvent.touchStart(link, {
      touches: [{ clientX: 16, clientY: 16 }],
    })

    await act(async () => {
      vi.advanceTimersByTime(500)
    })

    expect(screen.getByText("Ariadne")).toBeInTheDocument()
    expect(screen.getByText("Latest update from the stream")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Settings" }))

    expect(openStreamSettings).toHaveBeenCalledWith("stream_general")
  })

  it("keeps compact hover previews hidden on mobile", () => {
    const stream = createStream()

    const { container } = render(
      <StreamItem
        workspaceId="workspace_1"
        stream={stream}
        isActive={false}
        unreadCount={1}
        mentionCount={0}
        allStreams={[stream]}
        compact
        showPreviewOnHover
      />
    )

    const preview = container.querySelector(".text-xs.text-muted-foreground")
    expect(preview).toHaveClass("hidden")
    expect(preview).not.toHaveClass("group-hover:flex")
  })

  it("opens a preview-only drawer for DMs on mobile", async () => {
    const stream = createStream({
      id: "stream_dm_1",
      type: StreamTypes.DM,
      displayName: "Taylor",
      slug: null,
      dmPeerUserId: "user_2",
    })

    render(
      <StreamItem
        workspaceId="workspace_1"
        stream={stream}
        isActive={false}
        unreadCount={1}
        mentionCount={0}
        allStreams={[stream]}
      />
    )

    const link = screen.getByRole("link", { name: /taylor/i })

    fireEvent.touchStart(link, {
      touches: [{ clientX: 16, clientY: 16 }],
    })

    await act(async () => {
      vi.advanceTimersByTime(500)
    })

    expect(screen.getAllByText("Taylor")).toHaveLength(2)
    expect(screen.getByText("Latest update from the stream")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Settings" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Stream actions" })).not.toBeInTheDocument()
  })

  it("shows a no-messages fallback preview for DMs without a last message", async () => {
    const stream = createStream({
      id: "stream_dm_2",
      type: StreamTypes.DM,
      displayName: "Jordan",
      slug: null,
      dmPeerUserId: "user_3",
      lastMessagePreview: null,
    })

    render(
      <StreamItem
        workspaceId="workspace_1"
        stream={stream}
        isActive={false}
        unreadCount={0}
        mentionCount={0}
        allStreams={[stream]}
      />
    )

    const link = screen.getByRole("link", { name: /jordan/i })

    fireEvent.touchStart(link, {
      touches: [{ clientX: 16, clientY: 16 }],
    })

    await act(async () => {
      vi.advanceTimersByTime(500)
    })

    expect(screen.getByText("No messages yet")).toBeInTheDocument()
    expect(screen.queryByText("Ariadne")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Settings" })).not.toBeInTheDocument()
  })

  it("does not render a desktop context-menu trigger for DMs", () => {
    mobileState.isMobileValue = false

    const stream = createStream({
      id: "stream_dm_1",
      type: StreamTypes.DM,
      displayName: "Taylor",
      slug: null,
      dmPeerUserId: "user_2",
    })

    render(
      <StreamItem
        workspaceId="workspace_1"
        stream={stream}
        isActive={false}
        unreadCount={1}
        mentionCount={0}
        allStreams={[stream]}
      />
    )

    expect(screen.queryByRole("button", { name: "Stream actions" })).not.toBeInTheDocument()
  })
})
