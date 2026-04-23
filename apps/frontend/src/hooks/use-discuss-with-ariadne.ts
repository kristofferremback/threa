import { useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { useCreateStream } from "./use-streams"
import { buildDiscussWithAriadneBag } from "@/lib/ariadne/discuss"

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
        navigate(`/w/${workspaceId}/s/${stream.id}`)
      } catch (err) {
        toast.error("Couldn't start a discussion. Please try again.")
        throw err
      }
    },
    [createStream, navigate, workspaceId]
  )
}
