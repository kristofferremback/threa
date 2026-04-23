import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { collectSharedMessageIds, hydrateSharedMessageIds, hydrateSharedMessages } from "./hydration"
import { MessageRepository } from "../repository"

afterEach(() => {
  mock.restore()
})

describe("collectSharedMessageIds", () => {
  it("collects messageIds from nested sharedMessage nodes", () => {
    const ids = new Set<string>()
    collectSharedMessageIds(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "hello" }],
          },
          { type: "sharedMessage", attrs: { messageId: "msg_a", streamId: "stream_a" } },
          {
            type: "blockquote",
            content: [{ type: "sharedMessage", attrs: { messageId: "msg_b", streamId: "stream_b" } }],
          },
        ],
      },
      ids
    )
    expect(Array.from(ids).sort()).toEqual(["msg_a", "msg_b"])
  })

  it("ignores nodes that are not sharedMessage", () => {
    const ids = new Set<string>()
    collectSharedMessageIds(
      {
        type: "doc",
        content: [
          {
            type: "quoteReply",
            attrs: { messageId: "msg_quote", streamId: "stream_q" },
          },
        ],
      },
      ids
    )
    expect(ids.size).toBe(0)
  })
})

describe("hydrateSharedMessageIds", () => {
  it("returns an empty map when given no ids", async () => {
    spyOn(MessageRepository, "findByIds").mockResolvedValue(new Map())
    const result = await hydrateSharedMessageIds({} as any, [])
    expect(result).toEqual({})
  })

  it("returns ok-state payloads for live source messages", async () => {
    spyOn(MessageRepository, "findByIds").mockResolvedValue(
      new Map([
        [
          "msg_a",
          {
            id: "msg_a",
            streamId: "stream_source",
            authorId: "usr_1",
            authorType: "user",
            contentJson: { type: "doc", content: [{ type: "paragraph" }] },
            contentMarkdown: "hello",
            editedAt: null,
            createdAt: new Date("2026-01-01"),
            deletedAt: null,
          } as any,
        ],
      ])
    )

    const result = await hydrateSharedMessageIds({} as any, ["msg_a"])
    expect(result.msg_a).toMatchObject({ state: "ok", messageId: "msg_a", streamId: "stream_source" })
  })

  it("returns deleted payloads for soft-deleted sources", async () => {
    const deletedAt = new Date("2026-02-01")
    spyOn(MessageRepository, "findByIds").mockResolvedValue(
      new Map([
        [
          "msg_a",
          {
            id: "msg_a",
            streamId: "stream_source",
            authorId: "usr_1",
            authorType: "user",
            contentJson: { type: "doc" },
            contentMarkdown: "",
            editedAt: null,
            createdAt: new Date("2026-01-01"),
            deletedAt,
          } as any,
        ],
      ])
    )
    const result = await hydrateSharedMessageIds({} as any, ["msg_a"])
    expect(result.msg_a).toEqual({ state: "deleted", messageId: "msg_a", deletedAt })
  })

  it("returns missing payloads for ids that resolve to no row", async () => {
    spyOn(MessageRepository, "findByIds").mockResolvedValue(new Map())
    const result = await hydrateSharedMessageIds({} as any, ["msg_missing"])
    expect(result.msg_missing).toEqual({ state: "missing", messageId: "msg_missing" })
  })
})

describe("hydrateSharedMessages", () => {
  it("scans input messages' contentJson and hydrates referenced ids in one pass", async () => {
    const findByIds = spyOn(MessageRepository, "findByIds").mockResolvedValue(new Map())
    await hydrateSharedMessages({} as any, [
      {
        id: "msg_1",
        contentJson: {
          type: "doc",
          content: [
            { type: "sharedMessage", attrs: { messageId: "msg_a", streamId: "stream_a" } },
            { type: "sharedMessage", attrs: { messageId: "msg_b", streamId: "stream_b" } },
          ],
        },
      } as any,
      {
        id: "msg_2",
        contentJson: {
          type: "doc",
          content: [{ type: "sharedMessage", attrs: { messageId: "msg_a", streamId: "stream_a" } }],
        },
      } as any,
    ])

    expect(findByIds).toHaveBeenCalledTimes(1)
    const ids = (findByIds as any).mock.calls[0][1].sort()
    expect(ids).toEqual(["msg_a", "msg_b"])
  })
})
