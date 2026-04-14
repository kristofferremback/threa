import { Archive, Settings } from "lucide-react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { render, screen, userEvent, waitFor } from "@/test"
import { SidebarActionDrawer, SidebarActionMenu, type SidebarActionItem } from "./sidebar-actions"

vi.mock("react-router-dom", () => ({
  Link: ({
    to,
    children,
    className,
    onClick,
  }: {
    to: string
    children: ReactNode
    className?: string
    onClick?: () => void
  }) => (
    <a href={to} className={className} onClick={onClick}>
      {children}
    </a>
  ),
}))

const { setMenuOpen } = vi.hoisted(() => ({
  setMenuOpen: vi.fn(),
}))

const { toastError } = vi.hoisted(() => ({
  toastError: vi.fn(),
}))

vi.mock("@/contexts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/contexts")>()
  return {
    ...actual,
    useSidebar: () => ({
      setMenuOpen,
    }),
  }
})

vi.mock("@/components/relative-time", () => ({
  RelativeTime: ({ date, className }: { date: string; className?: string }) => (
    <span className={className}>{date}</span>
  ),
}))

vi.mock("@/components/ui/drawer", () => ({
  Drawer: ({ open, children }: { open: boolean; children: ReactNode }) => (
    <div data-testid="drawer-root" data-state={open ? "open" : "closed"}>
      {open ? children : null}
    </div>
  ),
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

vi.mock("sonner", () => ({
  toast: {
    error: toastError,
  },
}))

describe("SidebarActionMenu", () => {
  it("renders the desktop trigger and menu actions", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const actions: SidebarActionItem[] = [
      {
        id: "settings",
        label: "Settings",
        icon: Settings,
        onSelect,
      },
    ]

    render(<SidebarActionMenu actions={actions} ariaLabel="Stream actions" />)

    await user.click(screen.getByRole("button", { name: "Stream actions" }))
    await user.click(screen.getByText("Settings"))

    expect(onSelect).toHaveBeenCalled()
  })
})

describe("SidebarActionDrawer", () => {
  it("renders the stream preview and closes before invoking the selected action", async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onArchive = vi.fn()

    render(
      <SidebarActionDrawer
        title="Actions for General"
        description="Choose an action for this stream."
        open={true}
        onOpenChange={onOpenChange}
        actions={[
          {
            id: "archive",
            label: "Archive",
            icon: Archive,
            onSelect: onArchive,
            variant: "destructive",
          },
        ]}
        preview={{
          streamName: "General",
          authorName: "Ariadne",
          content: "Latest update from the stream",
          createdAt: "2026-03-03T10:00:00Z",
        }}
      />
    )

    expect(screen.getByText("Ariadne")).toBeInTheDocument()
    expect(screen.getByText("Latest update from the stream")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Archive" }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onArchive).toHaveBeenCalled()
  })

  it("renders a custom header when provided", () => {
    render(
      <SidebarActionDrawer
        open={true}
        onOpenChange={vi.fn()}
        actions={[]}
        title="Account menu"
        description="Choose an account action."
        header={<div>Signed in as Kris</div>}
      />
    )

    expect(screen.getByText("Signed in as Kris")).toBeInTheDocument()
  })

  it("keeps preview-only drawers mounted while closing", () => {
    render(
      <SidebarActionDrawer
        open={false}
        onOpenChange={vi.fn()}
        actions={[]}
        title="Actions for Taylor"
        description="Choose an action for this stream."
        preview={{
          streamName: "Taylor",
          content: "No messages yet",
        }}
      />
    )

    expect(screen.getByTestId("drawer-root")).toHaveAttribute("data-state", "closed")
  })

  it("renders link actions as anchors", () => {
    render(
      <SidebarActionDrawer
        open={true}
        onOpenChange={vi.fn()}
        actions={[
          {
            id: "ai-usage",
            label: "AI Usage",
            icon: Archive,
            href: "/w/workspace_1/admin/ai-usage",
          },
        ]}
        title="Account menu"
        description="Choose an account action."
      />
    )

    expect(screen.getByRole("link", { name: "AI Usage" })).toHaveAttribute("href", "/w/workspace_1/admin/ai-usage")
  })

  it("surfaces async action failures", async () => {
    const user = userEvent.setup()
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const error = new Error("Archive failed")

    render(
      <SidebarActionDrawer
        open={true}
        onOpenChange={vi.fn()}
        actions={[
          {
            id: "archive",
            label: "Archive",
            icon: Archive,
            onSelect: vi.fn().mockRejectedValue(error),
          },
        ]}
      />
    )

    await user.click(screen.getByRole("button", { name: "Archive" }))

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("Archive failed")
      expect(consoleErrorSpy).toHaveBeenCalledWith('Sidebar action "archive" failed:', error)
    })

    consoleErrorSpy.mockRestore()
  })
})
