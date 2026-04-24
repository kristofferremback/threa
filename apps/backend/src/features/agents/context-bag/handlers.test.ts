import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { ContextIntents, ContextRefKinds } from "@threa/types"
import { createContextBagHandlers } from "./handlers"
import * as precomputeService from "./precompute-service"

function mockReq(body: unknown) {
  return {
    user: { id: "usr_1" },
    workspaceId: "ws_1",
    body,
  } as never
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(data: unknown) {
      res.body = data
      return res
    },
  }
  return res as never
}

describe("createContextBagHandlers.precompute", () => {
  afterEach(() => {
    mock.restore()
  })

  it("delegates a valid payload to precomputeRefSummaries and returns the results", async () => {
    const precomputeSpy = spyOn(precomputeService, "precomputeRefSummaries").mockResolvedValue([
      {
        kind: ContextRefKinds.THREAD,
        refKey: "thread:stream_src",
        fingerprint: "fp_1",
        tailMessageId: "msg_9",
        status: "ready",
        itemCount: 10,
        inlineChars: 10000,
      },
    ])

    const handlers = createContextBagHandlers({ pool: {} as any, ai: {} as any })
    const req = mockReq({
      intent: ContextIntents.DISCUSS_THREAD,
      refs: [{ kind: ContextRefKinds.THREAD, streamId: "stream_src" }],
    })
    const res = mockRes() as any
    await handlers.precompute(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      refs: [
        {
          kind: ContextRefKinds.THREAD,
          refKey: "thread:stream_src",
          fingerprint: "fp_1",
          tailMessageId: "msg_9",
          status: "ready",
          itemCount: 10,
          inlineChars: 10000,
        },
      ],
    })
    expect(precomputeSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: "ws_1",
        userId: "usr_1",
        intent: ContextIntents.DISCUSS_THREAD,
      })
    )
  })

  it("returns 400 when the body is missing required fields", async () => {
    const precomputeSpy = spyOn(precomputeService, "precomputeRefSummaries")

    const handlers = createContextBagHandlers({ pool: {} as any, ai: {} as any })
    const req = mockReq({ intent: ContextIntents.DISCUSS_THREAD })
    const res = mockRes() as any
    await handlers.precompute(req, res)

    expect(res.statusCode).toBe(400)
    expect(res.body).toMatchObject({ error: "Validation failed" })
    expect(precomputeSpy).not.toHaveBeenCalled()
  })

  it("returns 400 when refs is empty", async () => {
    const precomputeSpy = spyOn(precomputeService, "precomputeRefSummaries")

    const handlers = createContextBagHandlers({ pool: {} as any, ai: {} as any })
    const req = mockReq({ intent: ContextIntents.DISCUSS_THREAD, refs: [] })
    const res = mockRes() as any
    await handlers.precompute(req, res)

    expect(res.statusCode).toBe(400)
    expect(precomputeSpy).not.toHaveBeenCalled()
  })

  it("returns 400 when a ref has an unknown kind", async () => {
    const precomputeSpy = spyOn(precomputeService, "precomputeRefSummaries")

    const handlers = createContextBagHandlers({ pool: {} as any, ai: {} as any })
    const req = mockReq({
      intent: ContextIntents.DISCUSS_THREAD,
      refs: [{ kind: "memo", memoId: "memo_1" }],
    })
    const res = mockRes() as any
    await handlers.precompute(req, res)

    expect(res.statusCode).toBe(400)
    expect(precomputeSpy).not.toHaveBeenCalled()
  })
})
