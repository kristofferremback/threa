import { useState, useEffect, useCallback, useRef } from "react"
import { io, Socket } from "socket.io-client"

// Room name builders (must match server)
const room = {
  stream: (workspaceId: string, streamId: string) => `ws:${workspaceId}:stream:${streamId}`,
}

export interface AriadneThinkingStep {
  stepType: "tool_call" | "reasoning" | "searching" | "analyzing"
  content: string
  timestamp: number
}

export interface AriadneThinkingState {
  eventId: string // The message that triggered Ariadne
  triggeredByUserId: string
  status: "thinking" | "done"
  steps: AriadneThinkingStep[]
  startedAt: number
  success?: boolean
  errorMessage?: string
}

interface UseAriadneThinkingOptions {
  workspaceId: string
  streamId?: string
  enabled?: boolean
}

interface UseAriadneThinkingReturn {
  thinkingStates: Map<string, AriadneThinkingState>
  isThinking: boolean // True if any thinking is in progress for this stream
  currentThinking: AriadneThinkingState | null // The most recent/active thinking state
}

/**
 * Hook to track Ariadne's thinking state for a stream.
 *
 * Listens for ephemeral thinking events and maintains state that can be
 * displayed in the UI. Multiple thinking sessions can be active simultaneously
 * (keyed by triggering event ID).
 */
export function useAriadneThinking({
  workspaceId,
  streamId,
  enabled = true,
}: UseAriadneThinkingOptions): UseAriadneThinkingReturn {
  const [thinkingStates, setThinkingStates] = useState<Map<string, AriadneThinkingState>>(new Map())
  const socketRef = useRef<Socket | null>(null)
  const currentStreamRef = useRef<string | undefined>(streamId)

  // Keep ref in sync
  useEffect(() => {
    currentStreamRef.current = streamId
  }, [streamId])

  // Clear old thinking states that are done after a delay
  const clearDoneState = useCallback((eventId: string) => {
    setTimeout(() => {
      setThinkingStates((prev) => {
        const state = prev.get(eventId)
        if (state?.status === "done") {
          const next = new Map(prev)
          next.delete(eventId)
          return next
        }
        return prev
      })
    }, 3000) // Keep done state visible for 3 seconds
  }, [])

  useEffect(() => {
    if (!enabled || !streamId) return

    const socket = io({ withCredentials: true })
    socketRef.current = socket

    // Reset state for new stream
    setThinkingStates(new Map())

    // Join stream room
    const joinRoom = () => {
      socket.emit("join", room.stream(workspaceId, streamId))
    }

    socket.on("connect", joinRoom)
    if (socket.connected) {
      joinRoom()
    }

    // Handle thinking start
    socket.on(
      "ariadne:thinking:start",
      (data: { streamId: string; eventId: string; triggeredByUserId: string }) => {
        if (data.streamId !== currentStreamRef.current) return

        setThinkingStates((prev) => {
          const next = new Map(prev)
          next.set(data.eventId, {
            eventId: data.eventId,
            triggeredByUserId: data.triggeredByUserId,
            status: "thinking",
            steps: [],
            startedAt: Date.now(),
          })
          return next
        })
      },
    )

    // Handle thinking step
    socket.on(
      "ariadne:thinking:step",
      (data: {
        streamId: string
        eventId: string
        stepType: AriadneThinkingStep["stepType"]
        stepContent: string
      }) => {
        if (data.streamId !== currentStreamRef.current) return

        setThinkingStates((prev) => {
          const existing = prev.get(data.eventId)
          if (!existing || existing.status === "done") return prev

          const next = new Map(prev)
          next.set(data.eventId, {
            ...existing,
            steps: [
              ...existing.steps,
              {
                stepType: data.stepType,
                content: data.stepContent,
                timestamp: Date.now(),
              },
            ],
          })
          return next
        })
      },
    )

    // Handle thinking done
    socket.on(
      "ariadne:thinking:done",
      (data: { streamId: string; eventId: string; success: boolean; errorMessage?: string }) => {
        if (data.streamId !== currentStreamRef.current) return

        setThinkingStates((prev) => {
          const existing = prev.get(data.eventId)
          if (!existing) return prev

          const next = new Map(prev)
          next.set(data.eventId, {
            ...existing,
            status: "done",
            success: data.success,
            errorMessage: data.errorMessage,
          })
          return next
        })

        // Clear the done state after a delay
        clearDoneState(data.eventId)
      },
    )

    return () => {
      if (streamId) {
        socket.emit("leave", room.stream(workspaceId, streamId))
      }
      socket.disconnect()
      socketRef.current = null
    }
  }, [enabled, workspaceId, streamId, clearDoneState])

  // Derive computed state
  const isThinking = Array.from(thinkingStates.values()).some((s) => s.status === "thinking")
  const currentThinking =
    Array.from(thinkingStates.values())
      .filter((s) => s.status === "thinking")
      .sort((a, b) => b.startedAt - a.startedAt)[0] || null

  return {
    thinkingStates,
    isThinking,
    currentThinking,
  }
}
