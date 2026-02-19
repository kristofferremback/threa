import { useMemo, useState, useEffect, useCallback } from "react"
import type { Socket } from "socket.io-client"
import type {
  StreamEvent,
  AgentStepType,
  AgentSessionStartedPayload,
  AgentSessionCompletedPayload,
  AgentSessionFailedPayload,
  AgentSessionDeletedPayload,
  AgentSessionProgressPayload,
  AgentActivityStartedPayload,
  AgentActivityEndedPayload,
} from "@threa/types"
import { getStepInlineLabel } from "@/lib/step-config"

export interface MessageAgentActivity {
  sessionId: string
  personaName: string
  currentStepType: AgentStepType | null
  stepCount: number
  messageCount: number
  /** Thread stream ID for channel mentions - allows linking directly to thread */
  threadStreamId?: string
}

// Re-export from consolidated config for backward compatibility
export { getStepInlineLabel as getStepLabel }

interface ProgressEntry {
  triggerMessageId: string
  personaName: string
  currentStepType: AgentStepType | null
  stepCount: number
  messageCount: number
  threadStreamId?: string
}

/**
 * Derives a map of triggerMessageId → activity state from:
 * 1. Events array (bootstrap): scan for started sessions without matching completed/failed
 * 2. Socket (live): activity_started, progress, and activity_ended events
 *
 * For channel views, session lifecycle events live in the thread stream (not the channel).
 * The hook handles this by also including sessions known only from socket events.
 * The activity_started event fires immediately when the session begins (no step yet),
 * progress events update the step type, and activity_ended cleans up.
 */
export function useAgentActivity(events: StreamEvent[], socket: Socket | null): Map<string, MessageAgentActivity> {
  // Track live activity from socket: sessionId → { triggerMessageId, personaName, currentStepType }
  const [progressBySession, setProgressBySession] = useState<Map<string, ProgressEntry>>(new Map())

  // Derive running sessions from events array (bootstrap source of truth for streams
  // that contain session lifecycle events, e.g. threads and scratchpads)
  const runningSessions = useMemo(() => {
    const started = new Map<string, { triggerMessageId: string; personaName: string }>()
    const terminated = new Set<string>()

    for (const event of events) {
      switch (event.eventType) {
        case "agent_session:started": {
          const payload = event.payload as AgentSessionStartedPayload
          started.set(payload.sessionId, {
            triggerMessageId: payload.triggerMessageId,
            personaName: payload.personaName,
          })
          break
        }
        case "agent_session:completed": {
          const payload = event.payload as AgentSessionCompletedPayload
          terminated.add(payload.sessionId)
          break
        }
        case "agent_session:failed": {
          const payload = event.payload as AgentSessionFailedPayload
          terminated.add(payload.sessionId)
          break
        }
        case "agent_session:deleted": {
          const payload = event.payload as AgentSessionDeletedPayload
          terminated.add(payload.sessionId)
          break
        }
      }
    }

    // Running = started minus terminated
    for (const id of terminated) {
      started.delete(id)
    }

    return started
  }, [events])

  // When a session terminates in the events array (e.g. thread view), clean up its progress entry
  useEffect(() => {
    setProgressBySession((prev) => {
      let changed = false
      const next = new Map(prev)
      for (const sessionId of next.keys()) {
        // Only remove if we have BOTH started AND terminated in events (i.e. not in runningSessions).
        // Don't remove progress-only sessions (channel view) — those are cleaned up by activity_ended.
        if (!runningSessions.has(sessionId) && hasTerminatedInEvents(events, sessionId)) {
          next.delete(sessionId)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [runningSessions, events])

  // Activity started: session just began, no step yet (renders "Working...")
  const handleActivityStarted = useCallback((payload: AgentActivityStartedPayload) => {
    setProgressBySession((prev) => {
      const next = new Map(prev)
      next.set(payload.sessionId, {
        triggerMessageId: payload.triggerMessageId,
        personaName: payload.personaName,
        currentStepType: null,
        stepCount: 0,
        messageCount: 0,
        threadStreamId: payload.threadStreamId,
      })
      return next
    })
  }, [])

  // Progress: step type update during active session
  const handleProgress = useCallback((payload: AgentSessionProgressPayload) => {
    setProgressBySession((prev) => {
      const next = new Map(prev)
      next.set(payload.sessionId, {
        triggerMessageId: payload.triggerMessageId,
        personaName: payload.personaName,
        currentStepType: payload.currentStepType,
        stepCount: payload.stepCount,
        messageCount: payload.messageCount,
        threadStreamId: payload.threadStreamId,
      })
      return next
    })
  }, [])

  // Activity ended: session completed/failed, remove from map
  const handleActivityEnded = useCallback((payload: AgentActivityEndedPayload) => {
    setProgressBySession((prev) => {
      if (!prev.has(payload.sessionId)) return prev
      const next = new Map(prev)
      next.delete(payload.sessionId)
      return next
    })
  }, [])

  useEffect(() => {
    if (!socket) return

    socket.on("agent_session:activity_started", handleActivityStarted)
    socket.on("agent_session:progress", handleProgress)
    socket.on("agent_session:activity_ended", handleActivityEnded)
    return () => {
      socket.off("agent_session:activity_started", handleActivityStarted)
      socket.off("agent_session:progress", handleProgress)
      socket.off("agent_session:activity_ended", handleActivityEnded)
    }
  }, [socket, handleActivityStarted, handleProgress, handleActivityEnded])

  // Build final map: triggerMessageId → activity
  // Includes sessions from events (runningSessions) AND socket-only sessions (channel view)
  return useMemo(() => {
    const result = new Map<string, MessageAgentActivity>()

    // Sessions known from events (thread/scratchpad view)
    for (const [sessionId, session] of runningSessions) {
      const progress = progressBySession.get(sessionId)
      result.set(session.triggerMessageId, {
        sessionId,
        personaName: progress?.personaName ?? session.personaName,
        currentStepType: progress?.currentStepType ?? null,
        stepCount: progress?.stepCount ?? 0,
        messageCount: progress?.messageCount ?? 0,
        threadStreamId: progress?.threadStreamId,
      })
    }

    // Sessions known only from socket (channel view where lifecycle events are in thread)
    for (const [sessionId, progress] of progressBySession) {
      if (runningSessions.has(sessionId)) continue
      result.set(progress.triggerMessageId, {
        sessionId,
        personaName: progress.personaName,
        currentStepType: progress.currentStepType,
        stepCount: progress.stepCount,
        messageCount: progress.messageCount,
        threadStreamId: progress.threadStreamId,
      })
    }

    return result
  }, [runningSessions, progressBySession])
}

/** Check if a session has a terminal event (completed/failed) in the events array */
function hasTerminatedInEvents(events: StreamEvent[], sessionId: string): boolean {
  return events.some(
    (e) =>
      (e.eventType === "agent_session:completed" ||
        e.eventType === "agent_session:failed" ||
        e.eventType === "agent_session:deleted") &&
      (e.payload as AgentSessionCompletedPayload | AgentSessionFailedPayload | AgentSessionDeletedPayload).sessionId ===
        sessionId
  )
}
