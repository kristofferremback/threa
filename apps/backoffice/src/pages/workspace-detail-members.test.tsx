import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, waitFor, cleanup } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { WorkspaceDetailMembersPage } from "./workspace-detail-members"

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/workspaces/:id/members" element={<WorkspaceDetailMembersPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe("WorkspaceDetailMembersPage", () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("renders the empty state when there are no members", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ members: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )
    renderAt("/workspaces/ws_abc/members")

    await screen.findByText(/No members yet/)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/backoffice/workspaces/ws_abc/members"),
      expect.objectContaining({ method: "GET" })
    )
  })

  it("renders one row per member with role chips, status, and email", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          members: [
            {
              workosUserId: "user_01",
              email: "alice@example.com",
              firstName: "Alice",
              lastName: "Anderson",
              status: "active",
              roleSlugs: ["owner", "admin"],
              lastEventAt: new Date().toISOString(),
            },
            {
              workosUserId: "user_02",
              email: null,
              firstName: null,
              lastName: null,
              status: "pending",
              roleSlugs: [],
              lastEventAt: new Date().toISOString(),
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    )

    renderAt("/workspaces/ws_abc/members")

    await waitFor(() => {
      expect(screen.getByText("Alice Anderson")).toBeInTheDocument()
    })
    expect(screen.getByText("alice@example.com")).toBeInTheDocument()
    expect(screen.getByText("owner")).toBeInTheDocument()
    expect(screen.getByText("admin")).toBeInTheDocument()
    expect(screen.getByText("active")).toBeInTheDocument()
    // Member with no name or email falls back to the workos user id
    expect(screen.getByText("user_02")).toBeInTheDocument()
    expect(screen.getByText("pending")).toBeInTheDocument()
  })

  it("shows an error state when the request fails", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "boom", code: "INTERNAL" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    )

    renderAt("/workspaces/ws_abc/members")

    await screen.findByText(/Couldn't load members/)
  })
})
