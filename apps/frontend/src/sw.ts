/// <reference lib="webworker" />
import { precacheAndRoute } from "workbox-precaching"
import { ActivityTypes } from "@threa/types"

declare const self: ServiceWorkerGlobalScope

// Precache app shell assets injected by vite-plugin-pwa
precacheAndRoute(self.__WB_MANIFEST)

// ============================================================================
// Service worker ↔ app message types (INV-33)
// ============================================================================

/** Posted to the focused window when user clicks a notification. */
const SW_MSG_NOTIFICATION_CLICK = "NOTIFICATION_CLICK"

/** Posted to all windows when the push subscription is rotated by the browser. */
const SW_MSG_SUBSCRIPTION_CHANGED = "PUSH_SUBSCRIPTION_CHANGED"

// ============================================================================
// Push notification handling
// ============================================================================

/** Structured push payload — display text is formatted here, not on the backend (INV-46). */
interface PushData {
  workspaceId?: string
  streamId?: string
  messageId?: string
  activityType?: string
  contentPreview?: string
  streamName?: string
}

function formatTitle(activityType: string | undefined): string {
  switch (activityType) {
    case ActivityTypes.MENTION:
      return "You were mentioned"
    case ActivityTypes.MESSAGE:
      return "New message"
    default:
      return "New activity"
  }
}

function formatBody(data: PushData): string {
  if (data.contentPreview) {
    return data.contentPreview
  }
  if (data.streamName) {
    return `Activity in ${data.streamName}`
  }
  return "You have new activity in Threa"
}

self.addEventListener("push", (event) => {
  if (!event.data) return

  let data: PushData
  try {
    const payload = event.data.json() as { data?: PushData }
    data = payload.data ?? {}
  } catch {
    // Fallback for malformed payloads
    data = {}
  }

  const title = formatTitle(data.activityType)
  const body = formatBody(data)

  const options: NotificationOptions = {
    body,
    icon: "/threa-logo-192.png",
    badge: "/threa-logo-192.png",
    data,
    tag: data.messageId ?? "threa-notification",
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

// ============================================================================
// Notification click — focus existing window or open new one
// ============================================================================

self.addEventListener("notificationclick", (event) => {
  event.notification.close()

  const data = event.notification.data as PushData | undefined
  let targetUrl = "/"

  if (data?.workspaceId && data?.streamId) {
    targetUrl = `/w/${data.workspaceId}/s/${data.streamId}`
  } else if (data?.workspaceId) {
    targetUrl = `/w/${data.workspaceId}`
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      // Focus an existing window if one is open
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus()
          client.postMessage({ type: SW_MSG_NOTIFICATION_CLICK, url: targetUrl })
          return
        }
      }
      // No existing window — open a new one
      await self.clients.openWindow(targetUrl)
    })
  )
})

// ============================================================================
// Re-subscribe on push subscription change
// ============================================================================

self.addEventListener("pushsubscriptionchange", (event) => {
  // The old subscription has been invalidated — re-subscribe with the same
  // applicationServerKey and POST the new subscription to the backend.
  // Note: this event is rare (key rotation, browser storage cleared).
  const evt = event as ExtendableEvent & {
    oldSubscription?: PushSubscription
    newSubscription?: PushSubscription
  }

  evt.waitUntil(
    (async () => {
      try {
        const oldSub = evt.oldSubscription
        const applicationServerKey = oldSub?.options.applicationServerKey
        if (!applicationServerKey && !evt.newSubscription) {
          // No VAPID key available and no new subscription provided — can't re-subscribe.
          // The hook will re-subscribe with the correct key on next app load.
          return
        }

        const newSub =
          evt.newSubscription ??
          (await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey,
          }))

        if (!newSub) return

        // Notify the frontend so it can re-register the new subscription with the backend.
        // The SW doesn't have workspace context, so the app handles the API call.
        const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true })

        if (clients.length === 0) {
          // No open windows — persist to IndexedDB so the app can sync on next load.
          // The usePushNotifications hook re-subscribes on mount anyway (idempotent upsert),
          // so a lost change event is recovered naturally when the user reopens the app.
          return
        }

        for (const client of clients) {
          client.postMessage({
            type: SW_MSG_SUBSCRIPTION_CHANGED,
            subscription: newSub.toJSON(),
          })
        }
      } catch {
        // Swallow error — the usePushNotifications hook will re-subscribe on next app load
      }
    })()
  )
})
