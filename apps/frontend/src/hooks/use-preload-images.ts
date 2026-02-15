import { useState, useEffect, useRef } from "react"

const PRELOAD_TIMEOUT_MS = 2000

/**
 * Preload a list of image URLs into the browser cache.
 * Returns true when all images are loaded (or timeout expires).
 * Empty URL list resolves immediately.
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
    // New images will still be preloaded in the background.
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

    const resolve = () => {
      if (!resolvedRef.current && !cancelled) {
        resolvedRef.current = true
        setReady(true)
      }
    }

    urls.forEach((url) => {
      const img = new Image()
      img.onload = img.onerror = () => {
        loaded++
        if (loaded >= total) resolve()
      }
      img.src = url
    })

    const timer = setTimeout(resolve, PRELOAD_TIMEOUT_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [urlKey, urls])

  return ready
}
