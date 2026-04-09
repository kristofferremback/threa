import { MemoryRouter, Route, Routes } from "react-router-dom"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, userEvent } from "@/test"
import { MemoryPage } from "./memory"

const mockUseMemoSearch = vi.fn()
const mockUseMemoDetail = vi.fn()
const mockUseWorkspaceStreams = vi.fn()

vi.mock("@/hooks", () => ({
  useMemoSearch: (...args: unknown[]) => mockUseMemoSearch(...args),
  useMemoDetail: (...args: unknown[]) => mockUseMemoDetail(...args),
}))

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStreams: (...args: unknown[]) => mockUseWorkspaceStreams(...args),
}))

vi.mock("@/components/relative-time", () => ({
  RelativeTime: () => <span>just now</span>,
}))

function renderPage(initialEntry = "/w/ws_1/memory?memo=memo_1") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/w/:workspaceId/memory" element={<MemoryPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe("MemoryPage", () => {
  beforeEach(() => {
    mockUseWorkspaceStreams.mockReset()
    mockUseMemoSearch.mockReset()
    mockUseMemoDetail.mockReset()

    mockUseWorkspaceStreams.mockReturnValue([])
  })

  it("manually refreshes the memo list and selected memo", async () => {
    const refetchSearch = vi.fn().mockResolvedValue(undefined)
    const refetchDetail = vi.fn().mockResolvedValue(undefined)

    mockUseMemoSearch.mockReturnValue({
      data: {
        results: [
          {
            memo: {
              id: "memo_1",
              workspaceId: "ws_1",
              memoType: "message",
              sourceMessageId: "msg_1",
              sourceConversationId: null,
              title: "Launch decision",
              abstract: "Approved launch plan",
              keyPoints: [],
              sourceMessageIds: ["msg_1"],
              participantIds: ["user_1"],
              knowledgeType: "decision",
              tags: [],
              parentMemoId: null,
              status: "active",
              version: 1,
              revisionReason: null,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
              archivedAt: null,
            },
            distance: 0,
            sourceStream: null,
            rootStream: null,
          },
        ],
      },
      isLoading: false,
      isFetching: false,
      refetch: refetchSearch,
    })

    mockUseMemoDetail.mockReturnValue({
      data: {
        memo: {
          memo: {
            id: "memo_1",
            workspaceId: "ws_1",
            memoType: "message",
            sourceMessageId: "msg_1",
            sourceConversationId: null,
            title: "Launch decision",
            abstract: "Approved launch plan",
            keyPoints: [],
            sourceMessageIds: ["msg_1"],
            participantIds: ["user_1"],
            knowledgeType: "decision",
            tags: [],
            parentMemoId: null,
            status: "active",
            version: 1,
            revisionReason: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            archivedAt: null,
          },
          distance: 0,
          sourceStream: null,
          rootStream: null,
          sourceMessages: [],
        },
      },
      isLoading: false,
      isFetching: false,
      refetch: refetchDetail,
    })

    renderPage()

    await userEvent.click(screen.getByRole("button", { name: "Refresh" }))

    expect(refetchSearch).toHaveBeenCalledTimes(1)
    expect(refetchDetail).toHaveBeenCalledTimes(1)
  })
})
