/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching"
import { AuthorTypes, type LastMessagePreview, type StreamEvent } from "@threa/types"
import { resolveTag } from "./lib/sw-notification-format"
import {
  SW_MSG_NOTIFICATION_CLICK,
  SW_MSG_SUBSCRIPTION_CHANGED,
  SW_MSG_CLEAR_NOTIFICATIONS,
  SHARE_TARGET_CACHE,
} from "./lib/sw-messages"

declare const self: ServiceWorkerGlobalScope

/** Extend NotificationOptions with properties supported by browsers but missing from TS lib types. */
interface ExtendedNotificationOptions extends NotificationOptions {
  /** Re-alert the user (vibrate/sound) when replacing an existing notification with the same tag. */
  renotify?: boolean
}

// Activate new service worker immediately so users get fresh code
// without needing to close all tabs.
self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Clean stale caches from previous SW versions. Keep only the current
      // workbox precache, push-bootstrap, and share-target caches. Without this,
      // old precache buckets linger and can serve stale HTML/CSS after an update.
      const currentCaches = new Set([PUSH_BOOTSTRAP_CACHE, SHARE_TARGET_CACHE])
      const allCaches = await caches.keys()
      await Promise.all(
        allCaches
          .filter((name) => !currentCaches.has(name) && !name.startsWith("workbox-precache-"))
          .map((name) => caches.delete(name))
      )
      await self.clients.claim()
    })()
  )
})

// Remove old precache entries from previous SW versions that no longer
// match the current manifest. Without this, stale revision-keyed entries
// linger and consume storage quota.
cleanupOutdatedCaches()

// Network-first for navigation requests. This is the critical fix for the
// "unstyled page" bug: workbox's precacheAndRoute uses cache-first for
// everything, including index.html. When a new build deploys with different
// asset filenames, a stale precache serves old HTML that references old
// CSS/JS filenames which no longer exist on the server — resulting in 404s
// and an unstyled page. By handling navigations network-first, users always
// get the latest HTML with correct asset references. The precache still
// serves as an offline fallback.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return

  event.respondWith(
    fetch(event.request).catch(async () => {
      // Offline: fall back to precached HTML
      const cached = await caches.match(event.request)
      if (cached) return cached
      // Last resort: try precached index.html for SPA routing
      const fallback = await caches.match("/index.html")
      if (fallback) return fallback
      return Response.error()
    })
  )
})

// Prevent a failed precache fetch (network error, CDN blip, mixed content
// rejection) from blocking service worker activation. precacheAndRoute adds
// its own install listener below that calls event.waitUntil() with a fetch
// promise — if any asset fails to fetch, the entire SW install is rejected
// and the SW never activates (navigator.serviceWorker.ready hangs forever).
//
// This listener runs before precacheAndRoute's internal handler and wraps
// event.waitUntil so the precache rejection is caught and activation proceeds.
// Offline precache is best-effort; the network-first navigation handler
// serves as fallback for any uncached assets.
self.addEventListener("install", (event) => {
  const orig = event.waitUntil.bind(event)
  ;(event as any).waitUntil = (promise: Promise<any>) => {
    orig(
      promise.catch((err: unknown) => {
        console.warn("[SW] Precache install failed, activating anyway:", err)
      })
    )
  }
})

// Precache app shell assets injected by vite-plugin-pwa.
precacheAndRoute(self.__WB_MANIFEST)

// ============================================================================
// Push bootstrap pre-fetch — cache stream data so it's instant on notification tap
// ============================================================================

/** Cache name for pre-fetched bootstrap responses triggered by push notifications. */
const PUSH_BOOTSTRAP_CACHE = "push-bootstrap"

/** Regex matching stream bootstrap API paths. */
const BOOTSTRAP_PATH_RE = /^\/api\/workspaces\/[^/]+\/streams\/[^/]+\/bootstrap$/

/**
 * Pre-fetch events around a specific message so it's available in IDB
 * when the user taps the push notification. Best-effort.
 */
