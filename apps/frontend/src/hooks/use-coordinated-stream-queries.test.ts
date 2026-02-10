import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement, type ReactNode } from "react"
import { useCoordinatedStreamQueries } from "./use-coordinated-stream-queries"
import { QUERY_LOAD_STATE } from "@/lib/query-load-state"

const { mockBootstrap, mockJoinRoomBestEffort } = vi.hoisted(() => ({
  mockBootstrap: vi.fn(),
  mockJoinRoomBestEffort: vi.fn(),
}))

vi.mock("@/contexts", () => ({
  useStreamService: () => ({
    bootstrap: mockBootstrap,
  }),
  useSocket: () => ({ connected: true }),
}))

vi.mock("@/db", () => ({
  db: {
    streams: { put: vi.fn() },
    events: { bulkPut: vi.fn() },
  },
}))

vi.mock("@/lib/socket-room", () => ({
  joinRoomBestEffort: mockJoinRoomBestEffort,
}))

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

describe("useCoordinatedStreamQueries", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockJoinRoomBestEffort.mockResolvedValue(undefined)
  })

  it("should filter out draft IDs and not fetch them", async () => {
    const queryClient = createTestQueryClient()
    mockBootstrap.mockResolvedValue({
      stream: { id: "stream_123" },
      events: [],
      membership: null,
    })

    const streamIds = ["draft_abc", "stream_123", "draft_xyz", "stream_456"]

    renderHook(() => useCoordinatedStreamQueries("workspace_1", streamIds), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => {
      expect(mockBootstrap).toHaveBeenCalledTimes(2)
    })

    expect(mockBootstrap).toHaveBeenCalledWith("workspace_1", "stream_123")
    expect(mockBootstrap).toHaveBeenCalledWith("workspace_1", "stream_456")
    expect(mockBootstrap).not.toHaveBeenCalledWith("workspace_1", "draft_abc")
    expect(mockBootstrap).not.toHaveBeenCalledWith("workspace_1", "draft_xyz")
    expect(mockJoinRoomBestEffort).toHaveBeenCalledWith(
      expect.any(Object),
      "ws:workspace_1:stream:stream_123",
      "CoordinatedStreamBootstrap"
    )
    expect(mockJoinRoomBestEffort).toHaveBeenCalledWith(
      expect.any(Object),
      "ws:workspace_1:stream:stream_456",
      "CoordinatedStreamBootstrap"
    )
  })

  it("should return isLoading=true while queries are pending", () => {
    const queryClient = createTestQueryClient()
    mockBootstrap.mockImplementation(() => new Promise(() => {})) // Never resolves

    const { result } = renderHook(() => useCoordinatedStreamQueries("workspace_1", ["stream_123"]), {
      wrapper: createWrapper(queryClient),
    })

    expect(result.current.isLoading).toBe(true)
    expect(result.current.loadState).toBe(QUERY_LOAD_STATE.FETCHING)
    expect(result.current.isError).toBe(false)
  })

  it("should return isLoading=false when all queries complete", async () => {
    const queryClient = createTestQueryClient()
    mockBootstrap.mockResolvedValue({
      stream: { id: "stream_123" },
      events: [],
      membership: null,
    })

    const { result } = renderHook(() => useCoordinatedStreamQueries("workspace_1", ["stream_123", "stream_456"]), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.loadState).toBe(QUERY_LOAD_STATE.READY)
    expect(result.current.isError).toBe(false)
  })

  it("should return isError=true when any query fails", async () => {
    const queryClient = createTestQueryClient()
    mockBootstrap
      .mockResolvedValueOnce({ stream: { id: "stream_123" }, events: [], membership: null })
      .mockRejectedValueOnce(new Error("Failed to load"))

    const { result } = renderHook(() => useCoordinatedStreamQueries("workspace_1", ["stream_123", "stream_456"]), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(result.current.loadState).toBe(QUERY_LOAD_STATE.READY)
    expect(result.current.errors).toHaveLength(1)
  })

  it("should return isLoading=false immediately when streamIds is empty", () => {
    const queryClient = createTestQueryClient()

    const { result } = renderHook(() => useCoordinatedStreamQueries("workspace_1", []), {
      wrapper: createWrapper(queryClient),
    })

    expect(result.current.isLoading).toBe(false)
    expect(result.current.loadState).toBe(QUERY_LOAD_STATE.READY)
    expect(mockBootstrap).not.toHaveBeenCalled()
  })

  it("should return isLoading=false when all IDs are draft scratchpads", () => {
    const queryClient = createTestQueryClient()

    const { result } = renderHook(() => useCoordinatedStreamQueries("workspace_1", ["draft_1", "draft_2"]), {
      wrapper: createWrapper(queryClient),
    })

    expect(result.current.isLoading).toBe(false)
    expect(result.current.loadState).toBe(QUERY_LOAD_STATE.READY)
    expect(mockBootstrap).not.toHaveBeenCalled()
  })

  it("should filter out draft thread panel IDs (draft:parentStreamId:parentMessageId format)", async () => {
    const queryClient = createTestQueryClient()
    mockBootstrap.mockResolvedValue({
      stream: { id: "stream_123" },
      events: [],
      membership: null,
    })

    const streamIds = ["stream_123", "draft:stream_456:msg_789", "stream_abc"]

    renderHook(() => useCoordinatedStreamQueries("workspace_1", streamIds), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => {
      expect(mockBootstrap).toHaveBeenCalledTimes(2)
    })

    expect(mockBootstrap).toHaveBeenCalledWith("workspace_1", "stream_123")
    expect(mockBootstrap).toHaveBeenCalledWith("workspace_1", "stream_abc")
    expect(mockBootstrap).not.toHaveBeenCalledWith("workspace_1", "draft:stream_456:msg_789")
  })
})
