import type { ReactNode } from "react"
import { describe, expect, it, beforeEach, vi } from "vitest"
import { render, screen, userEvent } from "@/test"
import { SidebarFooter } from "./sidebar-footer"

const { logout, openSettings, collapseOnMobile, setSearchParams } = vi.hoisted(() => ({
  logout: vi.fn(),
  openSettings: vi.fn(),
  collapseOnMobile: vi.fn(),
  setSearchParams: vi.fn(),
}))

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
  useSearchParams: () => [new URLSearchParams(), setSearchParams],
}))

vi.mock("@/auth", () => ({
  useAuth: () => ({
    logout,
  }),
}))

vi.mock("@/contexts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/contexts")>()
  return {
    ...actual,
    useSettings: () => ({
      openSettings,
    }),
    useSidebar: () => ({
      collapseOnMobile,
      setMenuOpen: vi.fn(),
    }),
  }
})

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => true,
}))

vi.mock("@/components/ui/drawer", () => ({
  Drawer: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
  DrawerContent: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  DrawerDescription: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  DrawerTitle: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}))

describe("SidebarFooter", () => {
  beforeEach(() => {
    logout.mockReset()
    openSettings.mockReset()
    collapseOnMobile.mockReset()
    setSearchParams.mockReset()
  })

  it("opens the mobile account drawer on tap and exposes the same actions", async () => {
    const user = userEvent.setup()

    render(
      <SidebarFooter
        workspaceId="workspace_1"
        currentUser={{
          id: "user_1",
          workspaceId: "workspace_1",
          workosUserId: "workos_user_1",
          email: "kris@example.com",
          role: "user",
          slug: "kris",
          name: "Kris",
          description: null,
          avatarUrl: null,
          timezone: "Europe/Stockholm",
          locale: "en-SE",
          setupCompleted: true,
          joinedAt: "2026-03-03T10:00:00Z",
        }}
      />
    )

    await user.click(screen.getByRole("button", { name: /kris/i }))

    expect(screen.getByText("kris@example.com")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "AI Usage" })).toHaveAttribute("href", "/w/workspace_1/admin/ai-usage")

    await user.click(screen.getByRole("button", { name: "Settings" }))

    expect(openSettings).toHaveBeenCalledWith("appearance")
    expect(collapseOnMobile).toHaveBeenCalled()
  })
})
