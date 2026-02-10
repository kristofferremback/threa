import type { Socket } from "socket.io-client"
import { debugBootstrap } from "./bootstrap-debug"

interface JoinAckResult {
  ok: boolean
  error?: string
}

interface JoinRoomOptions {
  timeoutMs?: number
  signal?: AbortSignal
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

function waitForConnection(socket: Socket, room: string, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  if (socket.connected) {
    debugBootstrap("Socket already connected before join", { room })
    return Promise.resolve()
  }

  if (signal?.aborted) {
    return Promise.reject(new Error(`Join aborted for room "${room}"`))
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
      signal?.removeEventListener("abort", handleAbort)
    }

    const handleConnect = () => {
      cleanup()
      debugBootstrap("Socket connected while waiting to join room", { room })
      resolve()
    }

    const handleConnectError = (error: Error) => {
      lastConnectError = error.message
    }

    const handleAbort = () => {
      cleanup()
      reject(new Error(`Join aborted for room "${room}"`))
    }

    socket.on("connect", handleConnect)
    socket.on("connect_error", handleConnectError)
    signal?.addEventListener("abort", handleAbort, { once: true })

    // Handle race where socket connected between initial check and listener registration.
    if (socket.connected) {
      cleanup()
      resolve()
      return
    }

    timeoutId = setTimeout(() => {
      cleanup()
      debugBootstrap("Timed out waiting for socket connection before join", { room, timeoutMs, lastConnectError })
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
      debugBootstrap("Join ack success", { room })
      resolve()
    }

    const rejectOnce = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      debugBootstrap("Join ack failed", { room, error: error.message })
      reject(error)
    }

    const handleDisconnect = (reason: string) => {
      rejectOnce(new Error(`Socket disconnected while joining room "${room}": ${reason}`))
    }

    socket.on("disconnect", handleDisconnect)

    timeoutId = setTimeout(() => {
      rejectOnce(new Error(`Timed out waiting for join ack for room "${room}"`))
    }, timeoutMs)

    debugBootstrap("Emitting join with ack", { room })
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
  const signal = options?.signal

  if (signal?.aborted) {
    throw new Error(`Join aborted for room "${room}"`)
  }

  const pendingJoins = getPendingJoins(socket)
  const existingJoin = pendingJoins.get(room)
  if (existingJoin) {
    debugBootstrap("Reusing in-flight join promise", { room })
    if (!signal) return existingJoin
    // Race the shared promise against the abort signal so this caller can bail out
    // without cancelling the join for other callers sharing the dedup promise.
    return raceAbortSignal(existingJoin, signal, room)
  }

  debugBootstrap("Starting joinRoomWithAck", { room, timeoutMs })
  const joinPromise = (async () => {
    await waitForConnection(socket, room, timeoutMs, signal)
    if (signal?.aborted) throw new Error(`Join aborted for room "${room}"`)
    await emitJoinWithAck(socket, room, timeoutMs)
  })()

  // Cancellable joins skip the dedup map — aborting a shared promise would reject
  // for non-cancellable callers that deduped onto it.
  if (signal) {
    return joinPromise
  }

  pendingJoins.set(room, joinPromise)

  try {
    await joinPromise
  } finally {
    pendingJoins.delete(room)
  }
}

function raceAbortSignal(promise: Promise<void>, signal: AbortSignal, room: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false

    const onAbort = () => {
      if (settled) return
      settled = true
      reject(new Error(`Join aborted for room "${room}"`))
    }

    signal.addEventListener("abort", onAbort, { once: true })

    promise.then(
      () => {
        if (settled) return
        settled = true
        signal.removeEventListener("abort", onAbort)
        resolve()
      },
      (err) => {
        if (settled) return
        settled = true
        signal.removeEventListener("abort", onAbort)
        reject(err)
      }
    )
  })
}
