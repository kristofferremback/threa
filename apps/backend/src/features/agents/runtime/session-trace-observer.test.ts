import { describe, expect, it, mock } from "bun:test"
import { AgentStepTypes } from "@threa/types"
import { SessionTraceObserver } from "./session-trace-observer"
import type { ActiveStep, SessionTrace } from "../trace-emitter"

/**
 * Lightweight stub for SessionTrace. Tracks calls to startStep, emitSubstep,
 * and the per-step complete/updateSubsteps methods so tests can assert on the
 * new tool:start → tool:progress → tool:complete caching flow.
 */
function createTraceStub() {
  const emitSubstep = mock((_params: { stepType: string; substep: string }) => {})
  const activeStepRegistry: Array<{
    stepId: string
    complete: ReturnType<typeof mock>
    updateSubsteps: ReturnType<typeof mock>
  }> = []

  let nextStepId = 0
  const startStep = mock(async (_params: { stepType: string; content?: string }) => {
    const stepId = `step_${++nextStepId}`
    const complete = mock(async (_args?: unknown) => {})
    const updateSubsteps = mock(async (_substeps: Array<{ text: string; at: string }>) => {})
    const activeStep = { complete, updateSubsteps } as unknown as ActiveStep
    activeStepRegistry.push({ stepId, complete, updateSubsteps })
    return activeStep
  })

  return {
    trace: {
      emitSubstep,
      startStep,
    } as unknown as SessionTrace,
    emitSubstep,
    startStep,
    activeStepRegistry,
  }
}