async function prefetchEventsAround(workspaceId: string, streamId: string, messageId: string): Promise<void> {
  try {
    const url = `/api/workspaces/${workspaceId}/streams/${streamId}/events/around?messageId=${messageId}&limit=30`
    const response = await fetch(url, { credentials: "include" })
    if (!response.ok) return

    const body = await response.json()
    const data = body.data ?? body
    if (data?.events?.length > 0) {
      const now = Date.now()
      const { db, sequenceToNum } = await import("./db/database")
      await db.events.bulkPut(
        data.events.map((e: Record<string, unknown>) => ({
          ...e,
          workspaceId,
          _sequenceNum: sequenceToNum(e.sequence as string),
          _cachedAt: now,
        }))
      )
    }
  } catch {
    // Best-effort
  }
}

async function prefetchStreamBootstrap(workspaceId: string, streamId: string): Promise<void> {
  const url = `/api/workspaces/${workspaceId}/streams/${streamId}/bootstrap`
  const response = await fetch(url, { credentials: "include" })
  if (!response.ok) return

  // Clone before consuming body — Cache API and IDB write need separate copies
  const cacheResponse = response.clone()
  const cache = await caches.open(PUSH_BOOTSTRAP_CACHE)
  await cache.put(url, cacheResponse)

  // Write events to IndexedDB so useLiveQuery renders them instantly when the
  // user taps the notification. Best-effort: errors are swallowed.
  try {
    const body = await response.json()
    const bootstrap = body.data ?? body
    if (!bootstrap?.events?.length) return

    const now = Date.now()
    // Dynamic import to avoid bundling Dexie into the SW critical path.
    // The SW shares the same origin and IndexedDB database as the main thread.
    const { db, sequenceToNum } = await import("./db/database")

    const events: StreamEvent[] = bootstrap.events
    const latestMessageEvent = findLatestMessageEvent(events)
    const derivedPreview = latestMessageEvent ? buildPreviewFromEvent(latestMessageEvent) : null

    // The stream bootstrap endpoint returns a plain Stream without
    // lastMessagePreview — a blind put would wipe the sidebar preview and
    // sink the stream into "Other". Merge via update() so lastMessagePreview
    // and membership-derived fields (pinned, notificationLevel,
    // lastReadEventId) from applyWorkspaceBootstrap survive.
    await db.transaction("rw", [db.events, db.streams], async () => {
      await db.events.bulkPut(
        events.map((e) => ({
          ...e,
          workspaceId,
          _sequenceNum: sequenceToNum(e.sequence),
          _cachedAt: now,
        }))
      )

      if (!bootstrap.stream) return

      const patch: { _cachedAt: number; lastMessagePreview?: LastMessagePreview } = { _cachedAt: now }
      if (derivedPreview) patch.lastMessagePreview = derivedPreview

      const updated = await db.streams.update(bootstrap.stream.id, patch)
      if (updated === 0) {
        await db.streams.put({ ...bootstrap.stream, ...patch })
      }
    })
  } catch {
    // Best-effort — normal fetch path takes over if this fails
  }
}

/** Find the most recent message_created event. Bootstrap events are ordered oldest → newest. */
function findLatestMessageEvent(events: StreamEvent[]): StreamEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].eventType === "message_created") return events[i]
  }
  return null
}

function buildPreviewFromEvent(event: StreamEvent): LastMessagePreview {
  const payload = (event.payload ?? {}) as { contentJson?: unknown; contentMarkdown?: string }
  return {
    authorId: event.actorId ?? "",
    authorType: event.actorType ?? AuthorTypes.USER,
    // Sidebar's truncateContent accepts either JSONContent or a markdown string.
    content: (payload.contentJson ?? payload.contentMarkdown ?? "") as string,
    createdAt: event.createdAt,
  }
}

// ============================================================================
// Share Target POST interception — stash files + text for the app to read
// ============================================================================

