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
    results: [],
  }),
}))

vi.mock("@/components/loading", () => ({
  SidebarSkeleton: () => <div data-testid="sidebar-skeleton">Sidebar Skeleton</div>,
  StreamContentSkeleton: () => <div data-testid="stream-content-skeleton">Stream Content Skeleton</div>,
}))

function TestConsumer() {
  const { isLoading, showSkeleton } = useCoordinatedLoading()
  return (
    <div>
      <span data-testid="is-loading">{String(isLoading)}</span>
      <span data-testid="show-skeleton">{String(showSkeleton)}</span>
    </div>
  )
}

describe("CoordinatedLoadingProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockWorkspaceLoading = true
    mockStreamsLoading = true
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it("should report isLoading=true while loading", () => {
    render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <TestConsumer />
      </CoordinatedLoadingProvider>
    )

    expect(screen.getByTestId("is-loading").textContent).toBe("true")
  })

  it("should not show skeleton initially while loading", () => {
    render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <TestConsumer />
      </CoordinatedLoadingProvider>
    )

    expect(screen.getByTestId("show-skeleton").textContent).toBe("false")
  })

  it("should show skeleton after 1s if still loading", () => {
    render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <TestConsumer />
      </CoordinatedLoadingProvider>
    )

    expect(screen.getByTestId("show-skeleton").textContent).toBe("false")

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(screen.getByTestId("show-skeleton").textContent).toBe("true")
    expect(screen.getByTestId("is-loading").textContent).toBe("true")
  })

  it("should not show skeleton when loading completes before 1s", () => {
    const { rerender } = render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <TestConsumer />
      </CoordinatedLoadingProvider>
    )

    // Advance 500ms (not yet at 1s threshold)
    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(screen.getByTestId("show-skeleton").textContent).toBe("false")

    // Simulate loading complete
    mockWorkspaceLoading = false
    mockStreamsLoading = false

    rerender(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <TestConsumer />
      </CoordinatedLoadingProvider>
    )

    expect(screen.getByTestId("is-loading").textContent).toBe("false")
    expect(screen.getByTestId("show-skeleton").textContent).toBe("false")
  })

  it("should hide skeleton when loading completes after 1s", () => {
    const { rerender } = render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <TestConsumer />
      </CoordinatedLoadingProvider>
    )

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(screen.getByTestId("show-skeleton").textContent).toBe("true")

    // Simulate loading complete
    mockWorkspaceLoading = false
    mockStreamsLoading = false

    rerender(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <TestConsumer />
      </CoordinatedLoadingProvider>
    )

    expect(screen.getByTestId("is-loading").textContent).toBe("false")
    expect(screen.getByTestId("show-skeleton").textContent).toBe("false")
  })

  it("should be ready immediately when no data to load", () => {
    mockWorkspaceLoading = false
    mockStreamsLoading = false

    render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={[]}>
        <TestConsumer />
      </CoordinatedLoadingProvider>
    )

    expect(screen.getByTestId("is-loading").textContent).toBe("false")
    expect(screen.getByTestId("show-skeleton").textContent).toBe("false")
  })
})

describe("CoordinatedLoadingGate", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockWorkspaceLoading = true
    mockStreamsLoading = true
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it("should show nothing initially while loading (before 1s)", () => {
    render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <CoordinatedLoadingGate>
          <div data-testid="content">Actual Content</div>
        </CoordinatedLoadingGate>
      </CoordinatedLoadingProvider>
    )

    expect(screen.queryByTestId("content")).not.toBeInTheDocument()
  })

  it("should render children after 1s if still loading (children handle skeleton)", () => {
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

    // Gate now renders children - children are responsible for showing skeleton
    expect(screen.getByTestId("content")).toBeInTheDocument()
  })

  it("should show children when ready", () => {
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
    expect(screen.getByText("Actual Content")).toBeInTheDocument()
  })

  it("should switch from nothing to content when loading completes before 1s", () => {
    const { rerender } = render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <CoordinatedLoadingGate>
          <div data-testid="content">Actual Content</div>
        </CoordinatedLoadingGate>
      </CoordinatedLoadingProvider>
    )

    // Nothing shown initially
    expect(screen.queryByTestId("content")).not.toBeInTheDocument()

    // Simulate loading complete before 1s
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

  it("should switch from children-with-skeleton to children-with-content when loading completes after 1s", () => {
    const { rerender } = render(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <CoordinatedLoadingGate>
          <div data-testid="content">Actual Content</div>
        </CoordinatedLoadingGate>
      </CoordinatedLoadingProvider>
    )

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    // Children rendered (they would show skeleton based on context)
    expect(screen.getByTestId("content")).toBeInTheDocument()

    // Simulate loading complete
    mockWorkspaceLoading = false
    mockStreamsLoading = false

    rerender(
      <CoordinatedLoadingProvider workspaceId="workspace_1" streamIds={["stream_1"]}>
        <CoordinatedLoadingGate>
          <div data-testid="content">Actual Content</div>
        </CoordinatedLoadingGate>
      </CoordinatedLoadingProvider>
    )

    // Children still rendered (now showing real content)
    expect(screen.getByTestId("content")).toBeInTheDocument()
  })
})

describe("MainContentGate", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockWorkspaceLoading = true
    mockStreamsLoading = true
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it("should show stream content skeleton while loading", () => {
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

  it("should show children when ready", () => {
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

    // Simulate loading complete
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
