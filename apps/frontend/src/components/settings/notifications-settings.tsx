import { useParams } from "react-router-dom"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Button } from "@/components/ui/button"
import { usePreferences } from "@/contexts"
import { usePushNotifications } from "@/hooks/use-push-notifications"
import { PREF_NOTIFICATION_LEVEL_OPTIONS, type PrefNotificationLevel } from "@threa/types"

const NOTIFICATION_LABELS: Record<PrefNotificationLevel, string> = {
  all: "All messages",
  mentions: "Mentions only",
  none: "None",
}

const NOTIFICATION_DESCRIPTIONS: Record<PrefNotificationLevel, string> = {
  all: "Get notified for all new messages",
  mentions: "Get notified for @mentions, DMs, and scratchpad messages",
  none: "Don't send any notifications",
}

function PushNotificationCard({ workspaceId }: { workspaceId: string }) {
  const { permission, isSubscribed, pushDisabledOnServer, requestPermission, unsubscribe } =
    usePushNotifications(workspaceId)

  if (permission === "unsupported") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Push Notifications</CardTitle>
          <CardDescription>Get notified even when you're away from the app</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Push notifications are not supported in this browser.</p>
        </CardContent>
      </Card>
    )
  }

  if (permission === "denied") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Push Notifications</CardTitle>
          <CardDescription>Get notified even when you're away from the app</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Push notifications are blocked. Enable them in your browser settings to receive notifications.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Push Notifications</CardTitle>
        <CardDescription>Get notified even when you're away from the app</CardDescription>
      </CardHeader>
      <CardContent>
        {permission === "default" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Enable push notifications to get notified when you receive messages and mentions.
            </p>
            <Button onClick={requestPermission} variant="outline" size="sm">
              Enable push notifications
            </Button>
          </div>
        )}
        {permission === "granted" && isSubscribed && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Push notifications are enabled for this device.</p>
            <Button onClick={unsubscribe} variant="outline" size="sm">
              Disable push notifications
            </Button>
          </div>
        )}
        {permission === "granted" && !isSubscribed && pushDisabledOnServer && (
          <p className="text-sm text-muted-foreground">Push notifications are not available on this server.</p>
        )}
        {permission === "granted" && !isSubscribed && !pushDisabledOnServer && (
          <p className="text-sm text-muted-foreground">Subscribing to push notifications...</p>
        )}
      </CardContent>
    </Card>
  )
}

export function NotificationsSettings() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
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
            onValueChange={(value) => updatePreference("notificationLevel", value as PrefNotificationLevel)}
            className="space-y-4"
          >
            {PREF_NOTIFICATION_LEVEL_OPTIONS.map((option) => (
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

      {workspaceId && <PushNotificationCard workspaceId={workspaceId} />}
    </div>
  )
}
