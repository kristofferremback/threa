import { useCallback, useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useSocket } from "@/contexts"
import { agentSessionsApi } from "@/api"
import { joinRoomWithAck } from "@/lib/socket-room"
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
 * CRITICAL: We must subscribe BEFORE fetching to avoid missing events.
 * The pattern is:
 * 1. Join session room (socket subscription)
 * 2. Listen for real-time step events
 * 3. After subscription confirmed, fetch API for historical data
 * 4. Merge: real-time steps win on ID collision
 *
 * This prevents the race where we fetch data, miss an event, then subscribe.
 */
export function useAgentTrace(workspaceId: string, sessionId: string): UseAgentTraceResult {
  const socket = useSocket()

  // Real-time state accumulated from socket events
  const [realtimeSteps, setRealtimeSteps] = useState<Map<string, AgentSessionStep>>(new Map())
  const [streamingContent, setStreamingContent] = useState<Record<string, string>>({})
  const [terminalStatus, setTerminalStatus] = useState<"completed" | "failed" | null>(null)
  // Track if socket is subscribed (enables query after subscription)
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [isSubscribing, setIsSubscribing] = useState(false)
  const [subscriptionError, setSubscriptionError] = useState<Error | null>(null)

  // Bootstrap: single fetch for historical data. Real-time updates come via socket.
  // IMPORTANT: Only fetch AFTER socket subscription is confirmed to avoid race conditions
  const {
    data,
    isLoading: isQueryLoading,
    error: queryError,
  } = useQuery({
    queryKey: ["agent-session", workspaceId, sessionId],
    queryFn: () => agentSessionsApi.getSession(workspaceId, sessionId),
    enabled: !!workspaceId && !!sessionId && isSubscribed,
    // Always refetch when modal opens - don't serve stale data from a previous view
    staleTime: 0,
  })

  const handleStepStarted = useCallback(
    (payload: StepStartedPayload) => {
      if (payload?.sessionId !== sessionId || !payload.step?.id) return
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
      if (payload?.sessionId !== sessionId || !payload.stepId) return
      if (payload.content != null) {
        setStreamingContent((prev) => ({ ...prev, [payload.stepId]: payload.content! }))
      }
    },
    [sessionId]
  )

  const handleStepCompleted = useCallback(
    (payload: StepCompletedPayload) => {
      if (payload?.sessionId !== sessionId || !payload.step?.id) return
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
      if (payload?.sessionId !== sessionId) return
      setTerminalStatus("completed")
    },
    [sessionId]
  )

  const handleFailed = useCallback(
    (payload: SessionTerminalPayload) => {
      if (payload?.sessionId !== sessionId) return
      setTerminalStatus("failed")
    },
    [sessionId]
  )

  // Subscribe to session room and listen for events
  // CRITICAL: Subscription must complete BEFORE query is enabled to avoid race conditions
  useEffect(() => {
    if (!socket || !workspaceId || !sessionId) return

    const room = `ws:${workspaceId}:agent_session:${sessionId}`
    let isCancelled = false

    // Reset state for new session
    setRealtimeSteps(new Map())
    setStreamingContent({})
    setTerminalStatus(null)
    setIsSubscribed(false)
    setIsSubscribing(true)
    setSubscriptionError(null)

    // Set up event listeners
    socket.on("agent_session:step:started", handleStepStarted)
    socket.on("agent_session:step:progress", handleStepProgress)
    socket.on("agent_session:step:completed", handleStepCompleted)
    socket.on("agent_session:completed", handleCompleted)
    socket.on("agent_session:failed", handleFailed)

    // Subscribe to session room FIRST and only fetch bootstrap after join ack.
    void joinRoomWithAck(socket, room)
      .then(() => {
        if (isCancelled) return
        setIsSubscribed(true)
      })
      .catch((error: unknown) => {
        if (isCancelled) return
        const joinError = error instanceof Error ? error : new Error("Failed to subscribe to session room")
        console.error(
          `[AgentTrace] Failed to receive join ack for ${room}; continuing with bootstrap fetch and realtime listeners`,
          joinError
        )
        setSubscriptionError(joinError)
        setIsSubscribed(true)
      })
      .finally(() => {
        if (isCancelled) return
        setIsSubscribing(false)
      })

    return () => {
      isCancelled = true
      setIsSubscribed(false)
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
    isLoading: isSubscribing || isQueryLoading,
    error: (queryError as Error | null) ?? (data ? null : subscriptionError),
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
