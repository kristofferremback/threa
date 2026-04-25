import { useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { useCreateStream } from "./use-streams"
import { buildDiscussWithAriadneBag } from "@/lib/ariadne/discuss"
import { seedDraftWithContextRef } from "@/lib/context-bag/seed-draft"
import { ContextRefKinds } from "@threa/types"

/**
 * Hook that triggers "Discuss with Ariadne": creates a private scratchpad
 * with the given source stream attached as context, then navigates to it.
 *
 * We deliberately do NOT pass a `displayName` — leaving it null lets the
 * backend `NamingHandler` auto-generate a per-thread title from Ariadne's
 * orientation message (triggered by the `message:created` outbox event for
 * that message). Setting a display name here would suppress naming because
 * `needsAutoNaming` gates on `displayName === null`, and every scratchpad
 * would show up as the same generic label in the sidebar.
 *
 * Surfacing both entry points (context menu + slash command) through one
 * hook keeps cache updates + navigation consistent — the underlying
 * `useCreateStream` mutation already handles optimistic sidebar insertion
 * and sync-engine subscription, so the caller only needs to pass the source
 * stream id.
 */
export function useDiscussWithAriadne(workspaceId: string) {
  const createStream = useCreateStream(workspaceId)
  const navigate = useNavigate()

  return useCallback(
    async (args: { sourceStreamId: string }) => {
      try {
        const stream = await createStream.mutateAsync({
          type: "scratchpad",
          companionMode: "on",
          contextBag: buildDiscussWithAriadneBag({ sourceStreamId: args.sourceStreamId }),
        })

        // Seed the new scratchpad's draft with a context-ref sidecar so the
        // composer's `<ContextRefStrip>` renders the attached thread the
        // moment the user lands on the page — atomic with whatever they
        // type next. The strip itself fetches `GET /streams/:id/context-bag`
        // for rich label data (count + slug), so we don't need to plumb
        // labels through here; the sidecar just signals "yes, this draft
        // has a ref attached, it's ready to send."
        //
        // Status is optimistic `"ready"` because the backend's precompute
        // handler is warming `context_summaries` in parallel via the
        // `stream:created` outbox event. If the cache misses on the first
        // turn, `resolveBagForStream` falls back to inline summarization —
        // slower but correct.
        await seedDraftWithContextRef({
          workspaceId,
          streamId: stream.id,
          ref: {
            refKind: ContextRefKinds.THREAD,
            streamId: args.sourceStreamId,
            fromMessageId: null,
            toMessageId: null,
            status: "ready",
            fingerprint: null,
            errorMessage: null,
          },
        })

        navigate(`/w/${workspaceId}/s/${stream.id}`)
      } catch (err) {
        toast.error("Couldn't start a discussion. Please try again.")
        throw err
      }
    },
    [createStream, navigate, workspaceId]
  )
}
