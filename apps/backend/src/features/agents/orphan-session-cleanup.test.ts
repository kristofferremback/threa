import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { AgentSessionRepository, SessionStatuses, type AgentSession } from "./session-repository"
import { GeneralResearchRepository } from "./general-researcher"
import { createOrphanSessionCleanup } from "./orphan-session-cleanup"

function runningSession(): AgentSession {
  return {
    id: "session_1",
    streamId: "stream_1",
    personaId: "persona_1",
    triggerMessageId: "msg_1",
    triggerMessageRevision: null,
    supersedesSessionId: null,
    status: SessionStatuses.RUNNING,
    currentStep: 1,
    currentStepType: null,
    serverId: "server_1",
    heartbeatAt: new Date("2026-04-25T12:00:00.000Z"),
    responseMessageId: null,
    error: null,
    lastSeenSequence: 1n,
    sentMessageIds: [],
    contextMessageIds: [],
    createdAt: new Date("2026-04-25T12:00:00.000Z"),
    completedAt: null,
  }
}

describe("createOrphanSessionCleanup", () => {
  afterEach(() => {
    mock.restore()
  })

  it("does not fail stale sessions that have an active resumable general research run", async () => {
    const pool = {} as never
    spyOn(AgentSessionRepository, "findOrphaned").mockResolvedValue([runningSession()])
    const listActiveRuns = spyOn(GeneralResearchRepository, "listActiveRunSessionIds").mockResolvedValue(
      new Set(["session_1"])
    )
    const updateStatus = spyOn(AgentSessionRepository, "updateStatus").mockResolvedValue(runningSession())

    const cleanup = createOrphanSessionCleanup(pool, { intervalMs: 60_000, staleThresholdSeconds: 1 })
    await cleanup.runOnce()

    expect(listActiveRuns).toHaveBeenCalledWith(pool, ["session_1"])
    expect(updateStatus).not.toHaveBeenCalled()
  })

  it("still fails stale sessions without active resumable research", async () => {
    const pool = {} as never
    spyOn(AgentSessionRepository, "findOrphaned").mockResolvedValue([runningSession()])
    spyOn(GeneralResearchRepository, "listActiveRunSessionIds").mockResolvedValue(new Set())
    const updateStatus = spyOn(AgentSessionRepository, "updateStatus").mockResolvedValue(runningSession())

    const cleanup = createOrphanSessionCleanup(pool, { intervalMs: 60_000, staleThresholdSeconds: 1 })
    await cleanup.runOnce()

    expect(updateStatus).toHaveBeenCalledWith(
      pool,
      "session_1",
      SessionStatuses.FAILED,
      expect.objectContaining({ error: "Session orphaned (stale heartbeat)" })
    )
  })

  it("does not fail sessions when research state cannot be checked", async () => {
    const pool = {} as never
    spyOn(AgentSessionRepository, "findOrphaned").mockResolvedValue([runningSession()])
    spyOn(GeneralResearchRepository, "listActiveRunSessionIds").mockRejectedValue(new Error("db unavailable"))
    const updateStatus = spyOn(AgentSessionRepository, "updateStatus").mockResolvedValue(runningSession())

    const cleanup = createOrphanSessionCleanup(pool, { intervalMs: 60_000, staleThresholdSeconds: 1 })
    await cleanup.runOnce()

    expect(updateStatus).not.toHaveBeenCalled()
  })
})
