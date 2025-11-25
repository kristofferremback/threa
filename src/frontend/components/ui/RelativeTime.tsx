import { useState, useRef, useEffect } from "react"
import { formatDistanceToNow, format } from "date-fns"
import { createPortal } from "react-dom"

interface RelativeTimeProps {
  date: Date | string
  addSuffix?: boolean
  className?: string
  style?: React.CSSProperties
  fullFormat?: string
}

export function RelativeTime({
  date,
  addSuffix = true,
  className = "",
  style,
  fullFormat = "MMMM d, yyyy 'at' h:mm a",
}: RelativeTimeProps) {
  const [showTooltip, setShowTooltip] = useState(false)
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLSpanElement>(null)
  const tooltipRef = useRef<HTMLSpanElement>(null)

  const dateObj = typeof date === "string" ? new Date(date) : date
  const relativeText = formatDistanceToNow(dateObj, { addSuffix })
  const fullText = format(dateObj, fullFormat)

  // Calculate tooltip position when shown
  useEffect(() => {
    if (!showTooltip || !triggerRef.current) return

    const triggerRect = triggerRef.current.getBoundingClientRect()
    const padding = 8 // Minimum distance from viewport edge

    // Start with centered position above the trigger
    let left = triggerRect.left + triggerRect.width / 2
    let top = triggerRect.top - padding

    // Wait for tooltip to render to get its dimensions
    requestAnimationFrame(() => {
      if (!tooltipRef.current) return

      const tooltipRect = tooltipRef.current.getBoundingClientRect()

      // Adjust horizontal position to stay within viewport
      const halfWidth = tooltipRect.width / 2
      if (left - halfWidth < padding) {
        left = padding + halfWidth
      } else if (left + halfWidth > window.innerWidth - padding) {
        left = window.innerWidth - padding - halfWidth
      }

      // If tooltip would go above viewport, show it below instead
      if (top - tooltipRect.height < padding) {
        top = triggerRect.bottom + padding + tooltipRect.height
      }

      setTooltipPosition({ top, left })
    })

    setTooltipPosition({ top, left })
  }, [showTooltip])

  return (
    <>
      <span
        ref={triggerRef}
        className={`cursor-default ${className}`}
        style={style}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {relativeText}
      </span>
      {showTooltip &&
        createPortal(
          <span
            ref={tooltipRef}
            className="fixed px-2 py-1 text-xs rounded whitespace-nowrap z-[10000] pointer-events-none"
            style={{
              top: tooltipPosition.top,
              left: tooltipPosition.left,
              transform: "translate(-50%, -100%)",
              background: "var(--bg-elevated)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-subtle)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            }}
          >
            {fullText}
          </span>,
          document.body,
        )}
    </>
  )
}
