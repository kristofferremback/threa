import { useState, useEffect, useRef } from "react"

/** Threshold in px — if viewport height is this much smaller than baseline, keyboard is open */
const KEYBOARD_THRESHOLD = 100

/** How long to poll visualViewport after focus changes to catch keyboard animation (ms) */
const POLL_DURATION = 600

/**
 * Tracks the on-screen keyboard state on mobile devices.
 *
 * Sets a `--viewport-height` CSS custom property on `<html>` imperatively
 * (bypassing React state) for smooth height tracking. Falls back to `100dvh`
 * when the keyboard is closed.
 *
 * Detection strategy (layered to handle browser differences):
 * 1. Primary: visualViewport.height < window.innerHeight (Chrome, Safari)
 * 2. Fallback: visualViewport.height < baselineHeight (Firefox Android,
 *    which resizes both viewports together when the keyboard opens)
 *
 * Also polls `visualViewport` during input focus transitions to catch
 * keyboard animation frames that may not emit discrete resize events.
 */
export function useVisualViewport(enabled: boolean): boolean {
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false)
  const rafId = useRef(0)
  // Baseline height = innerHeight when keyboard is known to be closed.
  // Used as fallback for browsers that resize both viewports together (Firefox).
  const baseHeight = useRef(typeof window !== "undefined" ? window.innerHeight : 0)

  useEffect(() => {
    if (!enabled) return

    const vv = window.visualViewport
    const docEl = document.documentElement

    // Reset baseline on mount
    baseHeight.current = window.innerHeight

    const update = () => {
      const vvHeight = vv ? vv.height : window.innerHeight

      // Primary: visual viewport smaller than layout viewport (Chrome, Safari)
      let keyboardOpen = vv ? vv.height < window.innerHeight - KEYBOARD_THRESHOLD : false

      // Fallback: viewport shrank from baseline (Firefox resizes both together)
      if (!keyboardOpen) {
        keyboardOpen = vvHeight < baseHeight.current - KEYBOARD_THRESHOLD
      }

      // Update baseline when keyboard is confirmed closed
      if (!keyboardOpen) {
        baseHeight.current = window.innerHeight
      }

      if (keyboardOpen) {
        docEl.style.setProperty("--viewport-height", `${vvHeight}px`)
      } else {
        docEl.style.removeProperty("--viewport-height")
      }

      // Only update React state when the boolean actually changes
      setIsKeyboardOpen((prev) => (prev !== keyboardOpen ? keyboardOpen : prev))

      // Pin page scroll to prevent iOS visual viewport panning
      if (vv && vv.offsetTop > 0) {
        window.scrollTo(0, 0)
      }
    }

    // Poll every frame for a duration to catch keyboard open/close animation
    const pollForDuration = (ms: number) => {
      cancelAnimationFrame(rafId.current)
      const start = performance.now()
      const poll = () => {
        update()
        if (performance.now() - start < ms) {
          rafId.current = requestAnimationFrame(poll)
        }
      }
      rafId.current = requestAnimationFrame(poll)
    }

    // Coalesce viewport scroll events via rAF
    const onScroll = () => {
      cancelAnimationFrame(rafId.current)
      rafId.current = requestAnimationFrame(update)
    }

    // Start polling when an editable element receives focus (keyboard about to open)
    const onFocusIn = (e: FocusEvent) => {
      if (e.target instanceof HTMLElement && isEditable(e.target)) {
        pollForDuration(POLL_DURATION)
      }
    }

    // Poll when focus leaves an editable element (keyboard about to close)
    const onFocusOut = (e: FocusEvent) => {
      if (e.target instanceof HTMLElement && isEditable(e.target)) {
        pollForDuration(POLL_DURATION)
      }
    }

    // Set initial state
    update()

    // Listen to visualViewport events (primary detection for Chrome/Safari)
    if (vv) {
      vv.addEventListener("resize", update)
      vv.addEventListener("scroll", onScroll)
    }
    // Also listen to window resize (Firefox fires this when keyboard changes innerHeight)
    window.addEventListener("resize", update)
    document.addEventListener("focusin", onFocusIn)
    document.addEventListener("focusout", onFocusOut)

    return () => {
      cancelAnimationFrame(rafId.current)
      if (vv) {
        vv.removeEventListener("resize", update)
        vv.removeEventListener("scroll", onScroll)
      }
      window.removeEventListener("resize", update)
      document.removeEventListener("focusin", onFocusIn)
      document.removeEventListener("focusout", onFocusOut)
      docEl.style.removeProperty("--viewport-height")
    }
  }, [enabled])

  return enabled ? isKeyboardOpen : false
}

function isEditable(el: HTMLElement): boolean {
  const tag = el.tagName
  if (tag === "INPUT" || tag === "TEXTAREA") return true
  if (el.isContentEditable) return true
  return false
}
