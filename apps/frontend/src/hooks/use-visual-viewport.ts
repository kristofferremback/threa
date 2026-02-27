import { useState, useEffect } from "react"

interface VisualViewportState {
  /** Visual viewport height in px (shrinks when keyboard opens) */
  height: number
}

/**
 * Tracks `window.visualViewport` to detect on-screen keyboard.
 * Returns null on desktop or when visual viewport API is unavailable.
 *
 * When the keyboard opens on mobile, the visual viewport shrinks while
 * the layout viewport stays the same. We use this delta to adjust the
 * app shell height so the message input stays above the keyboard.
 */
export function useVisualViewport(enabled: boolean): VisualViewportState | null {
  const [state, setState] = useState<VisualViewportState | null>(null)

  useEffect(() => {
    if (!enabled || !window.visualViewport) return

    const vv = window.visualViewport

    const update = () => {
      setState({ height: vv.height })
    }

    // Set initial state
    update()

    vv.addEventListener("resize", update)
    vv.addEventListener("scroll", update)

    return () => {
      vv.removeEventListener("resize", update)
      vv.removeEventListener("scroll", update)
    }
  }, [enabled])

  return enabled ? state : null
}
