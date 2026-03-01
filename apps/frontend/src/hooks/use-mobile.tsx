import { useSyncExternalStore } from "react"

export const MOBILE_BREAKPOINT = 640

const mobileQuery = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

// Shared subscription — one matchMedia listener regardless of how many
// components call useIsMobile (avoids N listeners in long message lists).
const mql = typeof window !== "undefined" ? window.matchMedia(mobileQuery) : null

function subscribe(onChange: () => void) {
  mql?.addEventListener("change", onChange)
  return () => mql?.removeEventListener("change", onChange)
}

function getSnapshot() {
  return mql?.matches ?? false
}

export function useIsMobile() {
  return useSyncExternalStore(subscribe, getSnapshot)
}
