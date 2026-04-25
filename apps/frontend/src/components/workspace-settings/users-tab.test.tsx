import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { DEFAULT_WORKSPACE_ROLES, type WorkspaceBootstrap, type WorkspaceRole } from "@threa/types"
import { invitationsApi } from "@/api/invitations"
import { workspacesApi } from "@/api/workspaces"
import { workspaceKeys } from "@/hooks/use-workspaces"
import { spyOnExport } from "@/test/spy"
import * as authModule from "@/auth"
import * as hooksModule from "@/hooks"
import * as inviteDialogModule from "./invite-dialog"
import * as selectModule from "@/components/ui/select"
import * as sonnerModule from "sonner"
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

    vi.spyOn(sonnerModule.toast, "success").mockImplementation(() => "toast_id")
    vi.spyOn(sonnerModule.toast, "error").mockImplementation(() => "toast_id")
    vi.spyOn(authModule, "useUser").mockReturnValue({
      id: "wos_current",
      email: "current@example.com",
      name: "Current",
    })
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
      disabled,
      children,
    }: {
      value: string
      disabled?: boolean
      children: ReactNode
    }) => (
      <option value={value} disabled={disabled}>
        {children}
      </option>
    )) as unknown as typeof selectModule.SelectItem)
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

  it("falls back to built-in invite roles when cached role sources are empty", async () => {
    mockListRoles.mockResolvedValue([])

    renderUsersTab({
      viewerPermissions: ["members:write"],
      users: [],
      roles: [],
    })

    await waitFor(() => {
      expect(inviteDialogRoles.at(-1)?.map((role) => role.slug)).toEqual(
        DEFAULT_WORKSPACE_ROLES.map((role) => role.slug)
      )
    })
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
    await waitFor(() => {
      expect(sonnerModule.toast.success).toHaveBeenCalledWith("Role updated to Support Admin")
    })
  })

  it("only disables the row currently being updated", async () => {
    let resolveUpdate: (value: unknown) => void = () => {}
    mockUpdateUserRole.mockReturnValue(new Promise((resolve) => (resolveUpdate = resolve)))
    const user = userEvent.setup()

    renderUsersTab({
      viewerPermissions: ["members:write"],
      users: [
        createUser({ id: "user_1", workosUserId: "wos_1", assignedRole: { slug: "member", name: "Member" } }),
        createUser({ id: "user_2", workosUserId: "wos_2", assignedRole: { slug: "member", name: "Member" } }),
      ],
    })

    await waitFor(() => {
      expect(screen.getAllByRole("option", { name: "Support Admin" }).length).toBeGreaterThan(0)
    })
    const selects = await screen.findAllByDisplayValue("Member")
    await user.selectOptions(selects[0], "support-admin")

    await waitFor(() => {
      expect(selects[0]).toBeDisabled()
      expect(selects[1]).not.toBeDisabled()
    })
    resolveUpdate(
      createUser({
        id: "user_1",
        workosUserId: "wos_1",
        assignedRole: { slug: "support-admin", name: "Support Admin" },
      })
    )
  })

  it("prevents editing the current user's own role", async () => {
    vi.spyOn(authModule, "useUser").mockReturnValue({ id: "wos_1", email: "current@example.com", name: "Current" })

    renderUsersTab({
      viewerPermissions: ["members:write"],
      users: [createUser({ id: "user_1", workosUserId: "wos_1", assignedRole: { slug: "member", name: "Member" } })],
    })

    expect(await screen.findByDisplayValue("Member")).toBeDisabled()
  })

  it("disables demoting the last role manager", async () => {
    renderUsersTab({
      viewerPermissions: ["members:write"],
      users: [
        createUser({
          id: "user_1",
          workosUserId: "wos_1",
          assignedRole: { slug: "support-admin", name: "Support Admin" },
          assignedRoles: [{ slug: "support-admin", name: "Support Admin" }],
        }),
        createUser({ id: "user_2", workosUserId: "wos_2", assignedRole: { slug: "member", name: "Member" } }),
      ],
    })

    await waitFor(() => {
      expect(screen.getAllByRole("option", { name: "Member" })[0]).toBeDisabled()
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

function createUser(
  overrides: Partial<WorkspaceBootstrap["users"][number]> & {
    id: string
    workosUserId: string
    assignedRole?: { slug: string; name: string } | null
  }
): WorkspaceBootstrap["users"][number] {
  const assignedRole = overrides.assignedRole ?? { slug: "member", name: "Member" }
  return {
    workspaceId: "ws_1",
    email: `${overrides.id}@example.com`,
    role: assignedRole?.slug === "member" ? "user" : "admin",
    isOwner: false,
    assignedRole,
    assignedRoles: assignedRole ? [assignedRole] : [],
    canEditRole: true,
    slug: overrides.id,
    name: overrides.id,
    description: null,
    avatarUrl: null,
    timezone: null,
    locale: null,
    pronouns: null,
    phone: null,
    githubUsername: null,
    setupCompleted: true,
    joinedAt: "2026-04-18T10:00:00Z",
    ...overrides,
    id: overrides.id,
    workosUserId: overrides.workosUserId,
  }
}
