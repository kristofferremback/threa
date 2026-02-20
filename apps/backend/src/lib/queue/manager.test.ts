import { describe, expect, it, mock } from "bun:test"
import { QueueManager } from "./manager"

function createManager(queueInsert: (...args: any[]) => Promise<unknown>) {
  return new QueueManager({
    pool: {} as any,
    queueRepository: {
      insert: queueInsert,
    } as any,
    tokenPoolRepository: {} as any,
  })
}

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
