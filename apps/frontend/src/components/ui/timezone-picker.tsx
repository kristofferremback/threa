import { useMemo, useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

/**
 * Get all IANA timezone identifiers.
 * Falls back to a minimal list if Intl.supportedValuesOf is unavailable.
 */
export function getAvailableTimezones(): string[] {
  if (typeof Intl !== "undefined" && "supportedValuesOf" in Intl) {
    return (Intl as { supportedValuesOf: (key: string) => string[] }).supportedValuesOf("timeZone")
  }
  return ["UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Stockholm", "Asia/Tokyo"]
}

/**
 * Get the UTC offset string for a timezone (e.g., "UTC+1", "UTC-5").
 */
export function getUtcOffset(timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "shortOffset",
    })
    const parts = formatter.formatToParts(new Date())
    const offsetPart = parts.find((p) => p.type === "timeZoneName")
    if (offsetPart?.value) {
      const offset = offsetPart.value.replace("GMT", "UTC")
      return offset === "UTC" ? "UTC+0" : offset
    }
  } catch {
    // Invalid timezone
  }
  return "UTC+0"
}

/**
 * Format timezone for display: "Europe/Stockholm (UTC+1)"
 */
export function formatTimezoneLabel(timezone: string): string {
  const offset = getUtcOffset(timezone)
  const displayName = timezone.replace(/_/g, " ")
  return `${displayName} (${offset})`
}

interface TimezonePickerProps {
  value: string
  onChange: (timezone: string) => void
}

export function TimezonePicker({ value, onChange }: TimezonePickerProps) {
  const [open, setOpen] = useState(false)
  const detectedTimezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])
  const timezones = useMemo(() => getAvailableTimezones(), [])

  function handleSelect(selectedTimezone: string) {
    onChange(selectedTimezone)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between">
          <span className="truncate font-mono">{formatTimezoneLabel(value)}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start" onWheel={(e) => e.stopPropagation()}>
        <Command>
          <CommandInput placeholder="Search timezone..." />
          <CommandList>
            <CommandEmpty>No timezone found.</CommandEmpty>
            <CommandGroup>
              {detectedTimezone !== value && (
                <CommandItem
                  value={`device-${detectedTimezone}`}
                  onSelect={() => handleSelect(detectedTimezone)}
                  className="font-medium"
                >
                  <Check className={cn("mr-2 h-4 w-4", value === detectedTimezone ? "opacity-100" : "opacity-0")} />
                  <span className="font-mono">{formatTimezoneLabel(detectedTimezone)}</span>
                  <span className="ml-2 text-muted-foreground">(device)</span>
                </CommandItem>
              )}
              {timezones.map((tz) => (
                <CommandItem key={tz} value={tz} onSelect={() => handleSelect(tz)}>
                  <Check className={cn("mr-2 h-4 w-4", value === tz ? "opacity-100" : "opacity-0")} />
                  <span className="font-mono">{formatTimezoneLabel(tz)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
