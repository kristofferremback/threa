import { useCallback, useEffect, useState } from "react"
import { api } from "@/api/client"

type PushPermission = NotificationPermission | "unsupported"

interface UsePushNotificationsResult {
  permission: PushPermission
  isSubscribed: boolean
  requestPermission: () => Promise<void>
}

async function getDeviceKey(): Promise<string> {
  // Must match backend's deriveDeviceKey: sha256(userAgent).hex().slice(0, 16)
  // crypto.subtle is always available in secure contexts (HTTPS + localhost)
  const encoder = new TextEncoder()
  const data = encoder.encode(navigator.userAgent)
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16)
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export function usePushNotifications(workspaceId: string | undefined): UsePushNotificationsResult {
  const [permission, setPermission] = useState<PushPermission>(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return "unsupported"
    return Notification.permission
  })
  const [isSubscribed, setIsSubscribed] = useState(false)

  // Subscribe to push notifications
  const subscribe = useCallback(
    async (registration: ServiceWorkerRegistration) => {
      if (!workspaceId) return

      try {
        const { vapidPublicKey } = await api.get<{ vapidPublicKey: string }>(
          `/api/workspaces/${workspaceId}/push/vapid-key`
        )

        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer,
        })

        const key = subscription.getKey("p256dh")
        const auth = subscription.getKey("auth")
        if (!key || !auth) return

        const deviceKey = await getDeviceKey()

        await api.post(`/api/workspaces/${workspaceId}/push/subscribe`, {
          endpoint: subscription.endpoint,
          p256dh: btoa(String.fromCharCode(...new Uint8Array(key))),
          auth: btoa(String.fromCharCode(...new Uint8Array(auth))),
          deviceKey,
          userAgent: navigator.userAgent,
        })

        setIsSubscribed(true)
      } catch (err) {
        console.error("[Push] Failed to subscribe:", err)
      }
    },
    [workspaceId]
  )

  // Ensure subscription is registered with backend on mount (idempotent upsert)
  useEffect(() => {
    if (permission !== "granted" || !workspaceId) return

    const doSubscribe = () => {
      navigator.serviceWorker?.ready
        .then(async (registration) => {
          // Always call subscribe — it upserts on the backend, so it handles both
          // new subscriptions and re-registering after pushsubscriptionchange events.
          await subscribe(registration)
        })
        .catch((err) => {
          console.error("[Push] Failed to check subscription:", err)
        })
    }

    doSubscribe()

    // Re-register when the SW notifies us of a subscription change (avoids full page reload)
    const handleSubscriptionChange = () => doSubscribe()
    window.addEventListener("pushsubscriptionchanged", handleSubscriptionChange)
    return () => window.removeEventListener("pushsubscriptionchanged", handleSubscriptionChange)
  }, [permission, workspaceId, subscribe])

  // Request permission and subscribe
  const requestPermission = useCallback(async () => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setPermission("unsupported")
      return
    }

    try {
      const result = await Notification.requestPermission()
      setPermission(result)

      if (result === "granted") {
        const registration = await navigator.serviceWorker.ready
        await subscribe(registration)
      }
    } catch (err) {
      console.error("[Push] Failed to request permission:", err)
    }
  }, [subscribe])

  return { permission, isSubscribed, requestPermission }
}
