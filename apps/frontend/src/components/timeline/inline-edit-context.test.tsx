import { describe, it, expect } from "vitest"
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
