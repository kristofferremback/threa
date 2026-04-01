import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act } from "@testing-library/react"
import {
  CoordinatedLoadingProvider,
  CoordinatedLoadingGate,
  MainContentGate,
  useCoordinatedLoading,
} from "./coordinated-loading-context"
import { QUERY_LOAD_STATE, isQueryLoadStateLoading, type QueryLoadState } from "@/lib/query-load-state"
import { ApiError } from "@/api/client"

type MockQueryResult = {
  status: "pending" | "success" | "error"
  fetchStatus: "idle" | "fetching" | "paused"
  isLoading: boolean
  isError: boolean
  error: Error | null
  data?: { stream?: { id: string } }
}

let mockWorkspaceLoadState: QueryLoadState = QUERY_LOAD_STATE.PENDING
let mockStreamsLoadState: QueryLoadState = QUERY_LOAD_STATE.PENDING
let mockStreamResults: MockQueryResult[] = []
let mockSeedCacheFromIdbResult = false
let mockHasSeededWorkspaceCache = false
let mockWorkspace: { id: string } | undefined
let mockUsers: Array<{ id: string; avatarUrl: string | null }> = []
let mockStreams: Array<{ id: string; lastMessagePreview?: { createdAt: string } | null }> = []
let mockMemberships: Array<{ streamId: string }> = []
let mockDmPeers: Array<{ streamId: string; userId: string }> = []
let mockPersonas: Array<{ id: string }> = []
let mockBots: Array<{ id: string }> = []
let mockUnreadState: { id: string } | undefined
let mockMetadata: { id: string } | undefined
let mockHasSeededDraftCache = false

vi.mock("@/sync/sync-status", () => ({
  useSyncStatus: () => {
    if (mockWorkspaceLoadState === QUERY_LOAD_STATE.PENDING || mockWorkspaceLoadState === QUERY_LOAD_STATE.FETCHING)
      return "syncing"
    if (mockWorkspaceLoadState === QUERY_LOAD_STATE.ERROR) return "error"
    return "synced"
  },
}))

vi.mock("@/hooks/use-coordinated-stream-queries", () => ({
  useCoordinatedStreamQueries: () => ({
    loadState: mockStreamsLoadState,
    isLoading: isQueryLoadStateLoading(mockStreamsLoadState),
    isError: false,
    errors: [],
    results: mockStreamResults,
  }),
}))

vi.mock("@/hooks/use-preload-images", () => ({
  usePreloadImages: () => true,
}))

vi.mock("@/stores/workspace-store", () => ({
  seedCacheFromIdb: vi.fn(async () => mockSeedCacheFromIdbResult),
  hasSeededWorkspaceCache: vi.fn(() => mockHasSeededWorkspaceCache),
  useWorkspaceFromStore: vi.fn(() => mockWorkspace),
  useWorkspaceUsers: vi.fn(() => mockUsers),
  useWorkspaceStreams: vi.fn(() => mockStreams),
  useWorkspaceStreamMemberships: vi.fn(() => mockMemberships),
  useWorkspaceDmPeers: vi.fn(() => mockDmPeers),
  useWorkspacePersonas: vi.fn(() => mockPersonas),
  useWorkspaceBots: vi.fn(() => mockBots),
  useWorkspaceUnreadState: vi.fn(() => mockUnreadState),
  useWorkspaceMetadata: vi.fn(() => mockMetadata),
}))

vi.mock("@/stores/stream-store", () => ({}))

vi.mock("@/stores/draft-store", () => ({
  seedDraftCacheFromIdb: vi.fn(async () => undefined),
  hasSeededDraftCache: vi.fn(() => mockHasSeededDraftCache),
}))

vi.mock("@/components/loading", () => ({
  StreamContentSkeleton: () => <div data-testid="stream-content-skeleton">Stream Content Skeleton</div>,
}))

function TestConsumer() {
  const { phase, getStreamState, hasErrors } = useCoordinatedLoading()
  return (
    <div>
      <span data-testid="phase">{phase}</span>
      <span data-testid="stream-state">{getStreamState("stream_1")}</span>
      <span data-testid="has-errors">{String(hasErrors)}</span>
    </div>
  )
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve()
  })
}

function makeReadyWorkspaceState() {
  mockWorkspaceLoadState = QUERY_LOAD_STATE.READY
  mockStreamsLoadState = QUERY_LOAD_STATE.READY
  mockSeedCacheFromIdbResult = true
  mockHasSeededWorkspaceCache = true
  mockHasSeededDraftCache = true
  mockWorkspace = { id: "workspace_1" }
  mockUsers = [{ id: "user_1", avatarUrl: null }]
  mockStreams = [{ id: "stream_1" }]
  mockUnreadState = { id: "workspace_1" }
  mockMetadata = { id: "workspace_1" }
}

