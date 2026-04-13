import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement, type ReactNode } from "react"
import { bootstrapRetry, bootstrapRetryDelay, useCoordinatedStreamQueries } from "./use-coordinated-stream-queries"
import { QUERY_LOAD_STATE } from "@/lib/query-load-state"
import { ApiError } from "@/api/client"

const { mockBootstrap, mockJoinRoomBestEffort, mockToCachedStreamBootstrap } = vi.hoisted(() => ({
  mockBootstrap: vi.fn(),
  mockJoinRoomBestEffort: vi.fn(),
  mockToCachedStreamBootstrap: vi.fn((bootstrap: unknown) => bootstrap),
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

vi.mock("@/sync/stream-sync", () => ({
  applyStreamBootstrap: vi.fn(),
  toCachedStreamBootstrap: mockToCachedStreamBootstrap,
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
    mockToCachedStreamBootstrap.mockImplementation((bootstrap: unknown) => bootstrap)
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
    // Use a terminal (404) error so no retry runs — this test checks error
    // surfacing, not retry semantics.
    mockBootstrap.mockImplementation(async (_workspaceId: string, streamId: string) => {
      if (streamId === "stream_456") {
        throw new ApiError(404, "STREAM_NOT_FOUND", "Stream not found")
      }
      return { stream: { id: streamId }, events: [], membership: null, syncMode: "replace" }
    })

    const { result } = renderHook(() => useCoordinatedStreamQueries("workspace_1", ["stream_123", "stream_456"]), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(result.current.loadState).toBe(QUERY_LOAD_STATE.READY)
    expect(result.current.errors).toHaveLength(1)
  })

  it("passes incrementWindowVersionOnReplace=true for syncMode=replace", async () => {
    const queryClient = createTestQueryClient()
    const bootstrap = {
      stream: { id: "stream_123" },
      events: [],
      membership: null,
      syncMode: "replace",
    }
    mockBootstrap.mockResolvedValue(bootstrap)

    renderHook(() => useCoordinatedStreamQueries("workspace_1", ["stream_123"]), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => {
      expect(mockToCachedStreamBootstrap).toHaveBeenCalled()
    })

    expect(mockToCachedStreamBootstrap).toHaveBeenCalledWith(bootstrap, undefined, {
      incrementWindowVersionOnReplace: true,
    })
  })

  it("passes incrementWindowVersionOnReplace=false for syncMode=append", async () => {
    const queryClient = createTestQueryClient()
    const bootstrap = {
      stream: { id: "stream_123" },
      events: [],
      membership: null,
      syncMode: "append",
    }
    mockBootstrap.mockResolvedValue(bootstrap)

    renderHook(() => useCoordinatedStreamQueries("workspace_1", ["stream_123"]), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => {
      expect(mockToCachedStreamBootstrap).toHaveBeenCalled()
    })

    expect(mockToCachedStreamBootstrap).toHaveBeenCalledWith(bootstrap, undefined, {
      incrementWindowVersionOnReplace: false,
    })
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

describe("bootstrapRetry", () => {
  it("retries recoverable errors up to MAX_BOOTSTRAP_RETRIES", () => {
    const networkError = new Error("network down")
    expect(bootstrapRetry(0, networkError)).toBe(true)
    expect(bootstrapRetry(1, networkError)).toBe(true)
    expect(bootstrapRetry(2, networkError)).toBe(false)
  })

  it("retries 429 and 5xx API errors", () => {
    expect(bootstrapRetry(0, new ApiError(429, "RATE_LIMITED", "Slow"))).toBe(true)
    expect(bootstrapRetry(0, new ApiError(500, "INTERNAL", "Boom"))).toBe(true)
    expect(bootstrapRetry(0, new ApiError(503, "UNAVAILABLE", "Unavailable"))).toBe(true)
  })

  it("does not retry terminal 403/404 errors", () => {
    expect(bootstrapRetry(0, new ApiError(403, "FORBIDDEN", "Forbidden"))).toBe(false)
    expect(bootstrapRetry(0, new ApiError(404, "NOT_FOUND", "Not found"))).toBe(false)
  })

  it("does not retry non-recoverable 4xx errors", () => {
    expect(bootstrapRetry(0, new ApiError(400, "BAD_REQUEST", "Bad request"))).toBe(false)
    expect(bootstrapRetry(0, new ApiError(401, "UNAUTHORIZED", "Unauthorized"))).toBe(false)
  })
})

describe("bootstrapRetryDelay", () => {
  it("uses exponential backoff capped at the max delay", () => {
    expect(bootstrapRetryDelay(0)).toBe(500)
    expect(bootstrapRetryDelay(1)).toBe(1000)
    expect(bootstrapRetryDelay(2)).toBe(2000)
    expect(bootstrapRetryDelay(10)).toBe(4000)
  })
})
