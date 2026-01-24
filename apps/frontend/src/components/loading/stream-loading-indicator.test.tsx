import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act } from "@testing-library/react"
import { StreamLoadingIndicator } from "./stream-loading-indicator"

describe("StreamLoadingIndicator", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should not show indicator immediately when loading starts", () => {
    render(<StreamLoadingIndicator isLoading={true} />)

    expect(screen.queryByTestId("stream-loading-indicator")).not.toBeInTheDocument()
  })

  it("should show indicator after 200ms delay when loading", () => {
    render(<StreamLoadingIndicator isLoading={true} />)

    expect(screen.queryByTestId("stream-loading-indicator")).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(screen.getByTestId("stream-loading-indicator")).toBeInTheDocument()
  })

  it("should not show indicator if loading completes before 200ms", () => {
    const { rerender } = render(<StreamLoadingIndicator isLoading={true} />)

    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(screen.queryByTestId("stream-loading-indicator")).not.toBeInTheDocument()

    rerender(<StreamLoadingIndicator isLoading={false} />)

    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(screen.queryByTestId("stream-loading-indicator")).not.toBeInTheDocument()
  })

  it("should hide indicator when loading completes", () => {
    const { rerender } = render(<StreamLoadingIndicator isLoading={true} />)

    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(screen.getByTestId("stream-loading-indicator")).toBeInTheDocument()

    rerender(<StreamLoadingIndicator isLoading={false} />)

    expect(screen.queryByTestId("stream-loading-indicator")).not.toBeInTheDocument()
  })

  it("should not show indicator when not loading", () => {
    render(<StreamLoadingIndicator isLoading={false} />)

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(screen.queryByTestId("stream-loading-indicator")).not.toBeInTheDocument()
  })

  it("should restart delay timer when loading restarts", () => {
    const { rerender } = render(<StreamLoadingIndicator isLoading={true} />)

    act(() => {
      vi.advanceTimersByTime(150)
    })

    // Stop loading before indicator shows
    rerender(<StreamLoadingIndicator isLoading={false} />)

    // Start loading again
    rerender(<StreamLoadingIndicator isLoading={true} />)

    // 150ms into new loading cycle - should still not show
    act(() => {
      vi.advanceTimersByTime(150)
    })

    expect(screen.queryByTestId("stream-loading-indicator")).not.toBeInTheDocument()

    // Complete the 200ms delay
    act(() => {
      vi.advanceTimersByTime(50)
    })

    expect(screen.getByTestId("stream-loading-indicator")).toBeInTheDocument()
  })
})
