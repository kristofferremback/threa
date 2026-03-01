import { useEffect, useRef, useState } from "react"

const THRESHOLD = 80
const MAX_PULL = 128
const RESISTANCE = 0.4

/** Find the nearest ancestor with vertical overflow scrolling. */
function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  while (el) {
    if (el.scrollHeight > el.clientHeight) {
      const { overflowY } = getComputedStyle(el)
      if (overflowY === "auto" || overflowY === "scroll") return el
    }
    el = el.parentElement
  }
  return null
}

export function usePullToRefresh(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const [distance, setDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (!enabled) return
    const container = ref.current
    if (!container) return

    let startY = 0
    let scrollEl: HTMLElement | null = null
    let pulling = false
    let isRefreshing = false
    let dist = 0
    let crossed = false

    function onTouchStart(e: TouchEvent) {
      if (isRefreshing) return
      startY = e.touches[0].clientY
      scrollEl = findScrollParent(e.target as HTMLElement)
      pulling = false
      crossed = false
    }

    function onTouchMove(e: TouchEvent) {
      if (isRefreshing) return
      const dy = e.touches[0].clientY - startY

      if (dy <= 0) {
        if (pulling) {
          pulling = false
          dist = 0
          setDistance(0)
        }
        return
      }

      // Let the scroll container handle it if not at the top
      if (scrollEl && scrollEl.scrollTop > 1) return

      const d = Math.min(dy * RESISTANCE, MAX_PULL)
      if (d > 5) {
        e.preventDefault()
        pulling = true
        dist = d
        setDistance(d)

        if (d >= THRESHOLD && !crossed) {
          crossed = true
          navigator.vibrate?.(10)
        }
        if (d < THRESHOLD) crossed = false
      }
    }

    function onTouchEnd() {
      if (!pulling) return
      pulling = false

      if (dist >= THRESHOLD) {
        isRefreshing = true
        setRefreshing(true)
        setDistance(THRESHOLD)
        setTimeout(() => window.location.reload(), 400)
      } else {
        dist = 0
        setDistance(0)
      }
    }

    container.addEventListener("touchstart", onTouchStart, { passive: true })
    container.addEventListener("touchmove", onTouchMove, { passive: false })
    container.addEventListener("touchend", onTouchEnd)
    container.addEventListener("touchcancel", onTouchEnd)

    return () => {
      container.removeEventListener("touchstart", onTouchStart)
      container.removeEventListener("touchmove", onTouchMove)
      container.removeEventListener("touchend", onTouchEnd)
      container.removeEventListener("touchcancel", onTouchEnd)
    }
  }, [enabled])

  return {
    ref,
    distance,
    progress: Math.min(distance / THRESHOLD, 1),
    pulling: distance > 0 && !refreshing,
    refreshing,
  }
}
