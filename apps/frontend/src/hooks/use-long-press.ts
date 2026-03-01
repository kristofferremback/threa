import { useRef, useCallback, useState } from "react"

interface UseLongPressOptions {
  /** Duration in ms before long press fires (default: 500) */
  threshold?: number
  /** Called when long press is detected */
  onLongPress: () => void
  /** Disable the hook (e.g., on desktop) */
  enabled?: boolean
}

interface LongPressHandlers {
  onTouchStart: (e: React.TouchEvent) => void
  onTouchEnd: () => void
  onTouchMove: (e: React.TouchEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
}

interface UseLongPressReturn {
  handlers: LongPressHandlers
  /** True while the user is holding and the timer hasn't fired yet */
  isPressed: boolean
}

export function useLongPress({
  threshold = 500,
  onLongPress,
  enabled = true,
}: UseLongPressOptions): UseLongPressReturn {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startPos = useRef<{ x: number; y: number } | null>(null)
  const firedRef = useRef(false)
  const [isPressed, setIsPressed] = useState(false)

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    startPos.current = null
    setIsPressed(false)
  }, [])

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled) return
      firedRef.current = false
      const touch = e.touches[0]
      startPos.current = { x: touch.clientX, y: touch.clientY }
      setIsPressed(true)
      timerRef.current = setTimeout(() => {
        firedRef.current = true
        setIsPressed(false)
        // Haptic feedback (Android; silent no-op on iOS)
        try {
          navigator.vibrate?.(10)
        } catch {
          // Ignore
        }
        onLongPress()
      }, threshold)
    },
    [enabled, onLongPress, threshold]
  )

  const onTouchEnd = useCallback(() => {
    clear()
  }, [clear])

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!startPos.current) return
      const touch = e.touches[0]
      const dx = touch.clientX - startPos.current.x
      const dy = touch.clientY - startPos.current.y
      // Cancel if moved more than 10px (user is scrolling)
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        clear()
      }
    },
    [clear]
  )

  // Prevent native context menu on long press (mobile text selection menu)
  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (enabled && firedRef.current) {
        e.preventDefault()
      }
    },
    [enabled]
  )

  return {
    handlers: { onTouchStart, onTouchEnd, onTouchMove, onContextMenu },
    isPressed,
  }
}
