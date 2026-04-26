import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { ContextIntents, ContextRefKinds, type ContextRef } from "@threa/types"
import { precomputeRefSummaries } from "./precompute-service"
import { ThreadResolver } from "./resolvers/thread-resolver"
import { SummaryRepository } from "./summary-repository"
import * as dbModule from "../../../db"

function makeItems(count: number, chars: number) {
  return Array.from({ length: count }, (_, i) => ({
    messageId: `msg_${i}`,
    authorId: "usr_1",
    authorName: "Alice",
    contentMarkdown: "x".repeat(chars),
    createdAt: "2026-04-22T09:00:00Z",
    editedAt: null,
    sequence: BigInt(i),
  }))
}

function makeAi(generateImpl?: () => Promise<{ value: string }>) {
  return {
    generateText: mock(generateImpl ?? (async () => ({ value: "summary text" }))),
    parseModel: mock(() => ({ modelId: "m", modelProvider: "p", modelName: "n" })),
  } as any
}

function stubWithClient() {
  // `withClient` acquires a PoolClient and releases on return. For tests we
  // just pass the pool through — resolvers call `db.query(...)` which
  // pg.Pool and pg.PoolClient both implement.
  spyOn(dbModule, "withClient").mockImplementation(async (pool: any, fn: any) => fn(pool))
}

