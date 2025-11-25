import { useState } from "react"
import { formatDistanceToNow, format } from "date-fns"

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
  const dateObj = typeof date === "string" ? new Date(date) : date
  const relativeText = formatDistanceToNow(dateObj, { addSuffix })
  const fullText = format(dateObj, fullFormat)

  return (
    <span
      className={`relative cursor-default ${className}`}
      style={style}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {relativeText}
      {showTooltip && (
        <span
          className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-2 py-1 text-xs rounded whitespace-nowrap z-50 pointer-events-none"
          style={{
            background: "var(--bg-elevated)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-subtle)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          }}
        >
          {fullText}
        </span>
      )}
    </span>
  )
}