/**
 * When the OS shares content to Threa (Web Share Target API), the browser sends
 * a POST with multipart/form-data to /share. The SW intercepts this, stashes
 * the form data (text fields + files) into the Cache API, and responds with a
 * redirect to the GET /share page where the app picks it up.
 */
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)
  if (url.pathname !== "/share" || event.request.method !== "POST") return

  event.respondWith(
    (async () => {
      try {
        const formData = await event.request.formData()
        const title = formData.get("title") as string | null
        const text = formData.get("text") as string | null
        const sharedUrl = formData.get("url") as string | null
        const files = formData.getAll("files") as File[]

        const cache = await caches.open(SHARE_TARGET_CACHE)

        // Clear any previous share data
        const keys = await cache.keys()
        for (const key of keys) await cache.delete(key)

        // Store files first so fileCount in meta is always accurate —
        // if a file write fails mid-loop, meta records only the files
        // that were actually persisted.
        let storedFileCount = 0
        for (let i = 0; i < files.length; i++) {
          await cache.put(
            new Request(`/_share/file/${i}`),
            new Response(files[i], {
              headers: {
                "Content-Type": files[i].type,
                "X-Filename": encodeURIComponent(files[i].name),
                "X-Size": String(files[i].size),
              },
            })
          )
          storedFileCount++
        }

        // Store metadata last — fileCount reflects only successfully stored files
        await cache.put(
          new Request("/_share/meta"),
          new Response(JSON.stringify({ title, text, url: sharedUrl, fileCount: storedFileCount }))
        )
      } catch {
        // Best-effort — if stashing fails, the redirect still lands on /share
        // and the user sees the normal share picker (just without pre-populated content).
      }

      return Response.redirect("/share", 303)
    })()
  )
})

/**
 * Fetch interceptor: serve pre-fetched bootstrap responses from the push cache.
 * Entries are one-shot — deleted after being served so subsequent fetches hit the network.
 *
 * Uses a regex guard (not an in-memory Set) because mobile browsers terminate
 * the SW between push receipt and notification tap — any in-memory state would
 * be lost, orphaning the cache entry. The Cache API is persistent and is the
 * sole source of truth. The per-request cost of a regex test + async cache miss
 * is sub-millisecond — negligible compared to the network round-trip it replaces
 * on a cache hit.
 */
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)
  if (!BOOTSTRAP_PATH_RE.test(url.pathname)) return

  event.respondWith(
    (async () => {
      const cache = await caches.open(PUSH_BOOTSTRAP_CACHE)
      const cached = await cache.match(event.request.url)
      if (cached) {
        // One-shot: serve and delete so the next fetch gets fresh data
        void cache.delete(event.request.url)
        return cached
      }
      // No pre-fetched data — pass through to network
      return fetch(event.request)
    })()
  )
})

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
  authorName?: string
  /** Rolling message history accumulated by the SW for grouped notifications. */
  messages?: Array<{ authorName?: string; contentPreview?: string }>
  /** Backend-driven action: "clear" dismisses notifications for the stream; "session_expired" prompts re-login. */
  action?: "clear" | "session_expired"
  /** Payload kind: "test" is sent by the in-app diagnostic to verify end-to-end delivery. */
  kind?: "test"
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

  // Backend-driven clear: dismiss notifications for this stream across all devices.
  // Clear both the regular stream tag and the mention tag so reading a stream
  // dismisses all notification groups for it.
  if (data.action === "clear") {
    if (!data.streamId) return
    event.waitUntil(
      Promise.all([
        self.registration.getNotifications({ tag: data.streamId }),
        self.registration.getNotifications({ tag: `${data.streamId}:mention` }),
      ]).then(([streamNotifs, mentionNotifs]) => {
        for (const n of [...streamNotifs, ...mentionNotifs]) n.close()
      })
    )
    return
  }

  // Test push from the in-app diagnostic. Always display, even with the app
  // focused — the user explicitly asked to verify the delivery loop, so
  // suppressing it would defeat the purpose.
  if (data.kind === "test") {
    event.waitUntil(
      self.registration.showNotification("Threa test notification", {
        body: "Push delivery is working — you should see this on every subscribed device.",
        icon: "/threa-logo-192.png",
        badge: "/threa-logo-192.png",
        tag: "threa-test",
        renotify: true,
        data: { ...data, kind: "test" },
      } as ExtendedNotificationOptions)
    )
    return
  }

  // Session expired: the user's auth has expired and their push subscriptions
  // have been cleaned up. Show a one-shot notification so they know to log back in.
  if (data.action === "session_expired") {
    event.waitUntil(
      self.registration.showNotification("Session expired", {
        body: "Your session has expired. Tap to sign back in.",
        icon: "/threa-logo-192.png",
        badge: "/threa-logo-192.png",
        tag: "session-expired",
        data: { ...data, action: "session_expired" },
      } as ExtendedNotificationOptions)
    )
    return
  }

  // Lazy-import pure formatting helpers (keeps SW entry point lean)
  const fmt = import("./lib/sw-notification-format")

  // Tag by stream, with mentions on a separate tag so they stay visually distinct.
  const tag = data.streamId ? resolveTag(data.streamId, data.activityType) : "threa-notification"

  // Suppress notification if the user has a focused app window — they can already see the message.
  // Backend always sends the push; the SW decides whether to display it.
  event.waitUntil(
    Promise.all([fmt, self.clients.matchAll({ type: "window", includeUncontrolled: true })]).then(
      async ([{ appendMessage, formatTitle, formatBody }, clients]) => {
        const hasFocusedWindow = clients.some((c) => c.focused && new URL(c.url).origin === self.location.origin)
        if (hasFocusedWindow) return

        // Accumulate a rolling list of recent messages from the existing notification
        const existing = await self.registration.getNotifications({ tag })
        const previousMessages = (existing[0]?.data as PushData | undefined)?.messages ?? []
        const messages = appendMessage(previousMessages, {
          authorName: data.authorName,
          contentPreview: data.contentPreview,
        })

        const title = formatTitle(messages, data.streamName, data.activityType)
        const body = formatBody(messages)

        const options: ExtendedNotificationOptions = {
          body,
          icon: "/threa-logo-192.png",
          badge: "/threa-logo-192.png",
          data: { ...data, messages },
          tag,
          renotify: true, // Re-alert (vibrate/sound) even when replacing an existing notification
        }

        await self.registration.showNotification(title, options)

        // Pre-fetch stream bootstrap in the background so it's ready when user taps.
        // Best-effort: swallow errors so notification display is never affected.
        if (data.workspaceId && data.streamId) {
          await prefetchStreamBootstrap(data.workspaceId, data.streamId).catch(() => {})
          // If targeting a specific message, also prefetch events around it
          // so the message is in IDB when the user taps the notification.
          if (data.messageId) {
            await prefetchEventsAround(data.workspaceId, data.streamId, data.messageId).catch(() => {})
          }
        }
      }
    )
  )
})