describe("precomputeRefSummaries", () => {
  afterEach(() => {
    mock.restore()
  })

  it("returns status=inline and writes no summary when content fits under the intent threshold", async () => {
    stubWithClient()
    spyOn(ThreadResolver, "assertAccess").mockResolvedValue(undefined)
    spyOn(ThreadResolver, "fetch").mockResolvedValue({
      items: makeItems(2, 100),
      inputs: [
        { messageId: "msg_0", contentFingerprint: "f0", editedAt: null, deleted: false },
        { messageId: "msg_1", contentFingerprint: "f1", editedAt: null, deleted: false },
      ],
      fingerprint: "fp_small",
      tailMessageId: "msg_1",
    })
    const upsert = spyOn(SummaryRepository, "upsert")
    const find = spyOn(SummaryRepository, "find")

    const ai = makeAi()
    const refs: ContextRef[] = [{ kind: ContextRefKinds.THREAD, streamId: "stream_src" }]
    const results = await precomputeRefSummaries(
      { pool: {} as any, ai },
      { workspaceId: "ws_1", userId: "usr_1", intent: ContextIntents.DISCUSS_THREAD, refs }
    )

    expect(results).toHaveLength(1)
    expect(results[0].status).toBe("inline")
    expect(results[0].refKey).toBe("thread:stream_src")
    expect(results[0].fingerprint).toBe("fp_small")
    expect(results[0].itemCount).toBe(2)
    expect(upsert).not.toHaveBeenCalled()
    expect(find).not.toHaveBeenCalled()
    expect(ai.generateText).not.toHaveBeenCalled()
  })

  it("returns status=ready and upserts a summary when content exceeds the inline threshold", async () => {
    stubWithClient()
    spyOn(ThreadResolver, "assertAccess").mockResolvedValue(undefined)
    // 10 × 1000 chars = 10,000, well over the 8000 threshold.
    spyOn(ThreadResolver, "fetch").mockResolvedValue({
      items: makeItems(10, 1000),
      inputs: Array.from({ length: 10 }, (_, i) => ({
        messageId: `msg_${i}`,
        contentFingerprint: `f${i}`,
        editedAt: null,
        deleted: false,
      })),
      fingerprint: "fp_big",
      tailMessageId: "msg_9",
    })
    spyOn(SummaryRepository, "find").mockResolvedValue(null)
    const upsert = spyOn(SummaryRepository, "upsert").mockResolvedValue({
      id: "cs_1",
      workspaceId: "ws_1",
      refKind: ContextRefKinds.THREAD,
      refKey: "thread:stream_src",
      fingerprint: "fp_big",
      inputs: [],
      summaryText: "generated summary",
      model: "openrouter:openai/gpt-5.4-nano",
      createdAt: new Date(),
    })

    const ai = makeAi()
    const refs: ContextRef[] = [{ kind: ContextRefKinds.THREAD, streamId: "stream_src" }]
    const results = await precomputeRefSummaries(
      { pool: {} as any, ai },
      { workspaceId: "ws_1", userId: "usr_1", intent: ContextIntents.DISCUSS_THREAD, refs }
    )

    expect(results[0].status).toBe("ready")
    expect(ai.generateText).toHaveBeenCalledTimes(1)
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it("reuses a cached summary when the fingerprint already has a row (no AI call)", async () => {
    stubWithClient()
    spyOn(ThreadResolver, "assertAccess").mockResolvedValue(undefined)
    spyOn(ThreadResolver, "fetch").mockResolvedValue({
      items: makeItems(10, 1000),
      inputs: Array.from({ length: 10 }, (_, i) => ({
        messageId: `msg_${i}`,
        contentFingerprint: `f${i}`,
        editedAt: null,
        deleted: false,
      })),
      fingerprint: "fp_cached",
      tailMessageId: "msg_9",
    })
    spyOn(SummaryRepository, "find").mockResolvedValue({
      id: "cs_cached",
      workspaceId: "ws_1",
      refKind: ContextRefKinds.THREAD,
      refKey: "thread:stream_src",
      fingerprint: "fp_cached",
      inputs: [],
      summaryText: "warm summary",
      model: "openrouter:openai/gpt-5.4-nano",
      createdAt: new Date(),
    })
    const upsert = spyOn(SummaryRepository, "upsert")

    const ai = makeAi()
    const refs: ContextRef[] = [{ kind: ContextRefKinds.THREAD, streamId: "stream_src" }]
    const results = await precomputeRefSummaries(
      { pool: {} as any, ai },
      { workspaceId: "ws_1", userId: "usr_1", intent: ContextIntents.DISCUSS_THREAD, refs }
    )

    expect(results[0].status).toBe("ready")
    expect(ai.generateText).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })

  it("propagates access errors from the resolver (INV-8 boundary)", async () => {
    stubWithClient()
    const err = Object.assign(new Error("No access to context source stream"), {
      status: 403,
      code: "CONTEXT_SOURCE_FORBIDDEN",
    })
    spyOn(ThreadResolver, "assertAccess").mockRejectedValue(err)
    const fetchSpy = spyOn(ThreadResolver, "fetch")

    const ai = makeAi()
    const refs: ContextRef[] = [{ kind: ContextRefKinds.THREAD, streamId: "stream_src" }]

    await expect(
      precomputeRefSummaries(
        { pool: {} as any, ai },
        { workspaceId: "ws_1", userId: "usr_1", intent: ContextIntents.DISCUSS_THREAD, refs }
      )
    ).rejects.toThrow("No access to context source stream")

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("throws CONTEXT_INTENT_KIND_MISMATCH when an intent does not support the ref kind", async () => {
    stubWithClient()
    const assertAccess = spyOn(ThreadResolver, "assertAccess")
    const refs = [{ kind: "memo", memoId: "memo_1" } as unknown as ContextRef]

    const ai = makeAi()
    await expect(
      precomputeRefSummaries(
        { pool: {} as any, ai },
        { workspaceId: "ws_1", userId: "usr_1", intent: ContextIntents.DISCUSS_THREAD, refs }
      )
    ).rejects.toThrow(/does not support ref kind/)
    expect(assertAccess).not.toHaveBeenCalled()
  })

  it("produces one result per ref in request order", async () => {
    stubWithClient()
    spyOn(ThreadResolver, "assertAccess").mockResolvedValue(undefined)
    const fetchSpy = spyOn(ThreadResolver, "fetch")
      .mockResolvedValueOnce({
        items: makeItems(1, 50),
        inputs: [{ messageId: "msg_a", contentFingerprint: "fa", editedAt: null, deleted: false }],
        fingerprint: "fp_a",
        tailMessageId: "msg_a",
      })
      .mockResolvedValueOnce({
        items: makeItems(1, 50),
        inputs: [{ messageId: "msg_b", contentFingerprint: "fb", editedAt: null, deleted: false }],
        fingerprint: "fp_b",
        tailMessageId: "msg_b",
      })

    const ai = makeAi()
    const refs: ContextRef[] = [
      { kind: ContextRefKinds.THREAD, streamId: "stream_a" },
      { kind: ContextRefKinds.THREAD, streamId: "stream_b" },
    ]
    const results = await precomputeRefSummaries(
      { pool: {} as any, ai },
      { workspaceId: "ws_1", userId: "usr_1", intent: ContextIntents.DISCUSS_THREAD, refs }
    )

    expect(results.map((r) => r.refKey)).toEqual(["thread:stream_a", "thread:stream_b"])
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})
