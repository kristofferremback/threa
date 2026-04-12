import { useCallback } from "react"
import type { Socket } from "socket.io-client"

interface AbortAck {
  ok: boolean
  error?: string
}

/**
 * Returns a callback that asks the backend to gracefully abort an in-flight
 * workspace research call for a given session. Abort is cooperative — the
 * researcher stops at its next safe checkpoint and returns whatever partial
 * results were collected. The session itself is NOT killed; the agent loop
 * continues with the partial context and produces a normal response.
 *
 * The handler emits `agent_session:research:abort` with an ack callback. Errors
 * are logged but not surfaced — there's nothing the user can do about them, and
 * the abort is best-effort by design (the research may have already completed
 * by the time the click reaches the server).
 */
export function useAbortResearch(socket: Socket | null) {
  return useCallback(
    (params: { sessionId: string; workspaceId: string }) => {
      if (!socket) return
      socket.emit(
        "agent_session:research:abort",
        { sessionId: params.sessionId, workspaceId: params.workspaceId },
        (ack: AbortAck | undefined) => {
          if (!ack?.ok) {
            console.warn("[useAbortResearch] abort ack:", ack?.error ?? "no ack")
          }
        }
      )
    },
    [socket]
  )
}
