import type { Socket } from "socket.io-client"

const DEFAULT_PING_TIMEOUT_MS = 3000

/**
 * Client-initiated liveness probe. Emits `health:ping` with an ack callback.
 * Returns `true` if the server acks within `timeoutMs`, `false` on timeout
 * or if the socket disconnects mid-probe.
 *
 * Used on page-resume to detect zombie sockets that socket.io's native
 * pingTimeout (~20-25s) hasn't caught yet.
 */
export function pingSocket(socket: Socket, timeoutMs: number = DEFAULT_PING_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      socket.off("disconnect", handleDisconnect)
    }

    const settle = (result: boolean) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    const handleDisconnect = () => {
      settle(false)
    }

    socket.on("disconnect", handleDisconnect)

    timeoutId = setTimeout(() => {
      settle(false)
    }, timeoutMs)

    socket.emit("health:ping", () => {
      settle(true)
    })
  })
}
