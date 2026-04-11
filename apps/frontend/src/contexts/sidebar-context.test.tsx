import { describe, it, expect } from "vitest"
import { renderHook, act } from "@testing-library/react"
import type { ReactNode } from "react"
import { SidebarProvider, useSidebar } from "./sidebar-context"

function wrapper({ children }: { children: ReactNode }) {
  return <SidebarProvider>{children}</SidebarProvider>
}

describe("SidebarContext.togglePinned (desktop)", () => {
  it("locks a hover-preview sidebar as pinned instead of collapsing it", () => {
    const { result } = renderHook(() => useSidebar(), { wrapper })

    // Start from collapsed → hover opens preview
    act(() => result.current.collapse())
    act(() => result.current.setHovering(true))
    expect(result.current.state).toBe("preview")

    // While still hovering, toggling should LOCK it as pinned, not collapse
    act(() => result.current.togglePinned())
    expect(result.current.state).toBe("pinned")
  })

  it("collapses a pinned sidebar", () => {
    const { result } = renderHook(() => useSidebar(), { wrapper })

    // Force pinned first (default state from a fresh provider may be pinned,
    // but explicitly ensure it).
    if (result.current.state !== "pinned") {
      act(() => result.current.togglePinned())
    }
    expect(result.current.state).toBe("pinned")

    act(() => result.current.togglePinned())
    expect(result.current.state).toBe("collapsed")
  })

  it("expands a collapsed sidebar to pinned", () => {
    const { result } = renderHook(() => useSidebar(), { wrapper })

    act(() => result.current.collapse())
    expect(result.current.state).toBe("collapsed")

    act(() => result.current.togglePinned())
    expect(result.current.state).toBe("pinned")
  })
})
