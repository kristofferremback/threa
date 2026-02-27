import { useCallback, useEffect, useState } from "react"
import { api } from "@/api/client"

type PushPermission = NotificationPermission | "unsupported"

interface UsePushNotificationsResult {
  permission: PushPermission
  isSubscribed: boolean
  requestPermission: () => Promise<void>
}

function deriveDeviceKey(): string {
  // Match the backend's device key derivation: sha256(userAgent).slice(0, 16)
  // In the browser we use a simpler approach - hash the user agent string
  const ua = navigator.userAgent
  let hash = 0
  for (let i = 0; i < ua.length; i++) {
    const char = ua.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0 // Convert to 32-bit int
  }
  return Math.abs(hash).toString(16).padStart(8, "0")
}

async function getDeviceKey(): Promise<string> {
  // Use SubtleCrypto when available for consistency with backend's SHA-256
  if (crypto.subtle) {
    const encoder = new TextEncoder()
    const data = encoder.encode(navigator.userAgent)
    const hashBuffer = await crypto.subtle.digest("SHA-256", data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16)
  }
  return deriveDeviceKey()
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

  // Check existing subscription on mount
  useEffect(() => {
    if (permission !== "granted" || !workspaceId) return

    navigator.serviceWorker?.ready
      .then(async (registration) => {
        const existing = await registration.pushManager.getSubscription()
        if (existing) {
          setIsSubscribed(true)
        } else {
          await subscribe(registration)
        }
      })
      .catch((err) => {
        console.error("[Push] Failed to check subscription:", err)
      })
  }, [permission, workspaceId, subscribe])

  // Request permission and subscribe
  const requestPermission = useCallback(async () => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setPermission("unsupported")
      return
    }

    const result = await Notification.requestPermission()
    setPermission(result)

    if (result === "granted") {
      const registration = await navigator.serviceWorker.ready
      await subscribe(registration)
    }
  }, [subscribe])

  return { permission, isSubscribed, requestPermission }
}
