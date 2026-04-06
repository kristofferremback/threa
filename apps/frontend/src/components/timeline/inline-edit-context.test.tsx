import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act } from "@testing-library/react"
import { useState } from "react"
import { InlineEditProvider, useInlineEdit, useInlineEditRegistration } from "./inline-edit-context"

function Flag() {
  const ctx = useInlineEdit()
  return <span data-testid="flag">{ctx?.isEditingInline ? "on" : "off"}</span>
}

function Surface({ active }: { active: boolean }) {
  useInlineEditRegistration(active)
  return null
}

/** Surface that renders a [data-inline-edit] element like the real MessageEditForm */
function DomSurface({ active }: { active: boolean }) {
  useInlineEditRegistration(active)
  return active ? <div data-inline-edit /> : null
}

describe("InlineEditProvider (refcount)", () => {
  it("flips on while a registered surface is mounted and off after unmount", () => {
    function Harness() {
      const [mounted, setMounted] = useState(true)
      return (
        <InlineEditProvider resetKey="s1">
          <Flag />
          {mounted && <Surface active />}
          <button data-testid="toggle" onClick={() => setMounted(false)}>
            unmount
          </button>
        </InlineEditProvider>
      )
    }

    render(<Harness />)
    expect(screen.getByTestId("flag").textContent).toBe("on")
    act(() => {
      screen.getByTestId("toggle").click()
    })
    expect(screen.getByTestId("flag").textContent).toBe("off")
  })

  it("stays on while any surface is still mounted (overlap across edit-A → edit-B)", () => {
    function Harness() {
      const [aMounted, setAMounted] = useState(true)
      const [bMounted, setBMounted] = useState(false)
      return (
        <InlineEditProvider resetKey="s1">
          <Flag />
          {aMounted && <Surface active />}
          {bMounted && <Surface active />}
          <button data-testid="mount-b" onClick={() => setBMounted(true)}>
            mount-b
          </button>
          <button data-testid="unmount-a" onClick={() => setAMounted(false)}>
            unmount-a
          </button>
        </InlineEditProvider>
      )
    }

    render(<Harness />)
    expect(screen.getByTestId("flag").textContent).toBe("on")
    // Start B before A finishes tearing down — flag must remain on the whole time.
    act(() => {
      screen.getByTestId("mount-b").click()
    })
    expect(screen.getByTestId("flag").textContent).toBe("on")
    act(() => {
      screen.getByTestId("unmount-a").click()
    })
    expect(screen.getByTestId("flag").textContent).toBe("on")
  })

  it("resets when the resetKey changes, even if a stale surface is mounted", () => {
    function Harness({ resetKey }: { resetKey: string }) {
      return (
        <InlineEditProvider resetKey={resetKey}>
          <Flag />
          <Surface active />
        </InlineEditProvider>
      )
    }

    const { rerender } = render(<Harness resetKey="s1" />)
    expect(screen.getByTestId("flag").textContent).toBe("on")
    rerender(<Harness resetKey="s2" />)
    // Effect order: resetKey effect runs and zeros the count. The Surface's
    // registration effect does not re-run (its deps haven't changed), so the
    // count stays at 0 until a new surface mounts. This models stream
    // navigation as a hard safety net.
    expect(screen.getByTestId("flag").textContent).toBe("off")
  })

  it("does not register when active=false", () => {
    render(
      <InlineEditProvider resetKey="s1">
        <Flag />
        <Surface active={false} />
      </InlineEditProvider>
    )
    expect(screen.getByTestId("flag").textContent).toBe("off")
  })
})

describe("InlineEditProvider (safety nets)", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("resets leaked count on visibilitychange when no [data-inline-edit] exists", () => {
    // Render with a Surface that registers but has NO [data-inline-edit] element,
    // simulating a leaked registration where the DOM element is gone.
    function Harness() {
      const [mounted, setMounted] = useState(true)
      return (
        <InlineEditProvider resetKey="s1">
          <Flag />
          {mounted && <Surface active />}
          <button data-testid="remove" onClick={() => setMounted(false)}>
            remove
          </button>
        </InlineEditProvider>
      )
    }

    render(<Harness />)
    expect(screen.getByTestId("flag").textContent).toBe("on")

    // Simulate the leak: unmount the Surface but force count to stay positive
    // by directly manipulating the count via a second registration that doesn't clean up.
    // Instead, simulate leakage more simply: the Surface is mounted (count=1), we
    // fire visibilitychange while it's mounted but has no [data-inline-edit] DOM element.
    // Since Surface doesn't render [data-inline-edit], the safety net should reset.
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"))
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true })
      document.dispatchEvent(new Event("visibilitychange"))
    })
    expect(screen.getByTestId("flag").textContent).toBe("off")
  })

  it("does NOT reset count when [data-inline-edit] exists in DOM", () => {
    render(
      <InlineEditProvider resetKey="s1">
        <Flag />
        <DomSurface active />
      </InlineEditProvider>
    )
    expect(screen.getByTestId("flag").textContent).toBe("on")

    // Fire visibilitychange — should NOT reset because the DOM element exists
    act(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true })
      document.dispatchEvent(new Event("visibilitychange"))
    })
    expect(screen.getByTestId("flag").textContent).toBe("on")
  })

  it("auto-corrects leaked count after 2s delay", () => {
    // Surface registers (count=1) but has no [data-inline-edit] DOM element
    render(
      <InlineEditProvider resetKey="s1">
        <Flag />
        <Surface active />
      </InlineEditProvider>
    )
    expect(screen.getByTestId("flag").textContent).toBe("on")

    // Advance past the 2s verification delay
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    // No [data-inline-edit] in DOM → count auto-corrected to 0
    expect(screen.getByTestId("flag").textContent).toBe("off")
  })

  it("does NOT auto-correct when [data-inline-edit] exists after 2s", () => {
    render(
      <InlineEditProvider resetKey="s1">
        <Flag />
        <DomSurface active />
      </InlineEditProvider>
    )
    expect(screen.getByTestId("flag").textContent).toBe("on")

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    // [data-inline-edit] exists → count stays
    expect(screen.getByTestId("flag").textContent).toBe("on")
  })
})
