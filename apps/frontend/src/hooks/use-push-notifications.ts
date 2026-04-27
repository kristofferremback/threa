import { useCallback, useEffect, useRef, useState } from "react"
import { DEVICE_KEY_LENGTH } from "@threa/types"
import { ApiError, api } from "@/api/client"

type PushPermission = NotificationPermission | "unsupported"

/**
 * Lifecycle of the workspace's push subscription:
 * - `idle`        → not currently working; either pre-permission, opted-out, or disabled-on-server
 * - `subscribing` → actively negotiating with browser + backend
 * - `subscribed`  → browser registration confirmed and backend record stored
 * - `error`       → last attempt failed; `error` field carries diagnostics; `retry()` to try again
 */
type SubscriptionStatus = "idle" | "subscribing" | "subscribed" | "error"

interface PushSubscriptionError {
  message: string
  code?: string
  status?: number
}

interface VapidConfig {
  vapidPublicKey: string | null
  enabled: boolean
}

interface UsePushNotificationsResult {
  permission: PushPermission
  isSubscribed: boolean
  status: SubscriptionStatus
  error: PushSubscriptionError | null
  /** True when the user has explicitly opted out of push for this workspace. */
  optedOut: boolean
  /** True when push is disabled on the backend (no VAPID keys configured). */
  pushDisabledOnServer: boolean
  requestPermission: () => Promise<void>
  unsubscribe: () => Promise<void>
  /** Retry the subscription flow after a transient failure. */
  retry: () => Promise<void>
}

/** Hard cap on the subscribe round-trip so a hung fetch never strands the UI in "subscribing". */
const SUBSCRIBE_TIMEOUT_MS = 15_000

class SubscribeTimeoutError extends Error {
  constructor() {
    super("Timed out while subscribing to push notifications")
    this.name = "SubscribeTimeoutError"
  }
}

function toSubscriptionError(err: unknown): PushSubscriptionError {
  if (ApiError.isApiError(err)) {
    return { message: err.message, code: err.code, status: err.status }
  }
  if (err instanceof SubscribeTimeoutError) {
    return { message: err.message, code: "TIMEOUT" }
  }
  if (err instanceof DOMException) {
    return { message: err.message || err.name, code: err.name }
  }
  if (err instanceof Error) {
    return { message: err.message }
  }
  return { message: "Unknown error while subscribing to push notifications" }
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

type SubscribeOutcome = { kind: "subscribed" } | { kind: "disabled-on-server" }

/**
 * Runs the full subscribe handshake: fetch VAPID config, reconcile the browser
 * subscription, and register it with the backend. Pure flow — all state
 * transitions live in the caller.
 */
async function runSubscribeFlow(
  workspaceId: string,
  registration: ServiceWorkerRegistration,
  vapidCacheRef: React.MutableRefObject<{ workspaceId: string; config: VapidConfig } | null>
): Promise<SubscribeOutcome> {
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
    return { kind: "disabled-on-server" }
  }

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
  if (!json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("Browser returned a push subscription without encryption keys")
  }

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

  return { kind: "subscribed" }
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
  const [status, setStatus] = useState<SubscriptionStatus>("idle")
  const [error, setError] = useState<PushSubscriptionError | null>(null)
  const vapidCacheRef = useRef<{ workspaceId: string; config: VapidConfig } | null>(null)

  // Re-sync opt-out state when workspaceId changes (initializer only runs on mount)
  useEffect(() => {
    setOptedOut(workspaceId ? localStorage.getItem(pushOptOutKey(workspaceId)) === "1" : false)
  }, [workspaceId])

  // Subscribe to push notifications. Owns the full flow including waiting for
  // the service worker to be ready, so a hung SW activation is covered by the
  // same 15s timeout as the subscribe handshake itself.
  const subscribe = useCallback(async () => {
    if (!workspaceId) return

    setStatus("subscribing")
    setError(null)

    // Hard timeout — covers both the serviceWorker.ready wait and the
    // subscribe handshake. Without this, a never-resolving SW activation
    // (mobile Firefox on a fresh domain, blocked SW install, etc.) leaves
    // the UI in "subscribing" forever.
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new SubscribeTimeoutError()), SUBSCRIBE_TIMEOUT_MS)
    })

    try {
      const result = await Promise.race([
        (async () => {
          if (!("serviceWorker" in navigator)) {
            throw new Error("Service workers are not available in this browser")
          }
          const registration = await navigator.serviceWorker.ready
          return runSubscribeFlow(workspaceId, registration, vapidCacheRef)
        })(),
        timeoutPromise,
      ])

      if (result.kind === "disabled-on-server") {
        setIsSubscribed(false)
        setPushDisabledOnServer(true)
        setStatus("idle")
        return
      }

      setPushDisabledOnServer(false)
      setIsSubscribed(true)
      setStatus("subscribed")
    } catch (err) {
      console.error("[Push] Failed to subscribe:", err)
      setIsSubscribed(false)
      setError(toSubscriptionError(err))
      setStatus("error")
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
    }
  }, [workspaceId])

  // Reset subscription state when permission is revoked or workspaceId changes
  useEffect(() => {
    if (permission !== "granted" || !workspaceId) {
      setIsSubscribed(false)
      setStatus("idle")
      setError(null)
    }
  }, [permission, workspaceId])

  // Ensure subscription is registered with backend on mount (idempotent upsert).
  // Skipped if user has explicitly opted out for this workspace.
  useEffect(() => {
    if (permission !== "granted" || !workspaceId || optedOut) return

    // subscribe() owns the SW-ready wait and timeout, so callers don't need
    // to gate on it themselves — they just kick off the flow.
    void subscribe()

    // Re-register when the SW notifies us of a subscription change (avoids full page reload)
    const handleSubscriptionChange = () => {
      void subscribe()
    }
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
      setStatus("idle")
      setError(null)

      // Persist opt-out so auto-subscribe doesn't re-register on next mount
      setOptedOut(true)
      localStorage.setItem(pushOptOutKey(workspaceId), "1")
    } catch (err) {
      // Failure surfaces only to the console — the "subscribed" UI doesn't
      // render the error field, so setting it would just leak stale state
      // into the next mount. If users hit this, a follow-up should add a
      // toast (sonner is already wired in).
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
        await subscribe()
      }
    } catch (err) {
      console.error("[Push] Failed to request permission:", err)
      setError(toSubscriptionError(err))
      setStatus("error")
    }
  }, [subscribe, workspaceId])

  // Manually retry the subscription flow after a failure. Clears the cached VAPID
  // config so a server config change (e.g. push enabled after env vars added) is
  // picked up without a full reload.
  const retry = useCallback(async () => {
    if (!workspaceId) return
    vapidCacheRef.current = null
    setPushDisabledOnServer(false)
    await subscribe()
  }, [subscribe, workspaceId])

  return {
    permission,
    isSubscribed,
    status,
    error,
    optedOut,
    pushDisabledOnServer,
    requestPermission,
    unsubscribe,
    retry,
  }
}
