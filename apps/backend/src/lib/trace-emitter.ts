import type { Pool } from "pg"
import type { Server } from "socket.io"
import type { AgentStepType, TraceSource } from "@threa/types"
import { AgentSessionRepository } from "../repositories/agent-session-repository"
import { stepId as generateStepId } from "./id"

interface TraceEmitterDeps {
  io: Server
  pool: Pool
}

/**
 * Injectable service for emitting agent trace events.
 * Handles step lifecycle (start → progress → complete) with:
 * - DB persistence for start and complete (crash-resilient)
 * - Socket emission for real-time UI updates
 * - No held connections (each DB write is a single query via pool)
 */
export class TraceEmitter {
  constructor(private readonly deps: TraceEmitterDeps) {}

  forSession(params: {
    sessionId: string
    workspaceId: string
    streamId: string
    triggerMessageId: string
    personaName: string
    /** For channel mentions: the channel stream ID for inline indicator progress events */
    channelStreamId?: string
  }): SessionTrace {
    return new SessionTrace(this.deps, params)
  }
}

/**
 * Trace handle for a single agent session.
 * Owns step numbering and session-scoped socket rooms.
 */
export class SessionTrace {
  private stepNumber = 0
  private readonly sessionRoom: string
  private readonly streamRoom: string
  private readonly channelRoom: string | null

  constructor(
    private readonly deps: TraceEmitterDeps,
    private readonly params: {
      sessionId: string
      workspaceId: string
      streamId: string
      triggerMessageId: string
      personaName: string
      channelStreamId?: string
    }
  ) {
    this.sessionRoom = `ws:${params.workspaceId}:agent_session:${params.sessionId}`
    this.streamRoom = `ws:${params.workspaceId}:stream:${params.streamId}`
    this.channelRoom = params.channelStreamId ? `ws:${params.workspaceId}:stream:${params.channelStreamId}` : null
  }

  /**
   * Start a step. Persists to DB + emits to socket.
   * Returns an ActiveStep handle for progress/complete.
   */
  async startStep(params: { stepType: AgentStepType; content?: string }): Promise<ActiveStep> {
    this.stepNumber++
    const id = generateStepId()
    const now = new Date()

    // Persist step row (started, not yet completed)
    await AgentSessionRepository.insertStep(this.deps.pool, {
      id,
      sessionId: this.params.sessionId,
      stepNumber: this.stepNumber,
      stepType: params.stepType,
      content: params.content,
      startedAt: now,
    })

    // Update session's current step type for cross-stream display
    await AgentSessionRepository.updateCurrentStepType(this.deps.pool, this.params.sessionId, params.stepType)

    // Emit to session room (detailed, for trace dialog)
    this.deps.io.to(this.sessionRoom).emit("agent_session:step:started", {
      sessionId: this.params.sessionId,
      step: {
        id,
        sessionId: this.params.sessionId,
        stepNumber: this.stepNumber,
        stepType: params.stepType,
        content: params.content,
        startedAt: now.toISOString(),
      },
    })

    // Emit to stream room (lightweight, for timeline card + trigger message indicator)
    // When channelRoom is set, also emit to the channel for the inline indicator
    // Include threadStreamId so frontend can link directly to thread before stream:created arrives
    const progressPayload = {
      workspaceId: this.params.workspaceId,
      streamId: this.params.streamId,
      sessionId: this.params.sessionId,
      triggerMessageId: this.params.triggerMessageId,
      personaName: this.params.personaName,
      stepCount: this.stepNumber,
      currentStepType: params.stepType,
      threadStreamId: this.params.channelStreamId ? this.params.streamId : undefined,
    }
    let target = this.deps.io.to(this.streamRoom)
    if (this.channelRoom) {
      target = target.to(this.channelRoom)
    }
    target.emit("agent_session:progress", progressPayload)

    return new ActiveStep(this.deps, {
      stepId: id,
      sessionId: this.params.sessionId,
      sessionRoom: this.sessionRoom,
    })
  }

  /** Notify session room that session completed. Socket only. */
  notifyCompleted(): void {
    this.deps.io.to(this.sessionRoom).emit("agent_session:completed", {
      sessionId: this.params.sessionId,
    })
  }

  /** Notify session room that session failed. Socket only. */
  notifyFailed(): void {
    this.deps.io.to(this.sessionRoom).emit("agent_session:failed", {
      sessionId: this.params.sessionId,
    })
  }

  /** Notify channel room that agent activity started. For immediate inline indicator. */
  notifyActivityStarted(): void {
    if (!this.channelRoom) return
    // Include threadStreamId (which is this.params.streamId) so frontend can link
    // directly to the thread before the slower stream:created event arrives
    this.deps.io.to(this.channelRoom).emit("agent_session:activity_started", {
      sessionId: this.params.sessionId,
      triggerMessageId: this.params.triggerMessageId,
      personaName: this.params.personaName,
      threadStreamId: this.params.streamId,
    })
  }

  /** Notify channel room that agent activity ended. For inline indicator cleanup. */
  notifyActivityEnded(): void {
    if (!this.channelRoom) return
    this.deps.io.to(this.channelRoom).emit("agent_session:activity_ended", {
      sessionId: this.params.sessionId,
      triggerMessageId: this.params.triggerMessageId,
    })
  }
}

/**
 * Handle for an in-progress step.
 * Supports ephemeral progress updates and final completion.
 */
export class ActiveStep {
  constructor(
    private readonly deps: TraceEmitterDeps,
    private readonly params: {
      stepId: string
      sessionId: string
      sessionRoom: string
    }
  ) {}

  /** Ephemeral progress update. Socket only, not persisted. */
  progress(data: { content?: string }): void {
    this.deps.io.to(this.params.sessionRoom).emit("agent_session:step:progress", {
      sessionId: this.params.sessionId,
      stepId: this.params.stepId,
      content: data.content,
    })
  }

  /** Complete the step. Persists to DB + emits to socket. */
  async complete(params?: { content?: string; sources?: TraceSource[]; messageId?: string }): Promise<void> {
    const now = new Date()

    const updated = await AgentSessionRepository.updateStep(this.deps.pool, this.params.stepId, {
      content: params?.content,
      sources: params?.sources,
      messageId: params?.messageId,
      completedAt: now,
    })

    this.deps.io.to(this.params.sessionRoom).emit("agent_session:step:completed", {
      sessionId: this.params.sessionId,
      step: updated
        ? {
            id: updated.id,
            sessionId: updated.sessionId,
            stepNumber: updated.stepNumber,
            stepType: updated.stepType,
            content: updated.content,
            sources: updated.sources,
            messageId: updated.messageId,
            startedAt: updated.startedAt.toISOString(),
            completedAt: updated.completedAt?.toISOString(),
          }
        : { id: this.params.stepId, completedAt: now.toISOString() },
    })
  }
}
