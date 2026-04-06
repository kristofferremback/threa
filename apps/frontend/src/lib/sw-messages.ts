/** Posted to the focused window when user clicks a notification. */
export const SW_MSG_NOTIFICATION_CLICK = "NOTIFICATION_CLICK"

/** Posted to all windows when the push subscription is rotated by the browser. */
export const SW_MSG_SUBSCRIPTION_CHANGED = "PUSH_SUBSCRIPTION_CHANGED"

/** Posted from the app to the SW to dismiss notifications for a stream the user is viewing. */
export const SW_MSG_CLEAR_NOTIFICATIONS = "CLEAR_NOTIFICATIONS"

/** Posted from the app to the SW to force skipWaiting on a waiting worker. */
export const SW_MSG_SKIP_WAITING = "SKIP_WAITING"

/** Cache name used by the SW to stash share-target POST data (files + text) for the app to read. */
export const SHARE_TARGET_CACHE = "share-target"
