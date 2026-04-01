import { useEffect, useRef } from "react"
import { useSocket } from "@/contexts"

type DismissalHandler = (linkPreviewId: string) => void
type Socket = ReturnType<typeof useSocket>

/**
 * Single shared socket listener for link_preview:dismissed events.
 * Instead of each LinkPreviewList registering its own socket.on(),
 * this hook maintains one listener that fans out to per-message
 * subscribers via a module-level Map. With 300+ messages rendered,
 * this reduces socket listeners from O(n) to O(1).
 */
const subscribers = new Map<string, Set<DismissalHandler>>()
let activeSocket: Socket = null
let cleanupFn: (() => void) | null = null

function ensureListener(socket: Socket) {
  if (activeSocket === socket) return
  if (cleanupFn) cleanupFn()

  activeSocket = socket
  if (!socket) return

  const handler = (payload: { messageId: string; linkPreviewId: string }) => {
    const handlers = subscribers.get(payload.messageId)
    if (!handlers) return
    for (const fn of handlers) {
      fn(payload.linkPreviewId)
    }
  }

  socket.on("link_preview:dismissed", handler)
  cleanupFn = () => {
    socket.off("link_preview:dismissed", handler)
    activeSocket = null
    cleanupFn = null
  }
}

/**
 * Subscribe to link preview dismissals for a specific message.
 * Only one socket listener exists globally; this hook registers
 * a per-message callback that fires when a dismissal targets
 * the given messageId.
 */
export function useLinkPreviewDismissal(messageId: string, onDismissed: DismissalHandler) {
  const socket = useSocket()
  const handlerRef = useRef(onDismissed)
  handlerRef.current = onDismissed

  useEffect(() => {
    if (!socket) return

    ensureListener(socket)

    const stableHandler: DismissalHandler = (linkPreviewId) => {
      handlerRef.current(linkPreviewId)
    }

    let set = subscribers.get(messageId)
    if (!set) {
      set = new Set()
      subscribers.set(messageId, set)
    }
    set.add(stableHandler)

    return () => {
      set.delete(stableHandler)
      if (set.size === 0) {
        subscribers.delete(messageId)
      }
      if (subscribers.size === 0 && cleanupFn) {
        cleanupFn()
      }
    }
  }, [socket, messageId])
}
