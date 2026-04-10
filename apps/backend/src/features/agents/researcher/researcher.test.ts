import { describe, expect, test, mock } from "bun:test"
import { WorkspaceAgent, type WorkspaceAgentDeps } from "./researcher"
import type { Pool } from "pg"
import type { AI } from "../../../lib/ai/ai"
import type { ConfigResolver } from "../../../lib/ai/config-resolver"
import type { EmbeddingServiceLike } from "../../memos"

/**
 * Build a stub WorkspaceAgent dep set sufficient to exercise the abort-before-work
 * path. The pool's `connect` is never reached on the abort path, so we can leave
 * most fields as no-op stubs.
 */
function buildAgent(): WorkspaceAgent {
  const ai = {} as AI
  const configResolver = {
    resolve: mock(async () => ({
      modelId: "openrouter:anthropic/claude-haiku-4.5",
      temperature: 0.1,
      maxIterations: 2,
    })),
  } as unknown as ConfigResolver
  const embeddingService = {
    embed: mock(async () => []),
  } as unknown as EmbeddingServiceLike
  const pool = {
    connect: mock(async () => {
      throw new Error("pool.connect should not be called when aborted before work")
    }),
  } as unknown as Pool

  const deps: WorkspaceAgentDeps = { pool, ai, configResolver, embeddingService }
  return new WorkspaceAgent(deps)
}

describe("WorkspaceAgent abort/deadline checkpoints", () => {
  test("returns partial result with user_abort reason when signal is already aborted", async () => {
    const agent = buildAgent()
    const controller = new AbortController()
    controller.abort()

    const result = await agent.search({
      workspaceId: "ws_1",
      streamId: "stream_1",
      query: "What did we decide?",
      conversationHistory: [],
      invokingUserId: "user_1",
      signal: controller.signal,
    })

    expect(result.partial).toBe(true)
    expect(result.partialReason).toBe("user_abort")
    expect(result.memos).toHaveLength(0)
    expect(result.messages).toHaveLength(0)
  })

  test("returns partial result with timeout reason when deadlineAt has already passed", async () => {
    const agent = buildAgent()

    const result = await agent.search({
      workspaceId: "ws_1",
      streamId: "stream_1",
      query: "What did we decide?",
      conversationHistory: [],
      invokingUserId: "user_1",
      deadlineAt: Date.now() - 1, // already past
    })

    expect(result.partial).toBe(true)
    expect(result.partialReason).toBe("timeout")
  })

  test("partial result includes the access-check substep", async () => {
    const agent = buildAgent()
    const controller = new AbortController()
    controller.abort()

    const result = await agent.search({
      workspaceId: "ws_1",
      streamId: "stream_1",
      query: "What did we decide?",
      conversationHistory: [],
      invokingUserId: "user_1",
      signal: controller.signal,
    })

    // The first emitSubstep call ("Checking workspace access…") fires before the
    // abort check, so it's recorded. Then buildPartialResult appends the "Stopped…"
    // substep. We expect both.
    expect(result.substeps.length).toBeGreaterThanOrEqual(2)
    expect(result.substeps[0]?.text).toContain("Checking workspace access")
    expect(result.substeps.at(-1)?.text).toContain("Stopped on user request")
  })

  test("emits substeps via the onSubstep callback in lockstep with the persistent log", async () => {
    const agent = buildAgent()
    const controller = new AbortController()
    controller.abort()
    const onSubstep = mock((_text: string) => {})

    const result = await agent.search({
      workspaceId: "ws_1",
      streamId: "stream_1",
      query: "q",
      conversationHistory: [],
      invokingUserId: "user_1",
      signal: controller.signal,
      onSubstep,
    })

    // The "Checking workspace access…" substep is emitted via the helper,
    // which calls onSubstep AND pushes to the log. The "Stopped…" substep
    // is appended only to the log (not via onSubstep) because the loop is
    // already exiting at that point.
    expect(onSubstep).toHaveBeenCalledTimes(1)
    expect(onSubstep.mock.calls[0]?.[0]).toContain("Checking workspace access")
    expect(result.substeps[0]?.text).toBe(onSubstep.mock.calls[0]?.[0])
  })

  test("makePerCallSignal clamps per-call timeout to remaining deadline (Greptile regression)", async () => {
    // Regression for PR #333 Greptile finding: planRetrieval/evaluateResults were
    // casting { signal } as WorkspaceAgentInput, dropping deadlineAt and letting the
    // full per-call cap apply even when the total budget was nearly exhausted.
    const agent = buildAgent()

    // Reach the now-internal-API helper. This is a deliberate white-box test of the
    // deadline-clamping contract — the public path (planRetrieval/evaluateResults)
    // requires a full pool+AI stub to exercise.
    const makePerCallSignal = (
      agent as unknown as {
        makePerCallSignal: (
          p: { signal: AbortSignal | undefined; deadlineAt: number | undefined },
          perCallMs: number
        ) => { signal: AbortSignal; cleanup: () => void }
      }
    ).makePerCallSignal.bind(agent)

    // deadlineAt is 50ms from now; perCallMs is 30_000. Effective timeout should
    // clamp to ~50ms, not 30_000ms.
    const deadlineAt = Date.now() + 50
    const { signal, cleanup } = makePerCallSignal({ signal: undefined, deadlineAt }, 30_000)

    try {
      expect(signal.aborted).toBe(false)
      // Wait past the deadline — the composed signal should fire.
      await new Promise((resolve) => setTimeout(resolve, 120))
      expect(signal.aborted).toBe(true)
    } finally {
      cleanup()
    }
  })

  test("makePerCallSignal fires synchronously when deadline is already past", () => {
    const agent = buildAgent()
    const makePerCallSignal = (
      agent as unknown as {
        makePerCallSignal: (
          p: { signal: AbortSignal | undefined; deadlineAt: number | undefined },
          perCallMs: number
        ) => { signal: AbortSignal; cleanup: () => void }
      }
    ).makePerCallSignal.bind(agent)

    const { signal, cleanup } = makePerCallSignal({ signal: undefined, deadlineAt: Date.now() - 100 }, 30_000)
    try {
      expect(signal.aborted).toBe(true)
    } finally {
      cleanup()
    }
  })

  test("non-aborted, non-timed-out call proceeds past the early checkpoint", async () => {
    // Use a pool stub that throws a recognizable error AFTER the abort check —
    // this proves the abort gate is permissive when no abort/deadline is set.
    const ai = {} as AI
    const configResolver = {
      resolve: mock(async () => ({
        modelId: "openrouter:anthropic/claude-haiku-4.5",
        temperature: 0.1,
        maxIterations: 2,
      })),
    } as unknown as ConfigResolver
    const embeddingService = {} as unknown as EmbeddingServiceLike
    const pool = {
      connect: mock(async () => {
        throw new Error("REACHED_POOL")
      }),
    } as unknown as Pool

    const agent = new WorkspaceAgent({ pool, ai, configResolver, embeddingService })

    let caught: unknown
    try {
      await agent.search({
        workspaceId: "ws_1",
        streamId: "stream_1",
        query: "q",
        conversationHistory: [],
        invokingUserId: "user_1",
      })
    } catch (err) {
      caught = err
    }

    expect((caught as Error)?.message).toContain("REACHED_POOL")
  })
})
