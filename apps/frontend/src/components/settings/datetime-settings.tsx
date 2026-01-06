import { useMemo, useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { usePreferences } from "@/contexts"
import { cn } from "@/lib/utils"
import { DATE_FORMAT_OPTIONS, TIME_FORMAT_OPTIONS, type DateFormat, type TimeFormat } from "@threa/types"

const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  "YYYY-MM-DD": "2025-01-15 (ISO)",
  "DD/MM/YYYY": "15/01/2025 (European)",
  "MM/DD/YYYY": "01/15/2025 (US)",
}

const TIME_FORMAT_LABELS: Record<TimeFormat, string> = {
  "24h": "14:30 (24-hour)",
  "12h": "2:30 PM (12-hour)",
}

/**
 * Get all IANA timezone identifiers.
 * Falls back to a minimal list if Intl.supportedValuesOf is unavailable.
 */
function getAvailableTimezones(): string[] {
  if (typeof Intl !== "undefined" && "supportedValuesOf" in Intl) {
    return (Intl as { supportedValuesOf: (key: string) => string[] }).supportedValuesOf("timeZone")
  }
  // Fallback for older browsers
  return ["UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Stockholm", "Asia/Tokyo"]
}

/**
 * Get the UTC offset string for a timezone (e.g., "UTC+1", "UTC-5").
 */
function getUtcOffset(timezone: string): string {
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
function formatTimezoneLabel(timezone: string): string {
  const offset = getUtcOffset(timezone)
  const displayName = timezone.replace(/_/g, " ")
  return `${displayName} (${offset})`
}

export function DateTimeSettings() {
  const { preferences, updatePreference } = usePreferences()
  const [timezoneOpen, setTimezoneOpen] = useState(false)

  const dateFormat = preferences?.dateFormat ?? "YYYY-MM-DD"
  const timeFormat = preferences?.timeFormat ?? "24h"
  const timezone = preferences?.timezone ?? "UTC"
  const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  const timezones = useMemo(() => getAvailableTimezones(), [])

  function handleTimezoneSelect(selectedTimezone: string) {
    updatePreference("timezone", selectedTimezone)
    setTimezoneOpen(false)
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Date Format</CardTitle>
          <CardDescription>Choose how dates are displayed</CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={dateFormat}
            onValueChange={(value) => updatePreference("dateFormat", value as DateFormat)}
            className="space-y-3"
          >
            {DATE_FORMAT_OPTIONS.map((option) => (
              <div key={option} className="flex items-center space-x-3">
                <RadioGroupItem value={option} id={`date-${option}`} />
                <Label htmlFor={`date-${option}`} className="cursor-pointer font-mono">
                  {DATE_FORMAT_LABELS[option]}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Time Format</CardTitle>
          <CardDescription>Choose how times are displayed</CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={timeFormat}
            onValueChange={(value) => updatePreference("timeFormat", value as TimeFormat)}
            className="space-y-3"
          >
            {TIME_FORMAT_OPTIONS.map((option) => (
              <div key={option} className="flex items-center space-x-3">
                <RadioGroupItem value={option} id={`time-${option}`} />
                <Label htmlFor={`time-${option}`} className="cursor-pointer font-mono">
                  {TIME_FORMAT_LABELS[option]}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Home Timezone</CardTitle>
          <CardDescription>
            Your home timezone is shown to colleagues and used for time-aware features. Times in the UI are displayed in
            your device's local timezone.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Timezone</Label>
            <Popover open={timezoneOpen} onOpenChange={setTimezoneOpen} modal={false}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={timezoneOpen}
                  className="w-full justify-between"
                >
                  <span className="truncate font-mono">{formatTimezoneLabel(timezone)}</span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[400px] p-0" align="start" onWheel={(e) => e.stopPropagation()}>
                <Command>
                  <CommandInput placeholder="Search timezone..." />
                  <CommandList>
                    <CommandEmpty>No timezone found.</CommandEmpty>
                    <CommandGroup>
                      {detectedTimezone !== timezone && (
                        <CommandItem
                          value={`device-${detectedTimezone}`}
                          onSelect={() => handleTimezoneSelect(detectedTimezone)}
                          className="font-medium"
                        >
                          <Check
                            className={cn("mr-2 h-4 w-4", timezone === detectedTimezone ? "opacity-100" : "opacity-0")}
                          />
                          <span className="font-mono">{formatTimezoneLabel(detectedTimezone)}</span>
                          <span className="ml-2 text-muted-foreground">(device)</span>
                        </CommandItem>
                      )}
                      {timezones.map((tz) => (
                        <CommandItem key={tz} value={tz} onSelect={() => handleTimezoneSelect(tz)}>
                          <Check className={cn("mr-2 h-4 w-4", timezone === tz ? "opacity-100" : "opacity-0")} />
                          <span className="font-mono">{formatTimezoneLabel(tz)}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <p className="text-sm text-muted-foreground">
            Your device is set to <span className="font-mono">{detectedTimezone}</span>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
