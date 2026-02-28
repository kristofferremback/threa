import { useState, useEffect } from "react"

export interface VisualViewportState {
  /** Visual viewport height in px (shrinks when keyboard opens) */
  height: number
}

/** Threshold in px — if visual viewport is this much smaller than layout viewport, keyboard is open */
const KEYBOARD_THRESHOLD = 100

/**
 * Tracks `window.visualViewport` to detect on-screen keyboard.
 * Returns null when the keyboard is closed (or on desktop / unavailable API).
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
      const keyboardOpen = vv.height < window.innerHeight - KEYBOARD_THRESHOLD
      if (keyboardOpen) {
        setState((prev) => (prev?.height === vv.height ? prev : { height: vv.height }))
      } else {
        setState((prev) => (prev === null ? prev : null))
      }
    }

    // Set initial state
    update()

    vv.addEventListener("resize", update)

    return () => {
      vv.removeEventListener("resize", update)
    }
  }, [enabled])

  return enabled ? state : null
}
