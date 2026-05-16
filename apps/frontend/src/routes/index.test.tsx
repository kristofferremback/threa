import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { LegacyMemoRedirect, RootRedirect, WorkspaceHome } from "./index"
import * as useLastStreamModule from "@/hooks/use-last-stream"
import * as sidebarContextModule from "@/contexts/sidebar-context"
import { clearLastWorkspaceId, setLastWorkspaceId } from "@/lib/last-workspace"

const mockUseLastStream = vi.fn()
const mockTogglePinned = vi.fn()

function SearchEcho() {
  const location = useLocation()
  return <div data-testid="search">{location.search}</div>
}

function PathEcho() {
  const location = useLocation()
  return <div data-testid="path">{location.pathname}</div>
}

describe("RootRedirect", () => {
  beforeEach(() => clearLastWorkspaceId())

  it("sends a returning user straight to their last workspace", async () => {
    setLastWorkspaceId("ws_abc")
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/w/:workspaceId" element={<PathEcho />} />
          <Route path="/workspaces" element={<PathEcho />} />
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findByTestId("path")).toHaveTextContent("/w/ws_abc")
  })

  it("falls back to the workspace picker when no last workspace is recorded", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/w/:workspaceId" element={<PathEcho />} />
          <Route path="/workspaces" element={<PathEcho />} />
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findByTestId("path")).toHaveTextContent("/workspaces")
  })
})

describe("WorkspaceHome", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockUseLastStream.mockReset()
    mockTogglePinned.mockReset()
    vi.spyOn(useLastStreamModule, "useLastStream").mockImplementation(
      (...args) => mockUseLastStream(...args) as ReturnType<typeof useLastStreamModule.useLastStream>
    )
    vi.spyOn(sidebarContextModule, "useSidebar").mockReturnValue({
      state: "expanded",
      togglePinned: mockTogglePinned,
    } as unknown as ReturnType<typeof sidebarContextModule.useSidebar>)

    mockUseLastStream.mockReturnValue({
      redirectStreamId: "stream_123",
      shouldOpenSidebar: false,
    })
  })

  it("preserves workspace search params when redirecting to the last stream", async () => {
    render(
      <MemoryRouter initialEntries={["/w/ws_123?ws-settings=bots"]}>
        <Routes>
          <Route path="/w/:workspaceId" element={<WorkspaceHome />} />
          <Route path="/w/:workspaceId/s/:streamId" element={<SearchEcho />} />
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findByTestId("search")).toHaveTextContent("?ws-settings=bots")
  })

  it("redirects legacy memo routes into the memory explorer", async () => {
    render(
      <MemoryRouter initialEntries={["/w/ws_123/memos/memo_456?q=launch"]}>
        <Routes>
          <Route path="/w/:workspaceId/memos/:memoId" element={<LegacyMemoRedirect />} />
          <Route path="/w/:workspaceId/memory" element={<SearchEcho />} />
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findByTestId("search")).toHaveTextContent("?q=launch&memo=memo_456")
  })
})
