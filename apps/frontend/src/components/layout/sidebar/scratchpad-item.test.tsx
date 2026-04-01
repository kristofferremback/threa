import { describe, expect, it, beforeEach, vi } from "vitest"
import { forwardRef, type MouseEvent, type ReactNode, type TouchEvent } from "react"
import { fireEvent, render, screen, waitFor } from "@/test"
import { StreamTypes, Visibilities } from "@threa/types"
import { ScratchpadItem } from "./scratchpad-item"
import type { StreamItemData } from "./types"

const { collapseOnMobile, archiveStream, navigate, deleteDraft, openStreamSettings } = vi.hoisted(() => ({
  collapseOnMobile: vi.fn(),
  archiveStream: vi.fn(async () => {}),
  navigate: vi.fn(),
  deleteDraft: vi.fn(async () => {}),
  openStreamSettings: vi.fn(),
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
  useNavigate: () => navigate,
}))

vi.mock("@/contexts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/contexts")>()
  return {
    ...actual,
    useSidebar: () => ({
      collapseOnMobile,
      setMenuOpen: vi.fn(),
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
    isDraftId: (id: string) => id.startsWith("draft_"),
    useActors: () => ({
      getActorName: () => "Ariadne",
      getActorAvatar: () => null,
    }),
    useArchiveStream: () => ({
      mutateAsync: archiveStream,
    }),
    useDraftScratchpads: () => ({
      deleteDraft,
    }),
    useStreamOrDraft: () => {
      throw new Error("ScratchpadItem should not call useStreamOrDraft")
    },
  }
})

vi.mock("@/components/stream-settings/use-stream-settings", () => ({
  useStreamSettings: () => ({
    openStreamSettings,
  }),
}))

vi.mock("./use-urgency-tracking", () => ({
  useUrgencyTracking: () => {},
}))

vi.mock("./use-sidebar-item-drawer", () => ({
  useSidebarItemDrawer: ({ collapseOnMobile }: { collapseOnMobile: () => void }) => ({
    drawerOpen: false,
    setDrawerOpen: vi.fn(),
    handleClick: () => collapseOnMobile(),
    isMobile: false,
    longPress: {
      handlers: {
        onTouchStart: undefined,
        onTouchEnd: undefined,
        onTouchMove: undefined,
        onContextMenu: undefined,
      },
      isPressed: false,
    },
  }),
}))

vi.mock("./sidebar-actions", () => ({
  SidebarActionMenu: ({
    actions,
    ariaLabel,
  }: {
    actions: Array<{ id: string; label: string; onSelect: () => void }>
    ariaLabel: string
  }) => (
    <div aria-label={ariaLabel}>
      {actions.map((action) => (
        <button key={action.id} type="button" onClick={action.onSelect}>
          {action.label}
        </button>
      ))}
    </div>
  ),
  SidebarActionDrawer: () => null,
}))

function createScratchpad(overrides: Partial<StreamItemData> = {}): StreamItemData {
  return {
    id: "stream_scratchpad_1",
    workspaceId: "workspace_1",
    type: StreamTypes.SCRATCHPAD,
    displayName: "Notes",
    slug: null,
    description: null,
    visibility: Visibilities.PRIVATE,
    parentStreamId: null,
    parentMessageId: null,
    rootStreamId: null,
    companionMode: "on",
    companionPersonaId: null,
    createdBy: "user_1",
    createdAt: "2026-03-03T09:00:00Z",
    updatedAt: "2026-03-03T09:00:00Z",
    archivedAt: null,
    urgency: "activity",
    section: "recent",
    lastMessagePreview: null,
    ...overrides,
  }
}

describe("ScratchpadItem", () => {
  beforeEach(() => {
    collapseOnMobile.mockReset()
    archiveStream.mockReset()
    navigate.mockReset()
    deleteDraft.mockReset()
    openStreamSettings.mockReset()
  })

  it("archives real scratchpads without mounting the page-level stream hook", async () => {
    render(
      <ScratchpadItem
        workspaceId="workspace_1"
        stream={createScratchpad()}
        isActive={false}
        unreadCount={0}
        mentionCount={0}
      />
    )

    expect(screen.getByText("Settings")).toBeInTheDocument()

    fireEvent.click(screen.getByText("Archive"))

    await waitFor(() => {
      expect(archiveStream).toHaveBeenCalledWith("stream_scratchpad_1")
    })
    expect(navigate).not.toHaveBeenCalled()
  })

  it("deletes draft scratchpads directly and navigates away when the active draft is removed", async () => {
    render(
      <ScratchpadItem
        workspaceId="workspace_1"
        stream={createScratchpad({ id: "draft_scratchpad_1", displayName: null })}
        isActive
        unreadCount={0}
        mentionCount={0}
      />
    )

    expect(screen.queryByText("Settings")).not.toBeInTheDocument()
    expect(screen.getByText("New scratchpad")).toBeInTheDocument()

    fireEvent.click(screen.getByText("Delete"))

    await waitFor(() => {
      expect(deleteDraft).toHaveBeenCalledWith("draft_scratchpad_1")
      expect(navigate).toHaveBeenCalledWith("/w/workspace_1")
    })
    expect(archiveStream).not.toHaveBeenCalled()
  })
})
