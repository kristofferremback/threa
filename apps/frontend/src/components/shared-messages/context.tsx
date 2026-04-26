import { createContext, useContext, useMemo, type ReactNode } from "react"

/**
 * Hydrated payload for a pointer message. Kept structurally aligned with
 * the backend's `HydratedSharedMessage` discriminated union so future
 * states (private, truncated — slice 2) can be added here and in the
 * NodeView without API churn.
 */
export type HydratedSharedMessage =
  | {
      state: "ok"
      messageId: string
      streamId: string
      authorId: string
      authorName?: string
      authorType: string
      contentJson: unknown
      contentMarkdown: string
      editedAt: string | null
      createdAt: string
    }
  | { state: "deleted"; messageId: string; deletedAt: string }
  | { state: "missing"; messageId: string }

interface SharedMessagesContextValue {
  get: (messageId: string) => HydratedSharedMessage | null
}

const SharedMessagesCtx = createContext<SharedMessagesContextValue | null>(null)

/**
 * Provides the timeline's `sharedMessages` hydration map to any descendant
 * `SharedMessageView` NodeView. The map lives in the stream bootstrap / event
 * list response and is plumbed in by the timeline container. Consumers read
 * per-messageId; a miss returns `null` so the view can render the pre-hydration
 * skeleton rather than crash.
 */
export function SharedMessagesProvider({
  map,
  children,
}: {
  map: Record<string, HydratedSharedMessage> | undefined | null
  children: ReactNode
}) {
  const value = useMemo<SharedMessagesContextValue>(() => {
    const snapshot = map ?? {}
    return {
      get: (messageId: string) => snapshot[messageId] ?? null,
    }
  }, [map])
  return <SharedMessagesCtx.Provider value={value}>{children}</SharedMessagesCtx.Provider>
}

export function useSharedMessageHydration(messageId: string): HydratedSharedMessage | null {
  const ctx = useContext(SharedMessagesCtx)
  if (!ctx) return null
  return ctx.get(messageId)
}
