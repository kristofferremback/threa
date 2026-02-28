import { useCallback, useEffect, useRef, useState } from "react"
import { DEVICE_KEY_LENGTH } from "@threa/types"
import { api } from "@/api/client"

type PushPermission = NotificationPermission | "unsupported"

interface VapidConfig {
  vapidPublicKey: string | null
  enabled: boolean
}

interface UsePushNotificationsResult {
  permission: PushPermission
  isSubscribed: boolean
  /** True when push is disabled on the backend (no VAPID keys configured). */
  pushDisabledOnServer: boolean
  requestPermission: () => Promise<void>
}

/**
 * Derives a device key from user-agent.
 * Algorithm contract documented in @threa/types (DEVICE_KEY_LENGTH).
 * Must match backend's deriveDeviceKey (socket.ts).
 */
async function getDeviceKey(): Promise<string> {
  // crypto.subtle is always available in secure contexts (HTTPS + localhost)
  const encoder = new TextEncoder()
  const data = encoder.encode(navigator.userAgent)
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, DEVICE_KEY_LENGTH)
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
  const [pushDisabledOnServer, setPushDisabledOnServer] = useState(false)
  const vapidCacheRef = useRef<{ workspaceId: string; config: VapidConfig } | null>(null)

  // Subscribe to push notifications
  const subscribe = useCallback(
    async (registration: ServiceWorkerRegistration) => {
      if (!workspaceId) return

      try {
        // Cache VAPID config per workspace to avoid redundant fetches (key doesn't change)
        let vapidPublicKey: string | null
        let enabled: boolean
        if (vapidCacheRef.current?.workspaceId === workspaceId) {
          ;({ vapidPublicKey, enabled } = vapidCacheRef.current.config)
        } else {
          const config = await api.get<VapidConfig>(`/api/workspaces/${workspaceId}/push/vapid-key`)
          vapidCacheRef.current = { workspaceId, config }
          ;({ vapidPublicKey, enabled } = config)
        }

        if (!enabled || !vapidPublicKey) {
          setIsSubscribed(false)
          setPushDisabledOnServer(true)
          return
        }
        setPushDisabledOnServer(false)

        // Reuse existing browser subscription if available to avoid redundant push service round-trips.
        // Only call pushManager.subscribe() when no subscription exists (first-time or after revocation).
        const existing = await registration.pushManager.getSubscription()
        const subscription =
          existing ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer,
          }))

        const key = subscription.getKey("p256dh")
        const auth = subscription.getKey("auth")
        if (!key || !auth) return

        const deviceKey = await getDeviceKey()

        // Backend upsert (ON CONFLICT DO UPDATE) — idempotent for re-registrations
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

  // Reset subscription state when permission is revoked or workspaceId changes
  useEffect(() => {
    if (permission !== "granted" || !workspaceId) {
      setIsSubscribed(false)
    }
  }, [permission, workspaceId])

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

  return { permission, isSubscribed, pushDisabledOnServer, requestPermission }
}
