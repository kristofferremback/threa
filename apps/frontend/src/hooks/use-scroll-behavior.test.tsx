import { describe, it, expect } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { useScrollBehavior } from "./use-scroll-behavior"

describe("useScrollBehavior", () => {
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
})