describe("SessionTraceObserver tool:progress handling", () => {
  it("forwards tool:progress events to trace.emitSubstep when step exists", async () => {
    const { trace, emitSubstep } = createTraceStub()
    const observer = new SessionTraceObserver(trace)

    // Must create the step first via tool:start
    await observer.handle({
      type: "tool:start",
      toolCallId: "tc_1",
      toolName: "workspace_research",
      stepType: AgentStepTypes.WORKSPACE_SEARCH,
      input: {},
    })

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

  it("skips tool:progress when no step exists (hidden tool)", async () => {
    const { trace, emitSubstep } = createTraceStub()
    const observer = new SessionTraceObserver(trace)

    // No preceding tool:start — simulates a hidden tool
    await observer.handle({
      type: "tool:progress",
      toolCallId: "tc_1",
      toolName: "search_messages",
      stepType: AgentStepTypes.WORKSPACE_SEARCH,
      substep: "Searching…",
    })

    expect(emitSubstep).not.toHaveBeenCalled()
  })

  it("does NOT call startStep on tool:progress (step is created at tool:start)", async () => {
    const { trace, startStep } = createTraceStub()
    const observer = new SessionTraceObserver(trace)

    // Create the step first
    await observer.handle({
      type: "tool:start",
      toolCallId: "tc_1",
      toolName: "workspace_research",
      stepType: AgentStepTypes.WORKSPACE_SEARCH,
      input: {},
    })

    await observer.handle({
      type: "tool:progress",
      toolCallId: "tc_1",
      toolName: "workspace_research",
      stepType: AgentStepTypes.WORKSPACE_SEARCH,
      substep: "Searching memos and messages…",
    })

    // startStep was only called once (for tool:start), not again for tool:progress
    expect(startStep).toHaveBeenCalledWith({ stepType: AgentStepTypes.WORKSPACE_SEARCH })
  })

  it("emits multiple substeps in order", async () => {
    const { trace, emitSubstep } = createTraceStub()
    const observer = new SessionTraceObserver(trace)

    // Create the step first
    await observer.handle({
      type: "tool:start",
      toolCallId: "tc_1",
      toolName: "workspace_research",
      stepType: AgentStepTypes.WORKSPACE_SEARCH,
      input: {},
    })

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

    // Verify each substep was emitted with the correct content in order
    expect(emitSubstep.mock.calls[0]?.[0].substep).toBe("Planning queries…")
    expect(emitSubstep.mock.calls[1]?.[0].substep).toBe("Searching memos…")
    expect(emitSubstep.mock.calls[2]?.[0].substep).toBe("Evaluating results…")
  })
})

describe("SessionTraceObserver tool:start → progress → complete caching", () => {
  it("creates the step row on tool:start and finalises it on tool:complete", async () => {
    const { trace, startStep, activeStepRegistry } = createTraceStub()
    const observer = new SessionTraceObserver(trace)

    await observer.handle({
      type: "tool:start",
      toolCallId: "tc_1",
      toolName: "workspace_research",
      stepType: AgentStepTypes.WORKSPACE_SEARCH,
      input: { query: "what did we decide" },
    })

    expect(startStep).toHaveBeenCalledTimes(1)
    expect(startStep).toHaveBeenCalledWith({ stepType: AgentStepTypes.WORKSPACE_SEARCH })

    // tool:complete should finalise the cached step (not create a second one)
    await observer.handle({
      type: "tool:complete",
      toolCallId: "tc_1",
      toolName: "workspace_research",
      input: {},
      output: JSON.stringify({ substeps: [{ text: "Planning…", at: "2026-04-10T12:00:00Z" }] }),
      durationMs: 1500,
      trace: {
        stepType: AgentStepTypes.WORKSPACE_SEARCH,
        content: JSON.stringify({ memoCount: 2, substeps: [{ text: "Planning…", at: "2026-04-10T12:00:00Z" }] }),
      },
    })

    // Still only one startStep call — the cached one was finalised
    expect(startStep).toHaveBeenCalledTimes(1)
    expect(activeStepRegistry).toHaveLength(1)
    expect(activeStepRegistry[0]!.complete).toHaveBeenCalledTimes(1)
  })

  it("persists the running substep log on every tool:progress event", async () => {
    const { trace, activeStepRegistry } = createTraceStub()
    const observer = new SessionTraceObserver(trace)

    await observer.handle({
      type: "tool:start",
      toolCallId: "tc_1",
      toolName: "workspace_research",
      stepType: AgentStepTypes.WORKSPACE_SEARCH,
      input: {},
    })

    await observer.handle({
      type: "tool:progress",
      toolCallId: "tc_1",
      toolName: "workspace_research",
      stepType: AgentStepTypes.WORKSPACE_SEARCH,
      substep: "Planning queries…",
    })
    await observer.handle({
      type: "tool:progress",
      toolCallId: "tc_1",
      toolName: "workspace_research",
      stepType: AgentStepTypes.WORKSPACE_SEARCH,
      substep: "Searching…",
    })

    // updateSubsteps is async/fire-and-forget — wait a macrotask so the
    // pending void promises settle before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0))

    const { updateSubsteps } = activeStepRegistry[0]!
    expect(updateSubsteps).toHaveBeenCalledTimes(2)
    // Each call should carry the cumulative list
    const firstCall = updateSubsteps.mock.calls[0]?.[0] as Array<{ text: string; at: string }>
    const secondCall = updateSubsteps.mock.calls[1]?.[0] as Array<{ text: string; at: string }>
    expect(firstCall.map((s) => s.text)).toEqual(["Planning queries…"])
    expect(secondCall.map((s) => s.text)).toEqual(["Planning queries…", "Searching…"])
  })

  it("skips tool:complete when no cached step exists (hidden tool)", async () => {
    const { trace, startStep, activeStepRegistry } = createTraceStub()
    const observer = new SessionTraceObserver(trace)

    // No preceding tool:start — the tool was hidden so no step was created
    await observer.handle({
      type: "tool:complete",
      toolCallId: "tc_hidden",
      toolName: "search_messages",
      input: {},
      output: "{}",
      durationMs: 100,
      trace: {
        stepType: AgentStepTypes.WORKSPACE_SEARCH,
        content: "{}",
      },
    })

    // No step created, no complete called
    expect(startStep).not.toHaveBeenCalled()
    expect(activeStepRegistry).toHaveLength(0)
  })

  it("finalises the cached step with error content on tool:error", async () => {
    const { trace, startStep, activeStepRegistry } = createTraceStub()
    const observer = new SessionTraceObserver(trace)

    await observer.handle({
      type: "tool:start",
      toolCallId: "tc_1",
      toolName: "workspace_research",
      stepType: AgentStepTypes.WORKSPACE_SEARCH,
      input: {},
    })

    await observer.handle({
      type: "tool:error",
      toolCallId: "tc_1",
      toolName: "workspace_research",
      error: "boom",
      durationMs: 50,
    })

    // Cached step was finalised — no second startStep
    expect(startStep).toHaveBeenCalledTimes(1)
    expect(activeStepRegistry[0]!.complete).toHaveBeenCalledTimes(1)
    const args = activeStepRegistry[0]!.complete.mock.calls[0]?.[0] as { content?: string }
    expect(args.content).toContain("boom")
  })

  it("skips tool:error when tool was hidden", async () => {
    const { trace, startStep, activeStepRegistry } = createTraceStub()
    const observer = new SessionTraceObserver(trace)

    // Hidden tool:start registers the toolCallId so tool:error knows to skip
    await observer.handle({
      type: "tool:start",
      toolCallId: "tc_hidden",
      toolName: "search_users",
      stepType: AgentStepTypes.WORKSPACE_SEARCH,
      input: {},
      hidden: true,
    })

    await observer.handle({
      type: "tool:error",
      toolCallId: "tc_hidden",
      toolName: "search_users",
      error: "boom",
      durationMs: 50,
    })

    expect(startStep).not.toHaveBeenCalled()
    expect(activeStepRegistry).toHaveLength(0)
  })

  it("creates synthetic TOOL_ERROR step for unknown tool errors (no preceding tool:start)", async () => {
    const { trace, startStep, activeStepRegistry } = createTraceStub()
    const observer = new SessionTraceObserver(trace)

    // No tool:start — simulates the runtime's unknown-tool path
    await observer.handle({
      type: "tool:error",
      toolCallId: "tc_unknown",
      toolName: "nonexistent_tool",
      error: "Unknown tool: nonexistent_tool",
      durationMs: 0,
    })

    // Fallback: synthetic TOOL_ERROR step created
    expect(startStep).toHaveBeenCalledWith({
      stepType: AgentStepTypes.TOOL_ERROR,
      content: "nonexistent_tool failed: Unknown tool: nonexistent_tool",
    })
    expect(activeStepRegistry[0]!.complete).toHaveBeenCalled()
  })
})

describe("SessionTraceObserver hidden tool support", () => {
  it("skips step creation for tool:start with hidden flag", async () => {
    const { trace, startStep } = createTraceStub()
    const observer = new SessionTraceObserver(trace)

    await observer.handle({
      type: "tool:start",
      toolCallId: "tc_1",
      toolName: "search_messages",
      stepType: AgentStepTypes.WORKSPACE_SEARCH,
      input: { query: "test" },
      hidden: true,
    })

    expect(startStep).not.toHaveBeenCalled()
  })

  it("full lifecycle of a hidden tool creates no user-facing steps", async () => {
    const { trace, startStep, emitSubstep, activeStepRegistry } = createTraceStub()
    const observer = new SessionTraceObserver(trace)

    await observer.handle({
      type: "tool:start",
      toolCallId: "tc_1",
      toolName: "search_messages",
      stepType: AgentStepTypes.WORKSPACE_SEARCH,
      input: { query: "test" },
      hidden: true,
    })

    await observer.handle({
      type: "tool:complete",
      toolCallId: "tc_1",
      toolName: "search_messages",
      input: { query: "test" },
      output: JSON.stringify({ results: [] }),
      durationMs: 200,
      trace: {
        stepType: AgentStepTypes.WORKSPACE_SEARCH,
        content: JSON.stringify({ tool: "search_messages", query: "test" }),
      },
    })

    expect(startStep).not.toHaveBeenCalled()
    expect(emitSubstep).not.toHaveBeenCalled()
    expect(activeStepRegistry).toHaveLength(0)
  })

  it("non-hidden tools still create steps normally", async () => {
    const { trace, startStep, activeStepRegistry } = createTraceStub()
    const observer = new SessionTraceObserver(trace)

    await observer.handle({
      type: "tool:start",
      toolCallId: "tc_1",
      toolName: "workspace_research",
      stepType: AgentStepTypes.WORKSPACE_SEARCH,
      input: { query: "test" },
      // hidden not set — defaults to visible
    })

    expect(startStep).toHaveBeenCalledTimes(1)

    await observer.handle({
      type: "tool:complete",
      toolCallId: "tc_1",
      toolName: "workspace_research",
      input: { query: "test" },
      output: "{}",
      durationMs: 1000,
      trace: {
        stepType: AgentStepTypes.WORKSPACE_SEARCH,
        content: JSON.stringify({ memoCount: 2, messageCount: 5 }),
      },
    })

    expect(activeStepRegistry[0]!.complete).toHaveBeenCalledTimes(1)
  })
})
