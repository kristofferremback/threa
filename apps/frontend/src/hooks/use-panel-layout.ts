import { useState, useEffect, useRef, useCallback } from "react"

const DEFAULT_PANEL_WIDTH = 480
const MIN_PANEL_WIDTH = 300
const MAX_PANEL_RATIO = 0.7

export function usePanelLayout(isPanelOpen: boolean) {
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH)
  const [isResizing, setIsResizing] = useState(false)
  const [enableTransition, setEnableTransition] = useState(false)
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Enable transitions after first paint to prevent animation on page load
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setEnableTransition(true)
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      resizeRef.current = { startX: e.clientX, startWidth: panelWidth }
      setIsResizing(true)
    },
    [panelWidth]
  )

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current || !containerRef.current) return
      const containerWidth = containerRef.current.offsetWidth
      const maxWidth = Math.round(containerWidth * MAX_PANEL_RATIO)
      // Dragging left increases panel width (panel is on the right side)
      const delta = resizeRef.current.startX - e.clientX
      const newWidth = Math.max(MIN_PANEL_WIDTH, Math.min(maxWidth, resizeRef.current.startWidth + delta))
      setPanelWidth(newWidth)
    }

    const handleMouseUp = () => {
      resizeRef.current = null
      setIsResizing(false)
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
    return () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
    }
  }, [isResizing])

  return {
    containerRef,
    panelWidth,
    displayWidth: isPanelOpen ? panelWidth : 0,
    shouldAnimate: enableTransition && !isResizing,
    isResizing,
    handleResizeStart,
  }
}
