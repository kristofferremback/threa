import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act } from "@testing-library/react"
import {
  CoordinatedLoadingProvider,
  CoordinatedLoadingGate,
  MainContentGate,
  useCoordinatedLoading,
} from "./coordinated-loading-context"

let mockWorkspaceLoading = true
let mockStreamsLoading = true
let mockStreamResults: Array<{ isLoading: boolean; isError: boolean; error: Error | null }> = []

vi.mock("@/hooks/use-workspaces", () => ({
  useWorkspaceBootstrap: () => ({
    isLoading: mockWorkspaceLoading,
    data: null,
    error: null,
  }),
}))

vi.mock("@/hooks/use-coordinated-stream-queries", () => ({
  useCoordinatedStreamQueries: () => ({
    isLoading: mockStreamsLoading,
    isError: false,
    errors: [],
    results: mockStreamResults,
  }),
}))

vi.mock("@/components/loading", () => ({
  StreamContentSkeleton: () => <div data-testid="stream-content-skeleton">Stream Content Skeleton</div>,
}))

function TestConsumer() {
  const { phase, getStreamState } = useCoordinatedLoading()
  return (
    <div>
      <span data-testid="phase">{phase}</span>
      <span data-testid="stream-state">{getStreamState("stream_1")}</span>
    </div>
  )
}

describe("CoordinatedLoadingProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockWorkspaceLoading = true
    mockStreamsLoading = true
    mockStreamResults = []
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it("should report phase='loading' initially while loading", () => {
    render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <TestConsumer />
      </CoordinatedLoadingProvider>
    )

    expect(screen.getByTestId("phase").textContent).toBe("loading")
  })

  it("should transition to phase='skeleton' after 1s if still loading", () => {
    render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <TestConsumer />
      </CoordinatedLoadingProvider>
    )

    expect(screen.getByTestId("phase").textContent).toBe("loading")

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(screen.getByTestId("phase").textContent).toBe("skeleton")
  })

  it("should transition directly to phase='ready' when loading completes before 1s", () => {
    const { rerender } = render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <TestConsumer />
      </CoordinatedLoadingProvider>
    )

    expect(screen.getByTestId("phase").textContent).toBe("loading")

    act(() => {
      vi.advanceTimersByTime(500)
    })

    // Simulate loading complete
    mockWorkspaceLoading = false
    mockStreamsLoading = false

    rerender(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <TestConsumer />
      </CoordinatedLoadingProvider>
    )

    expect(screen.getByTestId("phase").textContent).toBe("ready")
  })

  it("should transition to phase='ready' when loading completes after 1s", () => {
    const { rerender } = render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <TestConsumer />
      </CoordinatedLoadingProvider>
    )

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(screen.getByTestId("phase").textContent).toBe("skeleton")

    // Simulate loading complete
    mockWorkspaceLoading = false
    mockStreamsLoading = false

    rerender(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <TestConsumer />
      </CoordinatedLoadingProvider>
    )

    expect(screen.getByTestId("phase").textContent).toBe("ready")
  })

  it("should be phase='ready' immediately when no data to load", () => {
    mockWorkspaceLoading = false
    mockStreamsLoading = false

    render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={[]}>
        <TestConsumer />
      </CoordinatedLoadingProvider>
    )

    expect(screen.getByTestId("phase").textContent).toBe("ready")
  })

  it("should report stream state as 'idle' during initial load", () => {
    mockStreamResults = [{ isLoading: true, isError: false, error: null }]

    render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <TestConsumer />
      </CoordinatedLoadingProvider>
    )

    expect(screen.getByTestId("stream-state").textContent).toBe("idle")
  })

  it("should report stream state as 'loading' after initial load completes", () => {
    mockWorkspaceLoading = false
    mockStreamsLoading = false
    mockStreamResults = [{ isLoading: true, isError: false, error: null }]

    const { rerender } = render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <TestConsumer />
      </CoordinatedLoadingProvider>
    )

    // Now simulate stream starts loading again after initial load
    mockStreamsLoading = true

    rerender(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <TestConsumer />
      </CoordinatedLoadingProvider>
    )

    // After initial load, stream reports its actual loading state
    expect(screen.getByTestId("phase").textContent).toBe("ready")
    expect(screen.getByTestId("stream-state").textContent).toBe("loading")
  })
})

