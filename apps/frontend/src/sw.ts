/// <reference lib="webworker" />
import { precacheAndRoute } from "workbox-precaching"

declare const self: ServiceWorkerGlobalScope

// Precache app shell assets injected by vite-plugin-pwa
precacheAndRoute(self.__WB_MANIFEST)

// ============================================================================
// Push notification handling
// ============================================================================

interface PushPayload {
  title: string
  body: string
  data?: {
    workspaceId?: string
    streamId?: string
    messageId?: string
    activityType?: string
  }
}

self.addEventListener("push", (event) => {
  if (!event.data) return

  let payload: PushPayload
  try {
    payload = event.data.json() as PushPayload
  } catch {
    payload = { title: "Threa", body: event.data.text() }
  }

  const options: NotificationOptions = {
    body: payload.body,
    icon: "/threa-logo-192.png",
    badge: "/threa-logo-192.png",
    data: payload.data,
    tag: payload.data?.messageId ?? "threa-notification",
  }

  event.waitUntil(self.registration.showNotification(payload.title, options))
})

// ============================================================================
// Notification click — focus existing window or open new one
// ============================================================================

self.addEventListener("notificationclick", (event) => {
  event.notification.close()

  const data = event.notification.data as PushPayload["data"]
  let targetUrl = "/"

  if (data?.workspaceId && data?.streamId) {
    targetUrl = `/${data.workspaceId}/${data.streamId}`
  } else if (data?.workspaceId) {
    targetUrl = `/${data.workspaceId}`
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Focus an existing window if one is open
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin) {
          client.focus()
          client.navigate(targetUrl)
          return
        }
      }
      // Open a new window
      return self.clients.openWindow(targetUrl)
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
        const newSub =
          evt.newSubscription ??
          (await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: oldSub?.options.applicationServerKey ?? undefined,
          }))

        if (!newSub) return

        // We don't have workspace context in the SW, so we POST to a well-known
        // endpoint and the backend resolves workspace from the old endpoint.
        // For now, log and let the frontend re-subscribe on next load.
        console.log("[SW] Push subscription changed, new subscription:", newSub.endpoint)
      } catch (err) {
        console.error("[SW] Failed to handle push subscription change:", err)
      }
    })()
  )
})
