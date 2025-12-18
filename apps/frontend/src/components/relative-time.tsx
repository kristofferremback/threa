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
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })

  // Same day: just show time
  if (isSameDay(date, now)) {
    return time
  }

  // Yesterday
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (isSameDay(date, yesterday)) {
    return `yesterday ${time}`
  }

  // Within the last week: show day name
  const daysAgo = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
  if (daysAgo < 7) {
    const dayName = date.toLocaleDateString(undefined, { weekday: "long" })
    return `${dayName} ${time}`
  }

  // Same year: show month and day
  if (date.getFullYear() === now.getFullYear()) {
    const monthDay = date.toLocaleDateString(undefined, { month: "long", day: "numeric" })
    return `${monthDay} ${time}`
  }

  // Different year: show full date
  const fullDate = date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
  return `${fullDate} ${time}`
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
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
