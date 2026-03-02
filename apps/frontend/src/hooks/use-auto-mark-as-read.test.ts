import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useAutoMarkAsRead } from "./use-auto-mark-as-read"
import { SW_MSG_CLEAR_NOTIFICATIONS } from "../lib/sw-messages"

const mockMarkAsRead = vi.fn()
const mockGetUnreadCount = vi.fn()
const mockGetActivityCount = vi.fn()
const mockPostMessage = vi.fn()

vi.mock("./use-unread-counts", () => ({
  useUnreadCounts: () => ({
    markAsRead: mockMarkAsRead,
    getUnreadCount: mockGetUnreadCount,
  }),
}))

vi.mock("./use-activity-counts", () => ({
  useActivityCounts: () => ({
    getActivityCount: mockGetActivityCount,
  }),
}))

let unreadCount = 1
let activityCount = 0
let hasFocus = true
let visibilityState: DocumentVisibilityState = "visible"

const originalVisibilityState = Object.getOwnPropertyDescriptor(document, "visibilityState")
const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker")

function restoreProperty(target: object, key: PropertyKey, descriptor?: PropertyDescriptor) {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor)
    return
  }
  Reflect.deleteProperty(target, key)
}

describe("useAutoMarkAsRead", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    unreadCount = 1
    activityCount = 0
    hasFocus = true
    visibilityState = "visible"

    mockGetUnreadCount.mockImplementation(() => unreadCount)
    mockGetActivityCount.mockImplementation(() => activityCount)

    vi.spyOn(document, "hasFocus").mockImplementation(() => hasFocus)

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilityState,
    })

    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        controller: {
          postMessage: mockPostMessage,
        },
      },
    })
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()

    restoreProperty(document, "visibilityState", originalVisibilityState)
    restoreProperty(navigator, "serviceWorker", originalServiceWorker)
  })

  it("marks the stream as read when the page is visible and focused", () => {
    renderHook(() => useAutoMarkAsRead("ws_123", "stream_123", "event_123"))

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(mockMarkAsRead).toHaveBeenCalledWith("stream_123", "event_123")
    expect(mockPostMessage).toHaveBeenCalledWith({
      type: SW_MSG_CLEAR_NOTIFICATIONS,
      streamId: "stream_123",
    })
  })

  it("does not mark the stream as read while the tab is hidden and unfocused", () => {
    visibilityState = "hidden"
    hasFocus = false

    renderHook(() => useAutoMarkAsRead("ws_123", "stream_123", "event_123"))

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(mockMarkAsRead).not.toHaveBeenCalled()
    expect(mockPostMessage).not.toHaveBeenCalled()
  })

  it("does not mark the stream as read while the tab is visible but the window is unfocused", () => {
    hasFocus = false

    renderHook(() => useAutoMarkAsRead("ws_123", "stream_123", "event_123"))

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(mockMarkAsRead).not.toHaveBeenCalled()
    expect(mockPostMessage).not.toHaveBeenCalled()
  })

  it("waits until the tab is visible and focused again before sending the read event", () => {
    renderHook(() => useAutoMarkAsRead("ws_123", "stream_123", "event_123"))

    act(() => {
      vi.advanceTimersByTime(250)
      visibilityState = "hidden"
      hasFocus = false
      document.dispatchEvent(new Event("visibilitychange"))
      window.dispatchEvent(new Event("blur"))
    })

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(mockMarkAsRead).not.toHaveBeenCalled()

    act(() => {
      visibilityState = "visible"
      document.dispatchEvent(new Event("visibilitychange"))
    })

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(mockMarkAsRead).not.toHaveBeenCalled()

    act(() => {
      hasFocus = true
      window.dispatchEvent(new Event("focus"))
    })

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(mockMarkAsRead).toHaveBeenCalledWith("stream_123", "event_123")
    expect(mockPostMessage).toHaveBeenCalledWith({
      type: SW_MSG_CLEAR_NOTIFICATIONS,
      streamId: "stream_123",
    })
  })
})
