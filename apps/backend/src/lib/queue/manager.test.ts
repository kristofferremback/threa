import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { QueueManager } from "./manager"
import { logger } from "../logger"
import { registry } from "../observability"

function createManager(queueInsert: (...args: any[]) => Promise<unknown>) {
  return new QueueManager({
    pool: {} as any,
    queueRepository: {
      insert: queueInsert,
    } as any,
    tokenPoolRepository: {} as any,
  })
}

afterEach(() => {
  registry.resetMetrics()
})

describe("QueueManager.send", () => {
  it("returns the provided message ID when duplicate idempotent send races", async () => {
    const duplicateError = Object.assign(new Error("duplicate"), {
      code: "23505",
      constraint: "queue_messages_pkey",
    })
    const insert = mock(async () => {
      throw duplicateError
    })
    const manager = createManager(insert)

    const messageId = await manager.send(
      "persona.agent" as any,
      {
        workspaceId: "ws_1",
      } as any,
      {
        messageId: "queue_rerun_session_1",
      }
    )

    expect(messageId).toBe("queue_rerun_session_1")
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it("rethrows duplicate key errors when no idempotency message ID is provided", async () => {
    const duplicateError = Object.assign(new Error("duplicate"), {
      code: "23505",
      constraint: "queue_messages_pkey",
    })
    const insert = mock(async () => {
      throw duplicateError
    })
    const manager = createManager(insert)

    await expect(
      manager.send(
        "persona.agent" as any,
        {
          workspaceId: "ws_1",
        } as any
      )
    ).rejects.toThrow("duplicate")
  })
})

describe("QueueManager stuck token warning", () => {
  it("warns and records a metric when a token exceeds the stuck threshold", async () => {
    let releaseHandler: () => void = () => {}
    const blockedHandler = new Promise<void>((resolve) => {
      releaseHandler = resolve
    })

    const handler = mock(async () => {
      await blockedHandler
    })
    const warnSpy = spyOn(logger, "warn")
    const deleteToken = mock(async () => {})

    const manager = new QueueManager({
      pool: {} as any,
      queueRepository: {
        batchClaimMessages: mock(async () => [
          {
            id: "queue_msg_1",
            queueName: "persona.agent",
            workspaceId: "ws_1",
            payload: { workspaceId: "ws_1" },
            failedCount: 0,
            insertedAt: new Date(),
          },
        ]),
        batchRenewClaims: mock(async () => 1),
        complete: mock(async () => {}),
      } as any,
      tokenPoolRepository: {
        renewLease: mock(async () => true),
        deleteToken,
      } as any,
      stuckTokenWarnMs: 20,
      refreshIntervalMs: 1000,
    })

    manager.registerHandler("persona.agent" as any, handler as any)

    const tokenPromise = (manager as any).processToken({
      id: "token_1",
      queueName: "persona.agent",
      workspaceId: "ws_1",
    })

    try {
      await new Promise((resolve) => setTimeout(resolve, 50))

      const metricsOutput = await registry.metrics()
      expect(metricsOutput).toContain('queue_tokens_stuck_total{queue="persona.agent",workspace_id="ws_1"} 1')

      const stuckWarning = warnSpy.mock.calls.find((call) => call[1] === "Queue token exceeded stuck warning threshold")
      expect(stuckWarning).toBeDefined()
    } finally {
      releaseHandler()
      await tokenPromise
      warnSpy.mockRestore()
    }

    expect(deleteToken).toHaveBeenCalledTimes(1)
  })
})