describe("CoordinatedLoadingProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockWorkspaceLoadState = QUERY_LOAD_STATE.PENDING
    mockStreamsLoadState = QUERY_LOAD_STATE.PENDING
    mockStreamResults = []
    mockSeedCacheFromIdbResult = false
    mockHasSeededWorkspaceCache = false
    mockWorkspace = undefined
    mockUsers = []
    mockStreams = []
    mockMemberships = []
    mockDmPeers = []
    mockPersonas = []
    mockBots = []
    mockUnreadState = undefined
    mockMetadata = undefined
    mockHasSeededDraftCache = false
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it("reports loading initially while initial data is unresolved", async () => {
    render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <TestConsumer />
      </CoordinatedLoadingProvider>
    )

    await flushEffects()

    expect(screen.getByTestId("phase").textContent).toBe("loading")
  })

  it("transitions to skeleton after 300ms if still loading", async () => {
    render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <TestConsumer />
      </CoordinatedLoadingProvider>
    )

    await flushEffects()
    expect(screen.getByTestId("phase").textContent).toBe("loading")

    act(() => {
      vi.advanceTimersByTime(299)
    })
    expect(screen.getByTestId("phase").textContent).toBe("loading")

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByTestId("phase").textContent).toBe("skeleton")
  })

  it("is ready when IDB is primed and stream record exists (no per-stream cache needed)", async () => {
    mockSeedCacheFromIdbResult = true
    mockHasSeededWorkspaceCache = true
    mockHasSeededDraftCache = true
    mockWorkspace = { id: "workspace_1" }
    mockUsers = [{ id: "user_1", avatarUrl: null }]
    mockStreams = [{ id: "stream_1" }]
    mockUnreadState = { id: "workspace_1" }
    mockMetadata = { id: "workspace_1" }

    render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <TestConsumer />
      </CoordinatedLoadingProvider>
    )

    await flushEffects()

    // IDB primed + stream record exists = ready (useLiveQuery serves events from IDB)
    expect(screen.getByTestId("phase").textContent).toBe("ready")
  })

  it("waits for workspace metadata before becoming ready", async () => {
    makeReadyWorkspaceState()
    mockMetadata = undefined
    mockSeedCacheFromIdbResult = true

    const { rerender } = render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <TestConsumer />
      </CoordinatedLoadingProvider>
    )

    await flushEffects()

    expect(screen.getByTestId("phase").textContent).toBe("loading")

    mockMetadata = { id: "workspace_1" }
    rerender(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <TestConsumer />
      </CoordinatedLoadingProvider>
    )

    await flushEffects()

    expect(screen.getByTestId("phase").textContent).toBe("ready")
  })

  it("waits for local draft cache before becoming ready", async () => {
    makeReadyWorkspaceState()
    mockHasSeededDraftCache = false
    mockSeedCacheFromIdbResult = true

    const { rerender } = render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <TestConsumer />
      </CoordinatedLoadingProvider>
    )

    await flushEffects()

    expect(screen.getByTestId("phase").textContent).toBe("loading")

    mockHasSeededDraftCache = true
    rerender(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <TestConsumer />
      </CoordinatedLoadingProvider>
    )

    await flushEffects()

    expect(screen.getByTestId("phase").textContent).toBe("ready")
  })

  it("is ready immediately when the cache already has the full visible read model", async () => {
    makeReadyWorkspaceState()
    mockSeedCacheFromIdbResult = true

    render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <TestConsumer />
      </CoordinatedLoadingProvider>
    )

    await flushEffects()

    expect(screen.getByTestId("phase").textContent).toBe("ready")
  })

  it("trusts IDB when primed — does not wait for bootstrap even with stale preview", async () => {
    makeReadyWorkspaceState()
    mockSeedCacheFromIdbResult = true
    mockStreams = [
      {
        id: "stream_1",
        lastMessagePreview: { createdAt: "2026-03-01T10:01:00Z" },
      },
    ]

    render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <TestConsumer />
      </CoordinatedLoadingProvider>
    )

    await flushEffects()

    // IDB is the source of truth — useLiveQuery serves events directly.
    // No need to wait for bootstrap to confirm preview alignment.
    expect(screen.getByTestId("phase").textContent).toBe("ready")
  })

  it("reports stream state as idle during the initial coordinated load", async () => {
    mockStreamResults = [{ status: "pending", fetchStatus: "fetching", isLoading: true, isError: false, error: null }]

    render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <TestConsumer />
      </CoordinatedLoadingProvider>
    )

    await flushEffects()

    expect(screen.getByTestId("stream-state").textContent).toBe("idle")
  })

  it("reports stream state as loading after the initial load has completed", async () => {
    makeReadyWorkspaceState()
    mockStreamResults = [{ status: "pending", fetchStatus: "fetching", isLoading: true, isError: false, error: null }]

    const { rerender } = render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <TestConsumer />
      </CoordinatedLoadingProvider>
    )

    await flushEffects()

    mockStreamsLoadState = QUERY_LOAD_STATE.FETCHING
    rerender(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <TestConsumer />
      </CoordinatedLoadingProvider>
    )

    await flushEffects()

    expect(screen.getByTestId("phase").textContent).toBe("ready")
    expect(screen.getByTestId("stream-state").textContent).toBe("loading")
  })

  it("suppresses recoverable stream bootstrap errors when the cached stream is usable", async () => {
    makeReadyWorkspaceState()
    mockStreamResults = [
      {
        status: "error",
        fetchStatus: "idle",
        isLoading: false,
        isError: true,
        error: new ApiError(429, "RATE_LIMITED", "Too many requests"),
      },
    ]
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <TestConsumer />
      </CoordinatedLoadingProvider>
    )

    await flushEffects()

    expect(screen.getByTestId("phase").textContent).toBe("ready")
    expect(screen.getByTestId("stream-state").textContent).toBe("idle")
    expect(screen.getByTestId("has-errors").textContent).toBe("false")
    warnSpy.mockRestore()
  })
})

