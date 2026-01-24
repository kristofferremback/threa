import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"

const INDICATOR_DELAY_MS = 200

interface StreamLoadingIndicatorProps {
  isLoading: boolean
  className?: string
}

/**
 * A subtle loading indicator shown in the stream header when fetching data.
 * Uses a delayed render to avoid flashing for fast loads.
 * Renders as an indeterminate progress bar at the bottom of the header.
 */
export function StreamLoadingIndicator({ isLoading, className }: StreamLoadingIndicatorProps) {
  const [showIndicator, setShowIndicator] = useState(false)

  useEffect(() => {
    if (!isLoading) {
      setShowIndicator(false)
      return
    }

    const timer = setTimeout(() => {
      setShowIndicator(true)
    }, INDICATOR_DELAY_MS)

    return () => clearTimeout(timer)
  }, [isLoading])

  if (!showIndicator) {
    return null
  }

  return (
    <div
      data-testid="stream-loading-indicator"
      className={cn("absolute bottom-0 left-0 right-0 h-0.5 overflow-hidden", className)}
    >
      <div className="h-full w-1/3 animate-indeterminate-progress bg-primary/60" />
    </div>
  )
}
