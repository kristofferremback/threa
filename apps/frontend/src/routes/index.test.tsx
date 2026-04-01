import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { WorkspaceHome } from "./index"

const mockUseLastStream = vi.fn()
const mockTogglePinned = vi.fn()

vi.mock("@/hooks", () => ({
  useLastStream: (...args: unknown[]) => mockUseLastStream(...args),
}))

vi.mock("@/contexts", () => ({
  useSidebar: () => ({
    state: "expanded",
    togglePinned: mockTogglePinned,
  }),
}))

function SearchEcho() {
  const location = useLocation()
  return <div data-testid="search">{location.search}</div>
}

describe("WorkspaceHome", () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
