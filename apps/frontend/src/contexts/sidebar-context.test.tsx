import { describe, it, expect, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import type { ReactNode } from "react"
import { SidebarProvider, useSidebar } from "./sidebar-context"

const SIDEBAR_STATE_KEY = "threa-sidebar-state"

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

describe("SidebarContext.cycleSectionState", () => {
  beforeEach(() => {
    localStorage.removeItem(SIDEBAR_STATE_KEY)
  })

  it("quick-links defaults to auto", () => {
    const { result } = renderHook(() => useSidebar(), { wrapper })
    expect(result.current.getSectionState("quick-links", "auto")).toBe("auto")
  })

  it("other section defaults to collapsed", () => {
    const { result } = renderHook(() => useSidebar(), { wrapper })
    expect(result.current.getSectionState("other", "collapsed")).toBe("collapsed")
  })

  it("unknown sections fall back to the provided default", () => {
    const { result } = renderHook(() => useSidebar(), { wrapper })
    expect(result.current.getSectionState("channels")).toBe("open")
    expect(result.current.getSectionState("channels", "auto")).toBe("auto")
  })

  it("cycles a section through auto → collapsed → open → auto", () => {
    const { result } = renderHook(() => useSidebar(), { wrapper })

    expect(result.current.getSectionState("quick-links", "auto")).toBe("auto")

    act(() => result.current.cycleSectionState("quick-links", "auto"))
    expect(result.current.getSectionState("quick-links", "auto")).toBe("collapsed")

    act(() => result.current.cycleSectionState("quick-links", "auto"))
    expect(result.current.getSectionState("quick-links", "auto")).toBe("open")

    act(() => result.current.cycleSectionState("quick-links", "auto"))
    expect(result.current.getSectionState("quick-links", "auto")).toBe("auto")
  })

  it("cycles an unknown section from its default", () => {
    const { result } = renderHook(() => useSidebar(), { wrapper })

    act(() => result.current.cycleSectionState("channels")) // from open → auto
    expect(result.current.getSectionState("channels")).toBe("auto")
  })

  it("persists section states to localStorage", () => {
    const { result } = renderHook(() => useSidebar(), { wrapper })

    act(() => result.current.cycleSectionState("quick-links", "auto")) // auto -> collapsed

    const raw = localStorage.getItem(SIDEBAR_STATE_KEY)
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw as string)
    expect(parsed.sectionStates["quick-links"]).toBe("collapsed")
  })

  it("migrates legacy collapsedSections into sectionStates", () => {
    localStorage.setItem(
      SIDEBAR_STATE_KEY,
      JSON.stringify({
        openState: "open",
        width: 260,
        viewMode: "smart",
        collapsedSections: ["channels", "dms"],
      })
    )

    const { result } = renderHook(() => useSidebar(), { wrapper })
    expect(result.current.getSectionState("channels")).toBe("collapsed")
    expect(result.current.getSectionState("dms")).toBe("collapsed")
  })

  it("migrates legacy quickLinksState into sectionStates['quick-links']", () => {
    localStorage.setItem(
      SIDEBAR_STATE_KEY,
      JSON.stringify({
        openState: "open",
        width: 260,
        viewMode: "smart",
        quickLinksState: "open",
      })
    )

    const { result } = renderHook(() => useSidebar(), { wrapper })
    expect(result.current.getSectionState("quick-links", "auto")).toBe("open")
  })

  it("ignores invalid persisted values", () => {
    localStorage.setItem(
      SIDEBAR_STATE_KEY,
      JSON.stringify({
        openState: "open",
        width: 260,
        viewMode: "smart",
        sectionStates: { "quick-links": "nonsense", channels: "auto" },
      })
    )

    const { result } = renderHook(() => useSidebar(), { wrapper })
    expect(result.current.getSectionState("quick-links", "auto")).toBe("auto")
    expect(result.current.getSectionState("channels")).toBe("auto")
  })
})
