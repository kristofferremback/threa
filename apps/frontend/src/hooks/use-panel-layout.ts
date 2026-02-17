import { useState, useEffect, useRef, useCallback } from "react"
import { useResizeDrag } from "./use-resize-drag"

const DEFAULT_PANEL_WIDTH = 480
const MIN_PANEL_WIDTH = 300
const MAX_PANEL_RATIO = 0.7

export function usePanelLayout(isPanelOpen: boolean) {
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH)
  const [enableTransition, setEnableTransition] = useState(false)
  const [showContent, setShowContent] = useState(isPanelOpen)
  const containerRef = useRef<HTMLDivElement>(null)

  // Enable transitions after first paint to prevent animation on page load
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setEnableTransition(true)
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  const handleTransitionEnd = useCallback(
    (e: React.TransitionEvent) => {
      // Only respond to our own width transition, not bubbled child transitions
      // (e.g. resize handle's transition-colors finishes 50ms earlier)
      if (e.propertyName === "width" && e.target === e.currentTarget && !isPanelOpen) {
        setShowContent(false)
      }
    },
    [isPanelOpen]
  )

  const handleWidthChange = useCallback((newWidth: number) => {
    if (!containerRef.current) {
      throw new Error("usePanelLayout: containerRef must be attached to a DOM element for max-width clamping")
    }
    const containerWidth = containerRef.current.offsetWidth
    const maxWidth = Math.round(containerWidth * MAX_PANEL_RATIO)
    setPanelWidth(Math.max(MIN_PANEL_WIDTH, Math.min(maxWidth, newWidth)))
  }, [])

  const { isResizing, handleResizeStart } = useResizeDrag({
    width: panelWidth,
    onWidthChange: handleWidthChange,
    direction: "left",
  })

  // Content mount/unmount lifecycle — keep content mounted during close animation
  useEffect(() => {
    if (isPanelOpen) {
      setShowContent(true)
    } else if (!enableTransition || isResizing) {
      // No transition will fire — unmount immediately
      setShowContent(false)
    }
  }, [isPanelOpen, enableTransition, isResizing])

  const handleResizeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 50 : 10
      if (e.key === "ArrowLeft") {
        e.preventDefault()
        handleWidthChange(panelWidth + step)
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        handleWidthChange(panelWidth - step)
      }
    },
    [panelWidth, handleWidthChange]
  )

  const maxWidth = Math.round((containerRef.current?.offsetWidth ?? 0) * MAX_PANEL_RATIO)

  return {
    containerRef,
    panelWidth,
    maxWidth,
    minWidth: MIN_PANEL_WIDTH,
    displayWidth: isPanelOpen ? panelWidth : 0,
    shouldAnimate: enableTransition && !isResizing,
    isResizing,
    showContent,
    handleResizeStart,
    handleResizeKeyDown,
    handleTransitionEnd,
  }
}