describe("CoordinatedLoadingGate", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockWorkspaceLoadState = QUERY_LOAD_STATE.PENDING
    mockStreamsLoadState = QUERY_LOAD_STATE.PENDING
    mockStreamResults = []
    mockSeedCacheFromIdbResult = false
    mockHasSeededWorkspaceCache = false
    mockWorkspace = undefined
    mockUsers = []
    mockStreams = []
    mockUnreadState = undefined
    mockMetadata = undefined
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it("shows nothing during the blank loading phase", async () => {
    render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <CoordinatedLoadingGate>
          <div data-testid="content">Actual Content</div>
        </CoordinatedLoadingGate>
      </CoordinatedLoadingProvider>
    )

    await flushEffects()

    expect(screen.queryByTestId("content")).not.toBeInTheDocument()
  })

  it("renders children during the skeleton phase", async () => {
    render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <CoordinatedLoadingGate>
          <div data-testid="content">Actual Content</div>
        </CoordinatedLoadingGate>
      </CoordinatedLoadingProvider>
    )

    await flushEffects()
    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(screen.getByTestId("content")).toBeInTheDocument()
  })

  it("renders children immediately in the ready phase", async () => {
    makeReadyWorkspaceState()

    render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <CoordinatedLoadingGate>
          <div data-testid="content">Actual Content</div>
        </CoordinatedLoadingGate>
      </CoordinatedLoadingProvider>
    )

    await flushEffects()

    expect(screen.getByTestId("content")).toBeInTheDocument()
  })
})

describe("MainContentGate", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockWorkspaceLoadState = QUERY_LOAD_STATE.PENDING
    mockStreamsLoadState = QUERY_LOAD_STATE.PENDING
    mockStreamResults = []
    mockSeedCacheFromIdbResult = false
    mockHasSeededWorkspaceCache = false
    mockWorkspace = undefined
    mockUsers = []
    mockStreams = []
    mockUnreadState = undefined
    mockMetadata = undefined
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it("shows the stream content skeleton during initial load", async () => {
    render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <MainContentGate>
          <div data-testid="content">Actual Content</div>
        </MainContentGate>
      </CoordinatedLoadingProvider>
    )

    await flushEffects()

    expect(screen.getByTestId("stream-content-skeleton")).toBeInTheDocument()
    expect(screen.queryByTestId("content")).not.toBeInTheDocument()
  })

  it("shows children once the coordinated load is ready", async () => {
    makeReadyWorkspaceState()

    render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <MainContentGate>
          <div data-testid="content">Actual Content</div>
        </MainContentGate>
      </CoordinatedLoadingProvider>
    )

    await flushEffects()

    expect(screen.queryByTestId("stream-content-skeleton")).not.toBeInTheDocument()
    expect(screen.getByTestId("content")).toBeInTheDocument()
  })
})
