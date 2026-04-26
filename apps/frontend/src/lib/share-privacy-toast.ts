import { toast } from "sonner"
import { db } from "@/db"

/**
 * Surfaced when the message queue receives 409 +
 * `SHARE_PRIVACY_CONFIRMATION_REQUIRED` for a pending share. The send is
 * not auto-retried because the user has not acknowledged that the share
 * exposes its source to people outside the source stream (plan D2).
 *
 * The toast offers two paths:
 *
 * - **Share anyway** — sets `confirmedPrivacyWarning: true` on the pending
 *   row and clears the `blocked-privacy` status so the next drain cycle
 *   re-attempts with the confirmation flag forwarded to the API.
 * - **Cancel** — deletes both the pending row and its optimistic event so
 *   the share disappears from the timeline. The user can re-author from
 *   scratch (or pick a less-private target) without leaving a half-failed
 *   message in the queue.
 *
 * This is the Slice 2 placeholder UX. Slice 3 lifts the prompt into the
 * picker modal as an explicit step-2 confirm, surfacing the warning before
 * the user types commentary, and replaces this toast.
 */
export function surfacePrivacyBlockToast(clientMessageId: string): void {
  const id = `share-privacy-${clientMessageId}`
  toast.warning("This share would expose the source to people outside the source stream.", {
    id,
    duration: Infinity,
    action: {
      label: "Share anyway",
      onClick: async () => {
        // Dexie's deep KeyPaths inference hits a circular type on JSONContent.
        type UpdateFn = (key: string, changes: Record<string, unknown>) => Promise<number>
        await (db.pendingMessages.update as unknown as UpdateFn)(clientMessageId, {
          status: undefined,
          confirmedPrivacyWarning: true,
          retryAfter: undefined,
          retryCount: 0,
        })
        await db.events.update(clientMessageId, { _status: "pending" })
        toast.dismiss(id)
      },
    },
    cancel: {
      label: "Cancel",
      onClick: async () => {
        await db.pendingMessages.delete(clientMessageId)
        await db.events.delete(clientMessageId)
        toast.dismiss(id)
      },
    },
  })
}
