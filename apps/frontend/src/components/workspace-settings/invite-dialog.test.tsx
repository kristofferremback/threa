import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import type { WorkspaceRole } from "@threa/types"
import { InviteDialog } from "./invite-dialog"

const mockSendInvitations = vi.fn()

vi.mock("@/api/invitations", () => ({
  invitationsApi: {
    send: (...args: unknown[]) => mockSendInvitations(...args),
  },
}))

vi.mock("@/components/ui/responsive-dialog", () => ({
  ResponsiveDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResponsiveDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResponsiveDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResponsiveDialogTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
  ResponsiveDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string
    onValueChange?: (value: string) => void
    disabled?: boolean
    children: ReactNode
  }) => (
    <select value={value} onChange={(event) => onValueChange?.(event.target.value)} disabled={disabled}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => children,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <option value="">{placeholder ?? ""}</option>,
  SelectContent: ({ children }: { children: ReactNode }) => children,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}))

function renderInviteDialog(roles: WorkspaceRole[]) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <InviteDialog workspaceId="ws_1" roles={roles} open={true} onOpenChange={() => {}} onSuccess={() => {}} />
    </QueryClientProvider>
  )
}

describe("InviteDialog", () => {
  beforeEach(() => {
    mockSendInvitations.mockReset()
    mockSendInvitations.mockResolvedValue({ sent: [], skipped: [] })
  })

  it("maps admin-capable WorkOS roles to the legacy admin compatibility role", async () => {
    const user = userEvent.setup()

    renderInviteDialog([
      { slug: "member", name: "Member", description: null, permissions: ["messages:read"], type: "system" },
      {
        slug: "support-admin",
        name: "Support Admin",
        description: null,
        permissions: ["messages:read", "workspace:admin"],
        type: "custom",
      },
    ])

    await user.type(screen.getByLabelText("Email addresses"), "owner@example.com")
    await user.selectOptions(screen.getByDisplayValue("Member"), "support-admin")
    await user.click(screen.getByRole("button", { name: "Send Invitations" }))

    await waitFor(() => {
      expect(mockSendInvitations).toHaveBeenCalledWith("ws_1", {
        emails: ["owner@example.com"],
        role: "admin",
        roleSlug: "support-admin",
      })
    })
  })
})
