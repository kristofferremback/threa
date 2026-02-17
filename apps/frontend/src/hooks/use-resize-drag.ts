import { useState, useEffect, useRef, useCallback } from "react"

interface UseResizeDragOptions {
  /** Current width of the resizable element */
  width: number
  /** Called on each mousemove with the computed new width */
  onWidthChange: (newWidth: number) => void
  /** "right" = dragging right increases width (sidebar), "left" = dragging left increases width (right-side panel) */
  direction?: "right" | "left"
  /** Called when drag starts */
  onResizeStart?: () => void
  /** Called when drag ends (mouseup or focus loss) */
  onResizeEnd?: () => void
}

interface UseResizeDragReturn {
  isResizing: boolean
  handleResizeStart: (e: React.MouseEvent) => void
}

/**
 * Shared drag-resize primitive. Handles mousedown → mousemove → mouseup lifecycle
 * with document-level listeners and blur escape hatch for stuck state prevention.
 */
export function useResizeDrag({
  width,
  onWidthChange,
  direction = "right",
  onResizeStart,
  onResizeEnd,
}: UseResizeDragOptions): UseResizeDragReturn {
  const [isResizing, setIsResizing] = useState(false)
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      resizeRef.current = { startX: e.clientX, startWidth: width }
      setIsResizing(true)
      onResizeStart?.()
    },
    [width, onResizeStart]
  )

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return
      const rawDelta = e.clientX - resizeRef.current.startX
      const delta = direction === "right" ? rawDelta : -rawDelta
      onWidthChange(resizeRef.current.startWidth + delta)
    }

    const handleMouseUp = () => {
      resizeRef.current = null
      setIsResizing(false)
      onResizeEnd?.()
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
    window.addEventListener("blur", handleMouseUp)

    return () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
      window.removeEventListener("blur", handleMouseUp)
    }
  }, [isResizing, direction, onWidthChange, onResizeEnd])

  return { isResizing, handleResizeStart }
}
