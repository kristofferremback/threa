import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement, type ReactNode } from "react"
import { useCoordinatedStreamQueries } from "./use-coordinated-stream-queries"

const mockBootstrap = vi.fn()

vi.mock("@/contexts", () => ({
  useStreamService: () => ({
    bootstrap: mockBootstrap,
  }),
}))

vi.mock("@/db", () => ({
  db: {
    streams: { put: vi.fn() },
    events: { bulkPut: vi.fn() },
  },
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
  })

  it("should return isLoading=true while queries are pending", () => {
    const queryClient = createTestQueryClient()
    mockBootstrap.mockImplementation(() => new Promise(() => {})) // Never resolves

    const { result } = renderHook(() => useCoordinatedStreamQueries("workspace_1", ["stream_123"]), {
      wrapper: createWrapper(queryClient),
    })

    expect(result.current.isLoading).toBe(true)
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

    expect(result.current.errors).toHaveLength(1)
  })

  it("should return isLoading=false immediately when streamIds is empty", () => {
    const queryClient = createTestQueryClient()

    const { result } = renderHook(() => useCoordinatedStreamQueries("workspace_1", []), {
      wrapper: createWrapper(queryClient),
    })

    expect(result.current.isLoading).toBe(false)
    expect(mockBootstrap).not.toHaveBeenCalled()
  })

  it("should return isLoading=false when all IDs are draft scratchpads", () => {
    const queryClient = createTestQueryClient()

    const { result } = renderHook(() => useCoordinatedStreamQueries("workspace_1", ["draft_1", "draft_2"]), {
      wrapper: createWrapper(queryClient),
    })

    expect(result.current.isLoading).toBe(false)
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
