import { describe, expect, it, mock } from "bun:test"
import { AgentStepTypes } from "@threa/types"
import { SessionTraceObserver } from "./session-trace-observer"
import type { SessionTrace } from "../trace-emitter"

/**
 * Lightweight stub for SessionTrace — just enough for the observer's tool:progress
 * branch. Other branches are exercised by existing trace-emitter tests.
 */
function createTraceStub() {
  const emitSubstep = mock((_params: { stepType: string; substep: string }) => {})
  const startStep = mock(async () => ({
    complete: mock(async () => {}),
  }))
  return {
    trace: {
      emitSubstep,
      startStep,
    } as unknown as SessionTrace,
    emitSubstep,
    startStep,
  }
}

describe("SessionTraceObserver tool:progress handling", () => {
  it("forwards tool:progress events to trace.emitSubstep", async () => {
    const { trace, emitSubstep } = createTraceStub()
    const observer = new SessionTraceObserver(trace)

    await observer.handle({
      type: "tool:progress",
      toolCallId: "tc_1",
      toolName: "workspace_research",
      stepType: AgentStepTypes.WORKSPACE_SEARCH,
      substep: "Planning queries…",
    })

    expect(emitSubstep).toHaveBeenCalledTimes(1)
    expect(emitSubstep).toHaveBeenCalledWith({
      stepType: AgentStepTypes.WORKSPACE_SEARCH,
      substep: "Planning queries…",
    })
  })

  it("does NOT call startStep on tool:progress (substeps are ephemeral)", async () => {
    const { trace, startStep } = createTraceStub()
    const observer = new SessionTraceObserver(trace)

    await observer.handle({
      type: "tool:progress",
      toolCallId: "tc_1",
      toolName: "workspace_research",
      stepType: AgentStepTypes.WORKSPACE_SEARCH,
      substep: "Searching memos and messages…",
    })

    expect(startStep).not.toHaveBeenCalled()
  })

  it("emits multiple substeps in order", async () => {
    const { trace, emitSubstep } = createTraceStub()
    const observer = new SessionTraceObserver(trace)

    const substeps = ["Planning queries…", "Searching memos…", "Evaluating results…"]
    for (const substep of substeps) {
      await observer.handle({
        type: "tool:progress",
        toolCallId: "tc_1",
        toolName: "workspace_research",
        stepType: AgentStepTypes.WORKSPACE_SEARCH,
        substep,
      })
    }

    expect(emitSubstep).toHaveBeenCalledTimes(3)
    expect(emitSubstep.mock.calls[0]?.[0].substep).toBe("Planning queries…")
    expect(emitSubstep.mock.calls[1]?.[0].substep).toBe("Searching memos…")
    expect(emitSubstep.mock.calls[2]?.[0].substep).toBe("Evaluating results…")
  })
})
