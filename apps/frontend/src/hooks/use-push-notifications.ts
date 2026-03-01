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
  /** True when the user has explicitly opted out of push for this workspace. */
  optedOut: boolean
  /** True when push is disabled on the backend (no VAPID keys configured). */
  pushDisabledOnServer: boolean
  requestPermission: () => Promise<void>
  unsubscribe: () => Promise<void>
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

function arrayBuffersEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false
  const viewA = new Uint8Array(a)
  const viewB = new Uint8Array(b)
  for (let i = 0; i < viewA.length; i++) {
    if (viewA[i] !== viewB[i]) return false
  }
  return true
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

function pushOptOutKey(workspaceId: string): string {
  return `threa:push-opted-out:${workspaceId}`
}

export function usePushNotifications(workspaceId: string | undefined): UsePushNotificationsResult {
  const [permission, setPermission] = useState<PushPermission>(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return "unsupported"
    return Notification.permission
  })
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [optedOut, setOptedOut] = useState(() =>
    workspaceId ? localStorage.getItem(pushOptOutKey(workspaceId)) === "1" : false
  )
  const [pushDisabledOnServer, setPushDisabledOnServer] = useState(false)
  const vapidCacheRef = useRef<{ workspaceId: string; config: VapidConfig } | null>(null)

  // Re-sync opt-out state when workspaceId changes (initializer only runs on mount)
  useEffect(() => {
    setOptedOut(workspaceId ? localStorage.getItem(pushOptOutKey(workspaceId)) === "1" : false)
  }, [workspaceId])

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

        // Reuse existing browser subscription if its VAPID key matches the server's.
        // If VAPID keys were rotated, unsubscribe the stale one and create a fresh subscription.
        const expectedKey = urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer
        let existing = await registration.pushManager.getSubscription()
        if (existing) {
          const existingKey = existing.options.applicationServerKey
          if (!existingKey || !arrayBuffersEqual(existingKey, expectedKey)) {
            await existing.unsubscribe()
            existing = null
          }
        }
        const subscription =
          existing ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: expectedKey,
          }))

        const json = subscription.toJSON()
        if (!json.keys?.p256dh || !json.keys?.auth) return

        const deviceKey = await getDeviceKey()

        // Backend upsert (ON CONFLICT DO UPDATE) — idempotent for re-registrations
        // toJSON().keys returns base64url encoding, matching web-push library's contract
        await api.post(`/api/workspaces/${workspaceId}/push/subscribe`, {
          endpoint: subscription.endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
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

  // Ensure subscription is registered with backend on mount (idempotent upsert).
  // Skipped if user has explicitly opted out for this workspace.
  useEffect(() => {
    if (permission !== "granted" || !workspaceId || optedOut) return

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
  }, [permission, workspaceId, subscribe, optedOut])

  // Unsubscribe from push notifications for this workspace.
  // Only removes the backend record — the browser subscription stays alive
  // so other workspaces sharing the same origin keep receiving push.
  const unsubscribe = useCallback(async () => {
    if (!workspaceId) return

    try {
      const registration = await navigator.serviceWorker?.ready
      if (!registration) return

      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        await api.post(`/api/workspaces/${workspaceId}/push/unsubscribe`, {
          endpoint: subscription.endpoint,
        })
      }

      setIsSubscribed(false)

      // Persist opt-out so auto-subscribe doesn't re-register on next mount
      setOptedOut(true)
      localStorage.setItem(pushOptOutKey(workspaceId), "1")
    } catch (err) {
      console.error("[Push] Failed to unsubscribe:", err)
    }
  }, [workspaceId])

  // Request permission and subscribe
  const requestPermission = useCallback(async () => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setPermission("unsupported")
      return
    }

    try {
      // Clear opt-out — user is explicitly re-enabling
      if (workspaceId) {
        setOptedOut(false)
        localStorage.removeItem(pushOptOutKey(workspaceId))
      }

      const result = await Notification.requestPermission()
      setPermission(result)

      if (result === "granted") {
        const registration = await navigator.serviceWorker.ready
        await subscribe(registration)
      }
    } catch (err) {
      console.error("[Push] Failed to request permission:", err)
    }
  }, [subscribe, workspaceId])

  return { permission, isSubscribed, optedOut, pushDisabledOnServer, requestPermission, unsubscribe }
}
