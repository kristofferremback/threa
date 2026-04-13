import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useVisualViewport } from "./use-visual-viewport"

/**
 * Minimal EventTarget-based stand-in for VisualViewport. jsdom does not implement
 * the API, so tests drive it by dispatching synthetic resize events on this stub.
 */
class FakeVisualViewport extends EventTarget {
  height: number
  width: number
  offsetTop: number
  offsetLeft: number
  pageLeft: number
  pageTop: number
  scale: number
  constructor(height: number) {
    super()
    this.height = height
    this.width = 360
    this.offsetTop = 0
    this.offsetLeft = 0
    this.pageLeft = 0
    this.pageTop = 0
    this.scale = 1
  }
  emitResize() {
    this.dispatchEvent(new Event("resize"))
  }
}

const INNER_HEIGHT_DEFAULT = 800
const originalVisualViewport = Object.getOwnPropertyDescriptor(window, "visualViewport")
const originalInnerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight")

let fakeVV: FakeVisualViewport
let innerHeight: number

function setInnerHeight(h: number) {
  innerHeight = h
}

describe("useVisualViewport", () => {
  beforeEach(() => {
    innerHeight = INNER_HEIGHT_DEFAULT
    fakeVV = new FakeVisualViewport(INNER_HEIGHT_DEFAULT)

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      get: () => innerHeight,
    })
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      get: () => fakeVV,
    })

    document.documentElement.style.removeProperty("--viewport-height")
  })

  afterEach(() => {
    if (originalVisualViewport) {
      Object.defineProperty(window, "visualViewport", originalVisualViewport)
    } else {
      Reflect.deleteProperty(window, "visualViewport")
    }
    if (originalInnerHeight) {
      Object.defineProperty(window, "innerHeight", originalInnerHeight)
    }
    document.documentElement.style.removeProperty("--viewport-height")
    vi.restoreAllMocks()
  })

  it("pins --viewport-height in pixels immediately on mount even when no keyboard is open", () => {
    fakeVV.height = 740

    const { result } = renderHook(() => useVisualViewport(true))

    expect(document.documentElement.style.getPropertyValue("--viewport-height")).toBe("740px")
    // No keyboard should be reported — this is steady-state, not a keyboard event.
    expect(result.current).toBe(false)
  })

  it("tracks visualViewport resize events and updates --viewport-height", () => {
    fakeVV.height = 800
    renderHook(() => useVisualViewport(true))
    expect(document.documentElement.style.getPropertyValue("--viewport-height")).toBe("800px")

    act(() => {
      fakeVV.height = 520
      fakeVV.emitResize()
    })

    expect(document.documentElement.style.getPropertyValue("--viewport-height")).toBe("520px")
  })

  it("reports keyboard open when the visual viewport shrinks well below layout viewport", () => {
    fakeVV.height = 800
    const { result } = renderHook(() => useVisualViewport(true))
    expect(result.current).toBe(false)

    // Chrome/Safari: layout viewport stays at innerHeight, visual shrinks.
    act(() => {
      fakeVV.height = 500
      fakeVV.emitResize()
    })
    expect(result.current).toBe(true)

    act(() => {
      fakeVV.height = 800
      fakeVV.emitResize()
    })
    expect(result.current).toBe(false)
  })

  it("detects keyboard via the baseline fallback when both viewports shrink together", () => {
    // Firefox Android (and Chrome with interactive-widget=resizes-content) shrinks
    // both innerHeight and visualViewport.height when the keyboard opens.
    setInnerHeight(800)
    fakeVV.height = 800
    const { result } = renderHook(() => useVisualViewport(true))
    expect(result.current).toBe(false)

    act(() => {
      setInnerHeight(500)
      fakeVV.height = 500
      window.dispatchEvent(new Event("resize"))
    })

    expect(result.current).toBe(true)
  })

  it("re-measures on pageshow so BFCache restores do not linger with a stale height", async () => {
    fakeVV.height = 800
    renderHook(() => useVisualViewport(true))
    expect(document.documentElement.style.getPropertyValue("--viewport-height")).toBe("800px")

    // Simulate a BFCache restore: imagine Chrome's dvh is stale but visualViewport
    // now reports the correct URL-bar-visible height. pageshow should re-measure
    // via the poll loop, which is driven by requestAnimationFrame.
    await act(async () => {
      fakeVV.height = 712
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }))
      // Let one rAF tick the poll callback.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })

    expect(document.documentElement.style.getPropertyValue("--viewport-height")).toBe("712px")
  })

  it("cleans up listeners and removes --viewport-height on unmount", () => {
    fakeVV.height = 800
    const { unmount } = renderHook(() => useVisualViewport(true))
    expect(document.documentElement.style.getPropertyValue("--viewport-height")).toBe("800px")

    unmount()

    expect(document.documentElement.style.getPropertyValue("--viewport-height")).toBe("")

    // After unmount, viewport events must no longer mutate the custom property.
    act(() => {
      fakeVV.height = 400
      fakeVV.emitResize()
      window.dispatchEvent(new Event("resize"))
    })
    expect(document.documentElement.style.getPropertyValue("--viewport-height")).toBe("")
  })

  it("is a no-op when disabled", () => {
    fakeVV.height = 800
    const { result } = renderHook(() => useVisualViewport(false))

    expect(result.current).toBe(false)
    expect(document.documentElement.style.getPropertyValue("--viewport-height")).toBe("")

    act(() => {
      fakeVV.height = 500
      fakeVV.emitResize()
    })
    // Still untouched.
    expect(document.documentElement.style.getPropertyValue("--viewport-height")).toBe("")
  })
})
