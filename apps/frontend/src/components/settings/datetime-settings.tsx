import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { TimezonePicker } from "@/components/ui/timezone-picker"
import { usePreferences } from "@/contexts"
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

export function DateTimeSettings() {
  const { preferences, updatePreference } = usePreferences()

  const dateFormat = preferences?.dateFormat ?? "YYYY-MM-DD"
  const timeFormat = preferences?.timeFormat ?? "24h"
  const timezone = preferences?.timezone ?? "UTC"
  const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone

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
            <TimezonePicker value={timezone} onChange={(tz) => updatePreference("timezone", tz)} />
          </div>

          <p className="text-sm text-muted-foreground">
            Your device is set to <span className="font-mono">{detectedTimezone}</span>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
