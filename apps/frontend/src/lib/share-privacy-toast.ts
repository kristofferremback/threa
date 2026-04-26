import { toast } from "sonner"

/**
 * Surfaced when the message queue receives 409 +
 * `SHARE_PRIVACY_CONFIRMATION_REQUIRED` for a pending share — the user has
 * not acknowledged that the share exposes its source to people outside
 * the source stream. Two paths:
 *
 * - **Share anyway** — re-enqueue with `confirmedPrivacyWarning: true` and
 *   clear the `blocked-privacy` status so the queue's next drain
 *   re-attempts with the confirmation flag forwarded to the API.
 * - **Cancel** — drop the pending row and its optimistic event so the
 *   half-failed share disappears cleanly.
 *
 * State writes go through `usePendingMessages` (`retryMessage` /
 * `deleteMessage`) rather than touching `db.*` directly so we don't
 * bypass the React state cleanup the context performs.
 */
export interface SharePrivacyToastDeps {
  retryMessage: (id: string, patch?: Record<string, unknown>) => Promise<void>
  deleteMessage: (id: string) => Promise<void>
}

export function surfacePrivacyBlockToast(clientMessageId: string, deps: SharePrivacyToastDeps): void {
  const id = `share-privacy-${clientMessageId}`
  toast.warning("This share would expose the source to people outside the source stream.", {
    id,
    duration: Infinity,
    action: {
      label: "Share anyway",
      onClick: async () => {
        await deps.retryMessage(clientMessageId, { confirmedPrivacyWarning: true, status: undefined })
        toast.dismiss(id)
      },
    },
    cancel: {
      label: "Cancel",
      onClick: async () => {
        await deps.deleteMessage(clientMessageId)
        toast.dismiss(id)
      },
    },
  })
}
