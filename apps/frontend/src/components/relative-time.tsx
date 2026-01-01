import { useState, useEffect } from "react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { formatRelativeTime, formatFullDateTime } from "@/lib/dates"

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
