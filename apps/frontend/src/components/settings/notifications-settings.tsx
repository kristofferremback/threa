import { useState } from "react"
import { useParams } from "react-router-dom"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
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

const TEST_BUTTON_LABELS = { idle: "Test", sent: "Sent!", failed: "Failed" } as const

function TestNotificationButton({ workspaceId }: { workspaceId: string }) {
  const [label, setLabel] = useState<keyof typeof TEST_BUTTON_LABELS>("idle")

  async function sendTest() {
    try {
      const registration = await navigator.serviceWorker?.ready
      if (!registration) throw new Error("Service worker not available")

      await registration.showNotification("Test notification", {
        body: "If you can see this, push notifications are working!",
        icon: "/threa-logo-192.png",
        badge: "/threa-logo-192.png",
        tag: "threa-test",
        data: { workspaceId },
      })

      setLabel("sent")
    } catch (err) {
      console.error("[Push] Test notification failed:", err)
      setLabel("failed")
    } finally {
      setTimeout(() => setLabel("idle"), 3000)
    }
  }

  return (
    <Button onClick={sendTest} variant="outline" size="sm">
      {TEST_BUTTON_LABELS[label]}
    </Button>
  )
}

function PushNotificationSection({ workspaceId }: { workspaceId: string }) {
  const {
    permission,
    isSubscribed,
    status,
    error,
    optedOut,
    pushDisabledOnServer,
    requestPermission,
    unsubscribe,
    retry,
  } = usePushNotifications(workspaceId)

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">Push Notifications</h3>
        <p className="text-sm text-muted-foreground">Get notified even when you're away from the app</p>
      </div>
      {permission === "unsupported" && (
        <p className="text-sm text-muted-foreground">Push notifications are not supported in this browser.</p>
      )}
      {permission === "denied" && (
        <p className="text-sm text-muted-foreground">
          Push notifications are blocked. Enable them in your browser settings to receive notifications.
        </p>
      )}
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
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Push notifications are not available on this server.</p>
          <Button onClick={retry} variant="outline" size="sm">
            Check again
          </Button>
        </div>
      )}
      {permission === "granted" && !isSubscribed && !optedOut && !pushDisabledOnServer && status === "subscribing" && (
        <p className="text-sm text-muted-foreground">Subscribing to push notifications...</p>
      )}
      {permission === "granted" && !isSubscribed && !optedOut && !pushDisabledOnServer && status === "error" && (
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-sm text-destructive">Couldn't enable push notifications.</p>
            {error && (
              <p className="text-xs text-muted-foreground">
                {error.message}
                {error.code ? ` (${error.code})` : ""}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button onClick={retry} variant="outline" size="sm">
              Retry
            </Button>
            <Button onClick={unsubscribe} variant="ghost" size="sm">
              Stop trying for this device
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

export function NotificationsSettings() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { preferences, updatePreference } = usePreferences()

  const notificationLevel = preferences?.notificationLevel ?? "all"

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Notification Level</h3>
          <p className="text-sm text-muted-foreground">Choose when you want to be notified</p>
        </div>
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
      </section>

      {workspaceId && (
        <>
          <Separator />
          <PushNotificationSection workspaceId={workspaceId} />
        </>
      )}
    </div>
  )
}
