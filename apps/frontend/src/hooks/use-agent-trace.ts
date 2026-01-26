import { useCallback, useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useSocket } from "@/contexts"
import { agentSessionsApi } from "@/api"
import type {
  AgentSessionStep,
  AgentSession,
  AgentSessionStatus,
  AgentSessionWithSteps,
  StepStartedPayload,
  StepProgressPayload,
  StepCompletedPayload,
  SessionTerminalPayload,
} from "@threa/types"

interface UseAgentTraceResult {
  steps: AgentSessionStep[]
  streamingContent: Record<string, string>
  session: AgentSession | null
  persona: AgentSessionWithSteps["persona"] | null
  status: AgentSessionStatus | null
  isLoading: boolean
  error: Error | null
}

/**
 * Subscribe-then-bootstrap hook for agent trace steps.
 *
 * 1. Join session room
 * 2. Listen for real-time step events
 * 3. After subscription, fetch API for historical data
 * 4. Merge: real-time steps win on ID collision
 */
export function useAgentTrace(workspaceId: string, sessionId: string): UseAgentTraceResult {
  const socket = useSocket()

  // Real-time state accumulated from socket events
  const [realtimeSteps, setRealtimeSteps] = useState<Map<string, AgentSessionStep>>(new Map())
  const [streamingContent, setStreamingContent] = useState<Record<string, string>>({})
  const [terminalStatus, setTerminalStatus] = useState<"completed" | "failed" | null>(null)

  // Bootstrap: single fetch for historical data. Real-time updates come via socket.
  const { data, isLoading, error } = useQuery({
    queryKey: ["agent-session", workspaceId, sessionId],
    queryFn: () => agentSessionsApi.getSession(workspaceId, sessionId),
    enabled: !!workspaceId && !!sessionId,
  })

  const handleStepStarted = useCallback(
    (payload: StepStartedPayload) => {
      if (payload.sessionId !== sessionId) return
      setRealtimeSteps((prev) => {
        const next = new Map(prev)
        next.set(payload.step.id, payload.step)
        return next
      })
    },
    [sessionId]
  )

  const handleStepProgress = useCallback(
    (payload: StepProgressPayload) => {
      if (payload.sessionId !== sessionId) return
      if (payload.content != null) {
        setStreamingContent((prev) => ({ ...prev, [payload.stepId]: payload.content! }))
      }
    },
    [sessionId]
  )

  const handleStepCompleted = useCallback(
    (payload: StepCompletedPayload) => {
      if (payload.sessionId !== sessionId) return
      setRealtimeSteps((prev) => {
        const next = new Map(prev)
        next.set(payload.step.id, payload.step)
        return next
      })
      // Clear streaming content for completed step
      setStreamingContent((prev) => {
        const { [payload.step.id]: _, ...rest } = prev
        return rest
      })
    },
    [sessionId]
  )

  const handleCompleted = useCallback(
    (payload: SessionTerminalPayload) => {
      if (payload.sessionId !== sessionId) return
      setTerminalStatus("completed")
    },
    [sessionId]
  )

  const handleFailed = useCallback(
    (payload: SessionTerminalPayload) => {
      if (payload.sessionId !== sessionId) return
      setTerminalStatus("failed")
    },
    [sessionId]
  )

  // Subscribe to session room and listen for events
  useEffect(() => {
    if (!socket || !workspaceId || !sessionId) return

    const room = `ws:${workspaceId}:agent_session:${sessionId}`

    // Reset state for new session
    setRealtimeSteps(new Map())
    setStreamingContent({})
    setTerminalStatus(null)

    // Subscribe to session room (before any fetch returns, ensuring no missed events)
    socket.emit("join", room)

    socket.on("agent_session:step:started", handleStepStarted)
    socket.on("agent_session:step:progress", handleStepProgress)
    socket.on("agent_session:step:completed", handleStepCompleted)
    socket.on("agent_session:completed", handleCompleted)
    socket.on("agent_session:failed", handleFailed)

    return () => {
      socket.emit("leave", room)
      socket.off("agent_session:step:started", handleStepStarted)
      socket.off("agent_session:step:progress", handleStepProgress)
      socket.off("agent_session:step:completed", handleStepCompleted)
      socket.off("agent_session:completed", handleCompleted)
      socket.off("agent_session:failed", handleFailed)
    }
  }, [
    socket,
    workspaceId,
    sessionId,
    handleStepStarted,
    handleStepProgress,
    handleStepCompleted,
    handleCompleted,
    handleFailed,
  ])

  // Merge bootstrap + realtime steps (realtime wins on ID collision)
  const mergedSteps = mergeSteps(data?.steps ?? [], realtimeSteps)

  // Determine status: prefer terminal socket event, then API data
  const status: AgentSessionStatus | null = terminalStatus ?? data?.session.status ?? null

  return {
    steps: mergedSteps,
    streamingContent,
    session: data?.session ?? null,
    persona: data?.persona ?? null,
    status,
    isLoading,
    error: error as Error | null,
  }
}

function mergeSteps(apiSteps: AgentSessionStep[], realtimeSteps: Map<string, AgentSessionStep>): AgentSessionStep[] {
  const merged = new Map<string, AgentSessionStep>()

  // Add API steps first
  for (const step of apiSteps) {
    merged.set(step.id, step)
  }

  // Realtime steps override (more recent data)
  for (const [id, step] of realtimeSteps) {
    merged.set(id, step)
  }

  // Sort by stepNumber
  return Array.from(merged.values()).sort((a, b) => a.stepNumber - b.stepNumber)
}
