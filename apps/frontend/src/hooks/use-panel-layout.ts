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

  // Content mount/unmount lifecycle — keep content mounted during close animation
  useEffect(() => {
    if (isPanelOpen) {
      setShowContent(true)
    } else if (!enableTransition) {
      // No transition active = instant unmount (e.g. page load edge case)
      setShowContent(false)
    }
  }, [isPanelOpen, enableTransition])

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

  return {
    containerRef,
    panelWidth,
    displayWidth: isPanelOpen ? panelWidth : 0,
    shouldAnimate: enableTransition && !isResizing,
    isResizing,
    showContent,
    handleResizeStart,
    handleTransitionEnd,
  }
}
