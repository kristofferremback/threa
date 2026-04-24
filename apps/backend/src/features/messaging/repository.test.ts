import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { MessageRepository } from "./repository"

function makeMessage(overrides: Record<string, any> = {}): any {
  return {
    id: "msg_root",
    streamId: "stream_parent",
    sequence: 1n,
    authorId: "usr_author",
    authorType: "user",
    contentMarkdown: "originating message",
    contentJson: { type: "doc", content: [] },
    replyCount: 0,
    clientMessageId: null,
    sentVia: null,
    reactions: {},
    metadata: {},
    editedAt: null,
    deletedAt: null,
    createdAt: new Date(),
    ...overrides,
  }
}

describe("MessageRepository.findThreadRoot", () => {
  afterEach(() => mock.restore())

  it("returns null when the stream has no parentMessageId", async () => {
    // Non-thread streams (channels, scratchpads, DMs) short-circuit before
    // any DB round-trip — findById must not even be consulted.
    const findById = spyOn(MessageRepository, "findById").mockResolvedValue(makeMessage())

    const result = await MessageRepository.findThreadRoot({} as any, { parentMessageId: null })

    expect(result).toBeNull()
    expect(findById).not.toHaveBeenCalled()
  })

  it("returns the parent message for a thread with a live root", async () => {
    spyOn(MessageRepository, "findById").mockResolvedValue(makeMessage({ id: "msg_root" }))

    const result = await MessageRepository.findThreadRoot({} as any, { parentMessageId: "msg_root" })

    expect(result?.id).toBe("msg_root")
  })

  it("returns null for hard-deleted roots (findById returns null)", async () => {
    spyOn(MessageRepository, "findById").mockResolvedValue(null)

    const result = await MessageRepository.findThreadRoot({} as any, { parentMessageId: "msg_gone" })

    expect(result).toBeNull()
  })

  it("returns null for soft-deleted roots (findById returns a row with deletedAt set)", async () => {
    // Contract: the helper is the one place that filters soft-deletes so every
    // thread-context pipeline gets the same protection. If this behavior
    // regresses, a user who deletes the message that spawned a thread will see
    // its original content leak back into the AI prompt on every subsequent
    // Discuss-with-Ariadne invocation against that thread.
    spyOn(MessageRepository, "findById").mockResolvedValue(
      makeMessage({ id: "msg_deleted", deletedAt: new Date("2026-04-20T10:00:00Z") })
    )

    const result = await MessageRepository.findThreadRoot({} as any, { parentMessageId: "msg_deleted" })

    expect(result).toBeNull()
  })
})
