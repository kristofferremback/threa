import { useState, useEffect, useCallback, useRef } from "react"
import { io, Socket } from "socket.io-client"
import type { AgentSession, SessionStep } from "../components/chat/AgentThinkingEvent"

// Room name builders (must match server)
const room = {
  stream: (workspaceId: string, streamId: string) => `ws:${workspaceId}:stream:${streamId}`,
}

interface UseAgentSessionsOptions {
  workspaceId: string
  streamId?: string
  initialSessions?: AgentSession[]
  enabled?: boolean
}

interface UseAgentSessionsReturn {
  sessions: Map<string, AgentSession>
  getSessionForEvent: (eventId: string) => AgentSession | undefined
  activeSessionCount: number
}

/**
 * Hook to track agent sessions for a stream.
 *
 * Sessions are persisted to the database and can be initialized from the events
 * endpoint. Real-time updates come through Socket.IO for active sessions.
 *
 * Unlike ephemeral thinking indicators, sessions persist across page reloads
 * and show the full reasoning timeline.
 */
export function useAgentSessions({
  workspaceId,
  streamId,
  initialSessions = [],
  enabled = true,
}: UseAgentSessionsOptions): UseAgentSessionsReturn {
  // Initialize with any sessions passed in (but these may update after API fetch)
  const [sessions, setSessions] = useState<Map<string, AgentSession>>(new Map())

  const socketRef = useRef<Socket | null>(null)
  const currentStreamRef = useRef<string | undefined>(streamId)
  const prevStreamIdRef = useRef<string | undefined>(streamId)
  const hasRefetchedRef = useRef<boolean>(false)

  // Clear sessions when stream changes, keep ref in sync
  useEffect(() => {
    if (prevStreamIdRef.current !== streamId) {
      // Stream changed - clear sessions for the new stream
      setSessions(new Map())
      prevStreamIdRef.current = streamId
      hasRefetchedRef.current = false // Reset refetch flag for new stream
    }
    currentStreamRef.current = streamId
  }, [streamId])

  // Merge initial sessions with existing state (don't replace - preserve real-time updates)
  useEffect(() => {
    if (initialSessions.length === 0) return // Don't clear state if initial is empty

    setSessions((prev) => {
      const next = new Map(prev)
      for (const session of initialSessions) {
        const existing = next.get(session.id)
        // Only add/update if we don't have it, or if the incoming one is more complete
        if (!existing || (existing.status === "active" && session.status !== "active")) {
          next.set(session.id, session)
        }
      }
      return next
    })
  }, [initialSessions])

  // Get session by triggering event ID
  const getSessionForEvent = useCallback(
    (eventId: string): AgentSession | undefined => {
      for (const session of sessions.values()) {
        if (session.triggeringEventId === eventId) {
          return session
        }
      }
      return undefined
    },
    [sessions],
  )

  useEffect(() => {
    if (!enabled || !streamId) return

    // Skip for pending threads (virtual streams that don't exist on server yet)
    const isPendingThread = streamId.startsWith("pending_") || streamId.startsWith("event_")

    const socket = io({ withCredentials: true })
    socketRef.current = socket

    // Refetch sessions from API (called after socket connects to catch any we missed)
    const refetchSessions = async () => {
      if (hasRefetchedRef.current || isPendingThread) return
      hasRefetchedRef.current = true

      try {
        const res = await fetch(`/api/workspace/${workspaceId}/streams/${streamId}/events?limit=1`, {
          credentials: "include",
        })
        if (res.ok) {
          const data = await res.json()
          if (data.sessions && data.sessions.length > 0) {
            setSessions((prev) => {
              const next = new Map(prev)
              for (const s of data.sessions) {
                // Only add if we don't have it
                if (!next.has(s.id)) {
                  next.set(s.id, {
                    id: s.id,
                    streamId: s.streamId,
                    triggeringEventId: s.triggeringEventId,
                    responseEventId: s.responseEventId,
                    status: s.status,
                    steps: s.steps || [],
                    summary: s.summary,
                    errorMessage: s.errorMessage,
                    startedAt: s.startedAt,
                    completedAt: s.completedAt,
                  })
                }
              }
              return next
            })
          }
        }
      } catch {
        // Ignore fetch errors - we'll rely on socket events
      }
    }

    // Track timeouts for cleanup
    const timeouts: NodeJS.Timeout[] = []

    // Join stream room and refetch sessions
    const joinRoom = () => {
      socket.emit("join", room.stream(workspaceId, streamId))
      // Refetch sessions after delays to catch any we might have missed
      // First try quickly, then again after a longer delay for slow session creation
      timeouts.push(setTimeout(refetchSessions, 300))
      timeouts.push(
        setTimeout(() => {
          hasRefetchedRef.current = false // Reset to allow second fetch
          refetchSessions()
        }, 1500),
      )
    }

    socket.on("connect", joinRoom)
    if (socket.connected) {
      joinRoom()
    }

    // Handle session started
    socket.on("session:started", (data: { streamId: string; sessionId: string; triggeringEventId: string }) => {
      // Note: streamId in data is the session's actual stream, not necessarily the stream we're viewing
      // We receive this event if we're viewing either the session's stream OR the triggering event's channel

      setSessions((prev) => {
        const existing = prev.get(data.sessionId)
        const next = new Map(prev)

        if (existing) {
          // Update existing session with triggeringEventId (might have been created by session:step first)
          next.set(data.sessionId, {
            ...existing,
            triggeringEventId: data.triggeringEventId,
            streamId: data.streamId,
          })
        } else {
          // Create new session
          next.set(data.sessionId, {
            id: data.sessionId,
            streamId: data.streamId,
            triggeringEventId: data.triggeringEventId,
            responseEventId: null,
            status: "active",
            steps: [],
            summary: null,
            errorMessage: null,
            startedAt: new Date().toISOString(),
            completedAt: null,
          })
        }
        return next
      })
    })

    // Handle session step updates
    socket.on("session:step", (data: { streamId: string; sessionId: string; step: SessionStep }) => {
      // Accept updates for sessions we're tracking OR create a new session if we missed session:started
      setSessions((prev) => {
        const existing = prev.get(data.sessionId)

        if (!existing) {
          // Session not found - create a placeholder (we missed session:started)
          const next = new Map(prev)
          next.set(data.sessionId, {
            id: data.sessionId,
            streamId: data.streamId,
            triggeringEventId: "", // Unknown, will be populated when we get more info
            responseEventId: null,
            status: "active",
            steps: [data.step],
            summary: null,
            errorMessage: null,
            startedAt: data.step.started_at,
            completedAt: null,
          })
          return next
        }

        const next = new Map(prev)
        // Update existing step or add new one
        const stepIndex = existing.steps.findIndex((s) => s.id === data.step.id)
        const updatedSteps =
          stepIndex >= 0
            ? existing.steps.map((s, i) => (i === stepIndex ? data.step : s))
            : [...existing.steps, data.step]

        next.set(data.sessionId, {
          ...existing,
          steps: updatedSteps,
        })
        return next
      })
    })

    // Handle session completed
    socket.on(
      "session:completed",
      (data: {
        streamId: string
        sessionId: string
        status: "completed" | "failed"
        summary?: string
        errorMessage?: string
        responseEventId?: string
      }) => {
        // Accept completion for sessions we're tracking OR create completed session
        setSessions((prev) => {
          const existing = prev.get(data.sessionId)

          if (!existing) {
            // Session not found - create a completed session (we missed earlier events)
            const next = new Map(prev)
            next.set(data.sessionId, {
              id: data.sessionId,
              streamId: data.streamId,
              triggeringEventId: "",
              responseEventId: data.responseEventId || null,
              status: data.status,
              steps: [],
              summary: data.summary || null,
              errorMessage: data.errorMessage || null,
              startedAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
            })
            return next
          }

          const next = new Map(prev)
          next.set(data.sessionId, {
            ...existing,
            status: data.status,
            summary: data.summary || null,
            errorMessage: data.errorMessage || null,
            responseEventId: data.responseEventId || null,
            completedAt: new Date().toISOString(),
          })
          return next
        })
      },
    )

    // Handle agent response messages as a fallback for session completion
    // When Ariadne posts a response, it includes sessionId in payload - use this to mark session complete
    // This catches cases where session:completed event might be missed
    socket.on(
      "event",
      (data: {
        id: string
        streamId: string
        eventType: string
        agentId?: string
        payload?: { sessionId?: string }
      }) => {
        // Only handle message events from agents with a sessionId
        if (data.eventType !== "message" || !data.agentId || !data.payload?.sessionId) return
        if (data.streamId !== currentStreamRef.current) return

        const sessionId = data.payload.sessionId
        setSessions((prev) => {
          const existing = prev.get(sessionId)

          // If session already completed/failed, don't overwrite
          if (existing?.status === "completed" || existing?.status === "failed") {
            return prev
          }

          const next = new Map(prev)

          if (!existing) {
            // Session not in Map yet - create a completed session
            // This can happen if we missed session:started/session:step events
            next.set(sessionId, {
              id: sessionId,
              streamId: data.streamId,
              triggeringEventId: "",
              responseEventId: data.id,
              status: "completed",
              steps: [],
              summary: null,
              errorMessage: null,
              startedAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
            })
            return next
          }

          // Mark all active steps as completed too
          const completedSteps = existing.steps.map((step) =>
            step.status === "active"
              ? { ...step, status: "completed" as const, completed_at: new Date().toISOString() }
              : step,
          )

          next.set(sessionId, {
            ...existing,
            status: "completed",
            steps: completedSteps,
            responseEventId: data.id,
            completedAt: new Date().toISOString(),
          })
          return next
        })
      },
    )

    return () => {
      // Clear pending refetch timeouts
      timeouts.forEach(clearTimeout)
      if (streamId) {
        socket.emit("leave", room.stream(workspaceId, streamId))
      }
      socket.disconnect()
      socketRef.current = null
    }
  }, [enabled, workspaceId, streamId])

  // Count active sessions
  const activeSessionCount = Array.from(sessions.values()).filter(
    (s) => s.status === "active" || s.status === "summarizing",
  ).length

  return {
    sessions,
    getSessionForEvent,
    activeSessionCount,
  }
}
