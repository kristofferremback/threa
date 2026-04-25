import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import type { WorkspaceBootstrap, WorkspaceRole } from "@threa/types"
import { invitationsApi } from "@/api/invitations"
import { workspacesApi } from "@/api/workspaces"
import { workspaceKeys } from "@/hooks/use-workspaces"
import { spyOnExport } from "@/test/spy"
import * as hooksModule from "@/hooks"
import * as inviteDialogModule from "./invite-dialog"
import * as selectModule from "@/components/ui/select"
import { UsersTab } from "./users-tab"

const mockListRoles = vi.fn()
const mockUpdateUserRole = vi.fn()
const mockListInvitations = vi.fn()
const mockRevokeInvitation = vi.fn()
const mockResendInvitation = vi.fn()
const inviteDialogRoles: WorkspaceRole[][] = []

function renderUsersTab(bootstrap: Partial<WorkspaceBootstrap>) {
  const workspaceId = "ws_1"
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), bootstrap)

  render(
    <QueryClientProvider client={queryClient}>
      <UsersTab workspaceId={workspaceId} />
    </QueryClientProvider>
  )
}

describe("UsersTab", () => {
  const roles: WorkspaceRole[] = [
    { slug: "member", name: "Member", description: null, permissions: ["messages:read"], type: "system" },
    {
      slug: "support-admin",
      name: "Support Admin",
      description: null,
      permissions: ["messages:read", "members:write"],
      type: "custom",
    },
  ]

  beforeEach(() => {
    vi.restoreAllMocks()
    mockListRoles.mockReset()
    mockUpdateUserRole.mockReset()
    mockListInvitations.mockReset()
    mockRevokeInvitation.mockReset()
    mockResendInvitation.mockReset()
    inviteDialogRoles.length = 0

    mockListRoles.mockResolvedValue(roles)
    mockUpdateUserRole.mockResolvedValue({})
    mockListInvitations.mockResolvedValue([])

    vi.spyOn(workspacesApi, "listRoles").mockImplementation((...args) => mockListRoles(...args))
    vi.spyOn(workspacesApi, "updateUserRole").mockImplementation((...args) => mockUpdateUserRole(...args))
    vi.spyOn(invitationsApi, "list").mockImplementation((...args) => mockListInvitations(...args))
    vi.spyOn(invitationsApi, "revoke").mockImplementation((...args) => mockRevokeInvitation(...args))
    vi.spyOn(invitationsApi, "resend").mockImplementation((...args) => mockResendInvitation(...args))
    vi.spyOn(hooksModule, "useFormattedDate").mockReturnValue({
      formatDate: () => "Apr 18, 2026",
      formatTime: () => "10:00",
      formatRelative: () => "4 days ago",
      formatFull: () => "Apr 18, 2026 10:00",
    })
    vi.spyOn(inviteDialogModule, "InviteDialog").mockImplementation((({ roles }: { roles: WorkspaceRole[] }) => {
      inviteDialogRoles.push(roles)
      return <div data-testid="invite-dialog">{roles.map((role) => role.name).join(", ")}</div>
    }) as unknown as typeof inviteDialogModule.InviteDialog)

    spyOnExport(selectModule, "Select").mockReturnValue((({
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
    )) as unknown as typeof selectModule.Select)
    spyOnExport(selectModule, "SelectTrigger").mockReturnValue(
      (({ children }: { children: ReactNode }) => children) as unknown as typeof selectModule.SelectTrigger
    )
    spyOnExport(selectModule, "SelectValue").mockReturnValue((({ placeholder }: { placeholder?: string }) => (
      <option value="">{placeholder ?? ""}</option>
    )) as unknown as typeof selectModule.SelectValue)
    spyOnExport(selectModule, "SelectContent").mockReturnValue(
      (({ children }: { children: ReactNode }) => children) as unknown as typeof selectModule.SelectContent
    )
    spyOnExport(selectModule, "SelectItem").mockReturnValue((({
      value,
      children,
    }: {
      value: string
      children: ReactNode
    }) => <option value={value}>{children}</option>) as unknown as typeof selectModule.SelectItem)
  })

  it("shows owner badges and passes fetched roles to the invite dialog", async () => {
    renderUsersTab({
      viewerPermissions: ["members:write"],
      users: [
        {
          id: "user_1",
          workspaceId: "ws_1",
          workosUserId: "wos_1",
          email: "owner@example.com",
          role: "admin",
          isOwner: true,
          assignedRole: { slug: "support-admin", name: "Support Admin" },
          assignedRoles: [{ slug: "support-admin", name: "Support Admin" }],
          canEditRole: true,
          slug: "owner",
          name: "Owner",
          description: null,
          avatarUrl: null,
          timezone: null,
          locale: null,
          pronouns: null,
          phone: null,
          githubUsername: null,
          setupCompleted: true,
          joinedAt: "2026-04-18T10:00:00Z",
        },
      ],
    })

    expect((await screen.findAllByText("Owner")).length).toBeGreaterThan(0)
    await waitFor(() => {
      expect(inviteDialogRoles.at(-1)).toEqual(roles)
    })
    expect(screen.getByTestId("invite-dialog")).toHaveTextContent("Member, Support Admin")
  })

  it("updates a member role inline", async () => {
    const user = userEvent.setup()

    renderUsersTab({
      viewerPermissions: ["members:write"],
      users: [
        {
          id: "user_1",
          workspaceId: "ws_1",
          workosUserId: "wos_1",
          email: "member@example.com",
          role: "user",
          isOwner: false,
          assignedRole: { slug: "member", name: "Member" },
          assignedRoles: [{ slug: "member", name: "Member" }],
          canEditRole: true,
          slug: "member",
          name: "Member User",
          description: null,
          avatarUrl: null,
          timezone: null,
          locale: null,
          pronouns: null,
          phone: null,
          githubUsername: null,
          setupCompleted: true,
          joinedAt: "2026-04-18T10:00:00Z",
        },
      ],
    })

    const select = await screen.findByDisplayValue("Member")
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Support Admin" })).toBeInTheDocument()
    })
    await user.selectOptions(select, "support-admin")

    await waitFor(() => {
      expect(mockUpdateUserRole).toHaveBeenCalledWith("ws_1", "user_1", { roleSlug: "support-admin" })
    })
  })

  it("disables role management when the viewer lacks members:write", async () => {
    renderUsersTab({
      viewerPermissions: ["messages:read"],
      users: [
        {
          id: "user_1",
          workspaceId: "ws_1",
          workosUserId: "wos_1",
          email: "member@example.com",
          role: "user",
          isOwner: false,
          assignedRole: { slug: "member", name: "Member" },
          assignedRoles: [{ slug: "member", name: "Member" }],
          canEditRole: true,
          slug: "member",
          name: "Member User",
          description: null,
          avatarUrl: null,
          timezone: null,
          locale: null,
          pronouns: null,
          phone: null,
          githubUsername: null,
          setupCompleted: true,
          joinedAt: "2026-04-18T10:00:00Z",
        },
      ],
    })

    expect(screen.getByRole("button", { name: "Invite" })).toBeDisabled()
    expect(mockListRoles).not.toHaveBeenCalled()
  })
})
