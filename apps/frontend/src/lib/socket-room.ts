import type { Socket } from "socket.io-client"

interface JoinAckResult {
  ok: boolean
  error?: string
}

interface JoinRoomOptions {
  timeoutMs?: number
}

const DEFAULT_JOIN_TIMEOUT_MS = 5000
const pendingJoinsBySocket = new WeakMap<Socket, Map<string, Promise<void>>>()

function getPendingJoins(socket: Socket): Map<string, Promise<void>> {
  const pending = pendingJoinsBySocket.get(socket)
  if (pending) return pending

  const next = new Map<string, Promise<void>>()
  pendingJoinsBySocket.set(socket, next)
  return next
}

function waitForConnection(socket: Socket, room: string, timeoutMs: number): Promise<void> {
  if (socket.connected) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let lastConnectError: string | null = null

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      socket.off("connect", handleConnect)
      socket.off("connect_error", handleConnectError)
    }

    const handleConnect = () => {
      cleanup()
      resolve()
    }

    const handleConnectError = (error: Error) => {
      lastConnectError = error.message
    }

    socket.on("connect", handleConnect)
    socket.on("connect_error", handleConnectError)

    // Handle race where socket connected between initial check and listener registration.
    if (socket.connected) {
      cleanup()
      resolve()
      return
    }

    timeoutId = setTimeout(() => {
      cleanup()
      reject(
        new Error(
          lastConnectError
            ? `Timed out waiting for socket connection before joining room "${room}": ${lastConnectError}`
            : `Timed out waiting for socket connection before joining room "${room}"`
        )
      )
    }, timeoutMs)
  })
}

function emitJoinWithAck(socket: Socket, room: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let settled = false

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      socket.off("disconnect", handleDisconnect)
    }

    const resolveOnce = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }

    const rejectOnce = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }

    const handleDisconnect = (reason: string) => {
      rejectOnce(new Error(`Socket disconnected while joining room "${room}": ${reason}`))
    }

    socket.on("disconnect", handleDisconnect)

    timeoutId = setTimeout(() => {
      rejectOnce(new Error(`Timed out waiting for join ack for room "${room}"`))
    }, timeoutMs)

    socket.emit("join", room, (result?: JoinAckResult) => {
      if (!result?.ok) {
        rejectOnce(new Error(result?.error ?? `Failed to join room "${room}"`))
        return
      }
      resolveOnce()
    })
  })
}

export async function joinRoomWithAck(socket: Socket, room: string, options?: JoinRoomOptions): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_JOIN_TIMEOUT_MS
  const pendingJoins = getPendingJoins(socket)
  const existingJoin = pendingJoins.get(room)
  if (existingJoin) {
    return existingJoin
  }

  const joinPromise = (async () => {
    await waitForConnection(socket, room, timeoutMs)
    await emitJoinWithAck(socket, room, timeoutMs)
  })()

  pendingJoins.set(room, joinPromise)

  try {
    await joinPromise
  } finally {
    pendingJoins.delete(room)
  }
}