// ============================================================================
// Notification click — focus existing window or open new one
// ============================================================================

self.addEventListener("notificationclick", (event) => {
  event.notification.close()

  const data = event.notification.data as PushData | undefined
  let targetUrl = "/"

  if (data?.workspaceId && data?.streamId) {
    targetUrl = data.messageId
      ? `/w/${data.workspaceId}/s/${data.streamId}?m=${data.messageId}`
      : `/w/${data.workspaceId}/s/${data.streamId}`
  } else if (data?.workspaceId) {
    targetUrl = `/w/${data.workspaceId}`
  }

  const absoluteUrl = new URL(targetUrl, self.location.origin).href

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
      // No existing window — open a new one.
      // Use absolute URL so browsers that associate the full URL with the manifest
      // scope (e.g. for PWA standalone windows) can open in the correct context.
      await self.clients.openWindow(absoluteUrl)
    })
  )
})

// ============================================================================
// Clear notifications when the user reads a stream in the app
// ============================================================================

self.addEventListener("message", (event) => {
  if (event.data?.type !== SW_MSG_CLEAR_NOTIFICATIONS) return
  const streamId = event.data.streamId as string | undefined
  if (!streamId) return

  event.waitUntil(
    Promise.all([
      self.registration.getNotifications({ tag: streamId }),
      self.registration.getNotifications({ tag: `${streamId}:mention` }),
    ]).then(([streamNotifs, mentionNotifs]) => {
      for (const n of [...streamNotifs, ...mentionNotifs]) n.close()
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
