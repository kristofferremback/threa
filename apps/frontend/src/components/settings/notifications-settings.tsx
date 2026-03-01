import { useState } from "react"
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

function TestNotificationButton({ workspaceId }: { workspaceId: string }) {
  const [sent, setSent] = useState(false)

  async function sendTest() {
    const registration = await navigator.serviceWorker?.ready
    if (!registration) return

    await registration.showNotification("Test notification", {
      body: "If you can see this, push notifications are working!",
      icon: "/threa-logo-192.png",
      badge: "/threa-logo-192.png",
      tag: "threa-test",
      data: { workspaceId },
    })

    setSent(true)
    setTimeout(() => setSent(false), 3000)
  }

  return (
    <Button onClick={sendTest} variant="outline" size="sm">
      {sent ? "Sent!" : "Test"}
    </Button>
  )
}

function PushNotificationCard({ workspaceId }: { workspaceId: string }) {
  const { permission, isSubscribed, optedOut, pushDisabledOnServer, requestPermission, unsubscribe } =
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
            <div className="flex gap-2">
              <Button onClick={unsubscribe} variant="outline" size="sm">
                Disable push notifications
              </Button>
              <TestNotificationButton workspaceId={workspaceId} />
            </div>
          </div>
        )}
        {permission === "granted" && !isSubscribed && optedOut && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Push notifications are disabled for this device.</p>
            <Button onClick={requestPermission} variant="outline" size="sm">
              Enable push notifications
            </Button>
          </div>
        )}
        {permission === "granted" && !isSubscribed && !optedOut && pushDisabledOnServer && (
          <p className="text-sm text-muted-foreground">Push notifications are not available on this server.</p>
        )}
        {permission === "granted" && !isSubscribed && !optedOut && !pushDisabledOnServer && (
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
