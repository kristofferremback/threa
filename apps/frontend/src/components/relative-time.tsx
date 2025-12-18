import { useState, useEffect } from "react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

interface RelativeTimeProps {
  date: Date | string | null | undefined
  className?: string
}

export function RelativeTime({ date, className }: RelativeTimeProps) {
  const [, setTick] = useState(0)

  // Handle null, undefined, or invalid values
  if (!date) {
    return <span className={className}>--</span>
  }

  const dateObj = date instanceof Date ? date : new Date(date)
  const isValid = dateObj instanceof Date && !isNaN(dateObj.getTime())

  // Update every minute to keep relative times fresh
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(interval)
  }, [])

  if (!isValid) {
    return <span className={className}>--</span>
  }

  const relative = formatRelativeTime(dateObj)
  const full = formatFullDateTime(dateObj)

  return (
    <TooltipProvider>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <span className={className}>{relative}</span>
        </TooltipTrigger>
        <TooltipContent>
          <p>{full}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffSec < 60) {
    return "just now"
  }
  if (diffMin < 60) {
    return `${diffMin}m ago`
  }
  if (diffHour < 24) {
    return `${diffHour}h ago`
  }
  if (diffDay === 1) {
    return "yesterday"
  }
  if (diffDay < 7) {
    return `${diffDay}d ago`
  }

  // For older dates, show the date
  const isThisYear = date.getFullYear() === now.getFullYear()
  if (isThisYear) {
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

function formatFullDateTime(date: Date): string {
  return date.toLocaleString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
