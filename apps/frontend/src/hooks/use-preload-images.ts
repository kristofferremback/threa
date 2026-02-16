import { useState, useEffect, useRef } from "react"

const PRELOAD_TIMEOUT_MS = 2000
const MAX_CONCURRENT = 6

/**
 * Preload a list of image URLs into the browser cache.
 * Returns true when all images are loaded (or timeout expires).
 * Loads at most MAX_CONCURRENT images in parallel to avoid saturating
 * browser connections. Empty URL list resolves immediately.
 */
export function usePreloadImages(urls: string[]): boolean {
  const [ready, setReady] = useState(urls.length === 0)
  const resolvedRef = useRef(false)
  const urlKeyRef = useRef("")

  // Stable key for dependency tracking — avoids re-triggering on same URL set
  const urlKey = urls.join(",")

  useEffect(() => {
    if (urls.length === 0) {
      setReady(true)
      return
    }

    // If URLs haven't changed, skip
    if (urlKey === urlKeyRef.current) return
    urlKeyRef.current = urlKey

    // Once resolved on initial load, don't block again for URL changes.
    // New images still preloaded in background (no concurrency limit needed
    // since browser HTTP cache serves most of these instantly).
    if (resolvedRef.current) {
      urls.forEach((url) => {
        const img = new Image()
        img.src = url
      })
      return
    }

    let cancelled = false
    let loaded = 0
    const total = urls.length
    let nextIndex = 0

    const resolve = () => {
      if (!resolvedRef.current && !cancelled) {
        resolvedRef.current = true
        setReady(true)
      }
    }

    const loadNext = () => {
      if (nextIndex >= total) return
      const url = urls[nextIndex++]
      const img = new Image()
      img.onload = img.onerror = () => {
        loaded++
        if (loaded >= total) {
          resolve()
        } else {
          loadNext()
        }
      }
      img.src = url
    }

    // Start up to MAX_CONCURRENT loads in parallel
    const initialBatch = Math.min(MAX_CONCURRENT, total)
    for (let i = 0; i < initialBatch; i++) {
      loadNext()
    }

    const timer = setTimeout(resolve, PRELOAD_TIMEOUT_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [urlKey, urls])

  return ready
}
