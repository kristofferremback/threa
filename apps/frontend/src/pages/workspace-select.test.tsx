import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom"
import { render, screen } from "@/test"
import { WorkspaceSelectPage } from "./workspace-select"
import type { Workspace } from "@threa/types"

const mockUseAuth = vi.fn()
const mockUseWorkspaces = vi.fn()
const mockUseCreateWorkspace = vi.fn()

vi.mock("@/auth", () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock("@/hooks", () => ({
  useWorkspaces: () => mockUseWorkspaces(),
  useCreateWorkspace: () => mockUseCreateWorkspace(),
}))

function WorkspaceRouteProbe() {
  const { workspaceId } = useParams()
  return <div data-testid="workspace-route">{workspaceId}</div>
}

function makeWorkspace(id: string, name: string): Workspace {
  return {
    id,
    name,
    slug: name.toLowerCase(),
    createdBy: "user_1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/workspaces"]}>
      <Routes>
        <Route path="/workspaces" element={<WorkspaceSelectPage />} />
        <Route path="/w/:workspaceId" element={<WorkspaceRouteProbe />} />
        <Route path="/login" element={<div data-testid="login-route">login</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe("WorkspaceSelectPage", () => {
  beforeEach(() => {
    mockUseAuth.mockReset()
    mockUseWorkspaces.mockReset()
    mockUseCreateWorkspace.mockReset()

    mockUseAuth.mockReturnValue({
      user: {
        id: "user_1",
        email: "kris@example.com",
        name: "Kris",
        workosUserId: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      loading: false,
      error: null,
    })

    mockUseCreateWorkspace.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
      error: null,
    })
  })

  it("should redirect to the only workspace when user has one workspace", async () => {
    mockUseWorkspaces.mockReturnValue({
      data: [makeWorkspace("workspace_1", "Solo")],
      isLoading: false,
      error: null,
    })

    renderPage()

    expect(await screen.findByTestId("workspace-route")).toHaveTextContent("workspace_1")
  })

  it("should show workspace picker when user has multiple workspaces", () => {
    mockUseWorkspaces.mockReturnValue({
      data: [makeWorkspace("workspace_1", "Alpha"), makeWorkspace("workspace_2", "Beta")],
      isLoading: false,
      error: null,
    })

    renderPage()

    expect(screen.getByText("Select a workspace to continue")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Alpha" })).toHaveAttribute("href", "/w/workspace_1")
    expect(screen.getByRole("link", { name: "Beta" })).toHaveAttribute("href", "/w/workspace_2")
  })
})
