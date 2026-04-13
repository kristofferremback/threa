import { useState, useEffect, useRef } from "react"

/** Threshold in px — if viewport height is this much smaller than baseline, keyboard is open */
const KEYBOARD_THRESHOLD = 100

/** How long to poll visualViewport after focus changes to catch keyboard animation (ms) */
const POLL_DURATION = 600

/**
 * Tracks the on-screen keyboard state on mobile devices and pins
 * `--viewport-height` to the actual visible viewport height.
 *
 * Why always write `--viewport-height` (not just when the keyboard is open)?
 * Chrome on Android does not reliably recompute `dvh` after `location.reload`,
 * pull-to-refresh, or a back-forward cache restore — the engine keeps the
 * pre-reload "URL-bar hidden" value, so any element sized to `100dvh` renders
 * taller than the visible area. The bottom of the app (composer) ends up
 * below the fold until something forces a re-layout (opening the keyboard for
 * search or the quick switcher, URL-bar animation, orientation change).
 * Firefox Android handles `dvh` correctly, which is why the bug is Chrome-only.
 * Sourcing the height from `visualViewport.height` bypasses the buggy `dvh`
 * resolution entirely and gives layout a stable, authoritative value.
 *
 * Detection strategy (layered to handle browser differences):
 * 1. Primary: visualViewport.height < window.innerHeight (Chrome, Safari)
 * 2. Fallback: visualViewport.height < baselineHeight (Firefox Android,
 *    which resizes both viewports together when the keyboard opens)
 *
 * Also polls `visualViewport` during input focus transitions to catch
 * keyboard animation frames that may not emit discrete resize events, and
 * re-measures on `pageshow` so BFCache restores do not linger in a stale
 * viewport state.
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

      // Always pin --viewport-height to a concrete pixel value. Relying on
      // `100dvh` alone is unsafe on Chrome Android, which caches a stale
      // "URL-bar hidden" value across reloads, pull-to-refresh, and BFCache
      // restores and leaves the app taller than the visible viewport until
      // something (keyboard, URL bar animation, orientation change) forces a
      // re-layout.
      docEl.style.setProperty("--viewport-height", `${vvHeight}px`)

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

    // Re-measure when the page is restored (BFCache restore, tab refocus).
    // Chrome Android's dvh is routinely stale here and `resize` events may
    // not fire, so poll briefly to catch the URL bar animation too.
    const onPageShow = () => {
      baseHeight.current = window.innerHeight
      pollForDuration(POLL_DURATION)
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
    window.addEventListener("pageshow", onPageShow)

    return () => {
      cancelAnimationFrame(rafId.current)
      if (vv) {
        vv.removeEventListener("resize", update)
        vv.removeEventListener("scroll", onScroll)
      }
      window.removeEventListener("resize", update)
      document.removeEventListener("focusin", onFocusIn)
      document.removeEventListener("focusout", onFocusOut)
      window.removeEventListener("pageshow", onPageShow)
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
