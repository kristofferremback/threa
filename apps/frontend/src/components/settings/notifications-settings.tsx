import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { usePreferences } from "@/contexts"
import { NOTIFICATION_LEVEL_OPTIONS, type NotificationLevel } from "@threa/types"

const NOTIFICATION_LABELS: Record<NotificationLevel, string> = {
  all: "All messages",
  mentions: "Mentions only",
  none: "None",
}

const NOTIFICATION_DESCRIPTIONS: Record<NotificationLevel, string> = {
  all: "Get notified for all new messages",
  mentions: "Only get notified when you're @mentioned",
  none: "Don't send any notifications",
}

export function NotificationsSettings() {
  const { preferences, updatePreference } = usePreferences()

  const notificationLevel = preferences?.notificationLevel ?? "all"

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Notification Level</CardTitle>
          <CardDescription>Choose when you want to be notified</CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={notificationLevel}
            onValueChange={(value) => updatePreference("notificationLevel", value as NotificationLevel)}
            className="space-y-4"
          >
            {NOTIFICATION_LEVEL_OPTIONS.map((option) => (
              <div key={option} className="flex items-start space-x-3">
                <RadioGroupItem value={option} id={`notify-${option}`} className="mt-1" />
                <div className="grid gap-1">
                  <Label htmlFor={`notify-${option}`} className="cursor-pointer">
                    {NOTIFICATION_LABELS[option]}
                  </Label>
                  <p className="text-sm text-muted-foreground">{NOTIFICATION_DESCRIPTIONS[option]}</p>
                </div>
              </div>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Coming Soon</CardTitle>
          <CardDescription>More notification settings are on the way</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Per-stream notification overrides, quiet hours, and sound preferences will be available in a future update.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
