import { describe, it, expect, afterEach } from "vitest"
import { act, render, renderHook } from "@testing-library/react"
import { useScrollBehavior } from "./use-scroll-behavior"

type ResizeCallback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void

function installManualResizeObserver(): { trigger: () => void; restore: () => void } {
  let lastCallback: ResizeCallback | null = null
  const original = global.ResizeObserver
  class ManualResizeObserver {
    constructor(cb: ResizeCallback) {
      lastCallback = cb
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  global.ResizeObserver = ManualResizeObserver as unknown as typeof ResizeObserver
  return {
    trigger: () => lastCallback?.([], {} as ResizeObserver),
    restore: () => {
      global.ResizeObserver = original
    },
  }
}

function makeScrollableDiv(initial: { scrollHeight: number; clientHeight: number; scrollTop?: number }) {
  const el = document.createElement("div")
  let scrollTop = initial.scrollTop ?? 0
  let clientHeight = initial.clientHeight
  const scrollHeight = initial.scrollHeight
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => scrollHeight })
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    get: () => clientHeight,
  })
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = v
    },
  })
  return {
    el,
    get scrollTop() {
      return scrollTop
    },
    setClientHeight: (h: number) => {
      clientHeight = h
    },
  }
}

type HookApi = ReturnType<typeof useScrollBehavior>

/**
 * Mounts useScrollBehavior with `element` pre-attached to its scroll container
 * ref. Direct-assigning the ref in the render body — rather than after
 * renderHook returns — guarantees the hook's `useEffect` sees a populated ref
 * on mount, which is what happens in production when JSX attaches the ref to a
 * DOM element. Without this, the resize observer effect short-circuits on
 * `if (!el) return` and the test exercises the wrong branch.
 */
function renderHookWithElement(
  options: Parameters<typeof useScrollBehavior>[0],
  element: HTMLDivElement
): { current: HookApi } {
  // Box the latest hook return through a stable wrapper so callers always see
  // the post-update value after React re-renders — the local snapshot stays
  // stale and reads like `isScrolledFarFromBottom` would never flip.
  const ref: { current: HookApi | undefined } = { current: undefined }
  function Probe() {
    const api = useScrollBehavior(options)
    api.scrollContainerRef.current = element
    ref.current = api
    return null
  }
  render(<Probe />)
  if (!ref.current) throw new Error("Probe did not capture the hook return value")
  return ref as { current: HookApi }
}

describe("useScrollBehavior", () => {
  afterEach(() => {
    // installManualResizeObserver returns a restore() function — tests that
    // need cleanup call it directly so this hook stays defensive only.
  })

  it("clears the jump-to-latest state when force-scrolling to the bottom", () => {
    const { result } = renderHook(() =>
      useScrollBehavior({
        isLoading: false,
        itemCount: 100,
      })
    )

    const element = document.createElement("div")
    let scrollTop = 0

    Object.defineProperty(element, "scrollHeight", {
      configurable: true,
      get: () => 1000,
    })
    Object.defineProperty(element, "clientHeight", {
      configurable: true,
      get: () => 100,
    })
    Object.defineProperty(element, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value
      },
    })

    result.current.scrollContainerRef.current = element

    act(() => {
      scrollTop = 0
      result.current.handleScroll()
    })

    expect(result.current.isScrolledFarFromBottom).toBe(true)

    act(() => {
      result.current.scrollToBottom({ force: true })
    })

    expect(scrollTop).toBe(1000)
    expect(result.current.isScrolledFarFromBottom).toBe(false)
  })

  it("shifts scrollTop by the height delta when the container shrinks and user is not at bottom", async () => {
    // Captures the keyboard-open scenario: container goes 800→500, user was
    // scrolled away from the bottom. Without compensation the previously-
    // visible bottom row would drift up by the 300px the container lost;
    // the resize handler adds the delta to scrollTop so the bottom anchor
    // tracks the same content.
    const { trigger, restore } = installManualResizeObserver()
    try {
      const scrollable = makeScrollableDiv({ scrollHeight: 5000, clientHeight: 800 })
      const apiRef = renderHookWithElement({ isLoading: false, itemCount: 100 }, scrollable.el)

      // Initial mount triggers the auto-scroll useLayoutEffect, which pins
      // scrollTop to scrollHeight (5000) and starts a 150ms grace period
      // during which handleScroll won't clear shouldAutoScroll. Wait it out,
      // then place the user mid-list and let handleScroll flip the flag.
      await new Promise((r) => setTimeout(r, 200))
      scrollable.el.scrollTop = 1000
      act(() => apiRef.current.handleScroll())
      expect(apiRef.current.isScrolledFarFromBottom).toBe(true)

      // Container shrinks (keyboard opened): clientHeight 800 → 500.
      scrollable.setClientHeight(500)
      act(() => trigger())

      expect(scrollable.scrollTop).toBe(1300)
    } finally {
      restore()
    }
  })

  it("anchors to the bottom on resize when shouldAutoScroll is true", () => {
    const { trigger, restore } = installManualResizeObserver()
    try {
      const scrollable = makeScrollableDiv({ scrollHeight: 5000, clientHeight: 800 })
      renderHookWithElement({ isLoading: false, itemCount: 100 }, scrollable.el)

      // Initial mount auto-scrolls to bottom (scrollTop=scrollHeight=5000) and
      // leaves shouldAutoScroll=true. Keyboard opens (clientHeight 800→500);
      // the resize handler must pin scrollTop to scrollHeight rather than
      // shift by the delta, so the latest message stays anchored above the
      // composer.
      scrollable.setClientHeight(500)
      act(() => trigger())
      expect(scrollable.scrollTop).toBe(5000)
    } finally {
      restore()
    }
  })
})