describe("CoordinatedLoadingGate", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockWorkspaceLoading = true
    mockStreamsLoading = true
    mockStreamResults = []
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it("should show nothing during 'loading' phase", () => {
    render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <CoordinatedLoadingGate>
          <div data-testid="content">Actual Content</div>
        </CoordinatedLoadingGate>
      </CoordinatedLoadingProvider>
    )

    expect(screen.queryByTestId("content")).not.toBeInTheDocument()
  })

  it("should render children during 'skeleton' phase", () => {
    render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <CoordinatedLoadingGate>
          <div data-testid="content">Actual Content</div>
        </CoordinatedLoadingGate>
      </CoordinatedLoadingProvider>
    )

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(screen.getByTestId("content")).toBeInTheDocument()
  })

  it("should render children during 'ready' phase", () => {
    mockWorkspaceLoading = false
    mockStreamsLoading = false

    render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={[]}>
        <CoordinatedLoadingGate>
          <div data-testid="content">Actual Content</div>
        </CoordinatedLoadingGate>
      </CoordinatedLoadingProvider>
    )

    expect(screen.getByTestId("content")).toBeInTheDocument()
  })

  it("should switch from nothing to content when loading completes before 1s", () => {
    const { rerender } = render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <CoordinatedLoadingGate>
          <div data-testid="content">Actual Content</div>
        </CoordinatedLoadingGate>
      </CoordinatedLoadingProvider>
    )

    expect(screen.queryByTestId("content")).not.toBeInTheDocument()

    mockWorkspaceLoading = false
    mockStreamsLoading = false

    rerender(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <CoordinatedLoadingGate>
          <div data-testid="content">Actual Content</div>
        </CoordinatedLoadingGate>
      </CoordinatedLoadingProvider>
    )

    expect(screen.getByTestId("content")).toBeInTheDocument()
  })
})

describe("MainContentGate", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockWorkspaceLoading = true
    mockStreamsLoading = true
    mockStreamResults = []
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it("should show stream content skeleton during 'loading' phase", () => {
    render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <MainContentGate>
          <div data-testid="content">Actual Content</div>
        </MainContentGate>
      </CoordinatedLoadingProvider>
    )

    expect(screen.getByTestId("stream-content-skeleton")).toBeInTheDocument()
    expect(screen.queryByTestId("content")).not.toBeInTheDocument()
  })

  it("should show stream content skeleton during 'skeleton' phase", () => {
    render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <MainContentGate>
          <div data-testid="content">Actual Content</div>
        </MainContentGate>
      </CoordinatedLoadingProvider>
    )

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(screen.getByTestId("stream-content-skeleton")).toBeInTheDocument()
    expect(screen.queryByTestId("content")).not.toBeInTheDocument()
  })

  it("should show children during 'ready' phase", () => {
    mockWorkspaceLoading = false
    mockStreamsLoading = false

    render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={[]}>
        <MainContentGate>
          <div data-testid="content">Actual Content</div>
        </MainContentGate>
      </CoordinatedLoadingProvider>
    )

    expect(screen.queryByTestId("stream-content-skeleton")).not.toBeInTheDocument()
    expect(screen.getByTestId("content")).toBeInTheDocument()
  })

  it("should switch from skeleton to content when loading completes", () => {
    const { rerender } = render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <MainContentGate>
          <div data-testid="content">Actual Content</div>
        </MainContentGate>
      </CoordinatedLoadingProvider>
    )

    expect(screen.getByTestId("stream-content-skeleton")).toBeInTheDocument()
    expect(screen.queryByTestId("content")).not.toBeInTheDocument()

    mockWorkspaceLoading = false
    mockStreamsLoading = false

    rerender(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <MainContentGate>
          <div data-testid="content">Actual Content</div>
        </MainContentGate>
      </CoordinatedLoadingProvider>
    )

    expect(screen.queryByTestId("stream-content-skeleton")).not.toBeInTheDocument()
    expect(screen.getByTestId("content")).toBeInTheDocument()
  })
})
