import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { ContextRefKinds, Visibilities } from "@threa/types"
import { ThreadResolver } from "./thread-resolver"
import { MessageRepository } from "../../../messaging"
import { StreamRepository, StreamMemberRepository } from "../../../streams"
import { UserRepository } from "../../../workspaces"
import { PersonaRepository } from "../../persona-repository"

function makeStream(overrides: Record<string, any> = {}): any {
  return {
    id: "stream_source",
    workspaceId: "ws_1",
    type: "channel",
    visibility: Visibilities.PRIVATE,
    companionMode: "off",
    companionPersonaId: null,
    createdBy: "usr_1",
    createdAt: new Date(),
    updatedAt: new Date(),
    archivedAt: null,
    displayName: null,
    slug: null,
    description: null,
    parentStreamId: null,
    parentMessageId: null,
    rootStreamId: null,
    displayNameGeneratedAt: null,
    ...overrides,
  }
}

function makeMessage(overrides: Record<string, any> = {}): any {
  return {
    id: "msg_a",
    streamId: "stream_source",
    sequence: 1n,
    authorId: "usr_author",
    authorType: "user",
    contentMarkdown: "hello",
    contentJson: { type: "doc", content: [] },
    replyCount: 0,
    clientMessageId: null,
    sentVia: null,
    reactions: {},
    metadata: {},
    editedAt: null,
    deletedAt: null,
    createdAt: new Date("2026-04-22T09:00:00Z"),
    ...overrides,
  }
}

describe("ThreadResolver.assertAccess", () => {
  afterEach(() => mock.restore())

  it("allows public channels without a membership check", async () => {
    const stream = makeStream({ visibility: Visibilities.PUBLIC })
    spyOn(StreamRepository, "findById").mockResolvedValue(stream)
    const isMember = spyOn(StreamMemberRepository, "isMember").mockResolvedValue(false)

    await ThreadResolver.assertAccess(
      {} as any,
      { kind: ContextRefKinds.THREAD, streamId: stream.id },
      "usr_x",
      stream.workspaceId
    )

    expect(isMember).not.toHaveBeenCalled()
  })

  it("rejects private streams when the user is not a member", async () => {
    spyOn(StreamRepository, "findById").mockResolvedValue(makeStream())
    spyOn(StreamMemberRepository, "isMember").mockResolvedValue(false)

    await expect(
      ThreadResolver.assertAccess(
        {} as any,
        { kind: ContextRefKinds.THREAD, streamId: "stream_source" },
        "usr_x",
        "ws_1"
      )
    ).rejects.toThrow(/No access/)
  })

  it("inherits visibility from the root stream for nested threads", async () => {
    const thread = makeStream({ id: "stream_thread", type: "thread", rootStreamId: "stream_root" })
    const rootPublic = makeStream({ id: "stream_root", visibility: Visibilities.PUBLIC })
    spyOn(StreamRepository, "findById").mockImplementation(async (_db: any, id: string) => {
      if (id === "stream_thread") return thread
      if (id === "stream_root") return rootPublic
      return null
    })
    const isMember = spyOn(StreamMemberRepository, "isMember").mockResolvedValue(false)

    await ThreadResolver.assertAccess(
      {} as any,
      { kind: ContextRefKinds.THREAD, streamId: "stream_thread" },
      "usr_x",
      "ws_1"
    )

    expect(isMember).not.toHaveBeenCalled()
  })

  it("rejects when the source stream is in a different workspace", async () => {
    spyOn(StreamRepository, "findById").mockResolvedValue(makeStream({ workspaceId: "ws_other" }))

    await expect(
      ThreadResolver.assertAccess(
        {} as any,
        { kind: ContextRefKinds.THREAD, streamId: "stream_source" },
        "usr_x",
        "ws_1"
      )
    ).rejects.toThrow(/not found/)
  })
})

describe("ThreadResolver.fetch", () => {
  afterEach(() => mock.restore())

  it("produces a fingerprint that changes when contentMarkdown changes", async () => {
    spyOn(StreamRepository, "findById").mockResolvedValue(makeStream())
    spyOn(UserRepository, "findByIds").mockResolvedValue([{ id: "usr_author", name: "Author" }] as any)
    spyOn(PersonaRepository, "findByIds").mockResolvedValue([])

    const listMock = spyOn(MessageRepository, "list")
    listMock.mockResolvedValueOnce([makeMessage({ contentMarkdown: "v1" })])
    const first = await ThreadResolver.fetch({} as any, { kind: ContextRefKinds.THREAD, streamId: "stream_source" })

    listMock.mockResolvedValueOnce([makeMessage({ contentMarkdown: "v2" })])
    const second = await ThreadResolver.fetch({} as any, { kind: ContextRefKinds.THREAD, streamId: "stream_source" })

    expect(first.fingerprint).not.toBe(second.fingerprint)
    expect(first.inputs[0].contentFingerprint).not.toBe(second.inputs[0].contentFingerprint)
  })

  it("produces the same fingerprint for unchanged content across calls", async () => {
    spyOn(StreamRepository, "findById").mockResolvedValue(makeStream())
    spyOn(UserRepository, "findByIds").mockResolvedValue([{ id: "usr_author", name: "Author" }] as any)
    spyOn(PersonaRepository, "findByIds").mockResolvedValue([])

    const listMock = spyOn(MessageRepository, "list")
    listMock.mockResolvedValue([makeMessage({ contentMarkdown: "stable" })])

    const a = await ThreadResolver.fetch({} as any, { kind: ContextRefKinds.THREAD, streamId: "stream_source" })
    const b = await ThreadResolver.fetch({} as any, { kind: ContextRefKinds.THREAD, streamId: "stream_source" })

    expect(a.fingerprint).toBe(b.fingerprint)
  })

  it("throws CONTEXT_ANCHOR_NOT_FOUND when the anchor id doesn't exist in the stream at all", async () => {
    spyOn(StreamRepository, "findById").mockResolvedValue(makeStream())
    spyOn(UserRepository, "findByIds").mockResolvedValue([])
    spyOn(PersonaRepository, "findByIds").mockResolvedValue([])
    spyOn(MessageRepository, "list").mockResolvedValue([makeMessage({ id: "msg_recent" })])
    // Anchor lookup returns null → unknown id.
    spyOn(MessageRepository, "findById").mockResolvedValue(null)

    await expect(
      ThreadResolver.fetch({} as any, {
        kind: ContextRefKinds.THREAD,
        streamId: "stream_source",
        fromMessageId: "msg_gone",
      })
    ).rejects.toMatchObject({ code: "CONTEXT_ANCHOR_NOT_FOUND" })
  })

  it("throws CONTEXT_ANCHOR_OUT_OF_WINDOW when the anchor exists but predates the fetch window", async () => {
    // The anchor is a real message in the same stream — it just isn't in the
    // most-recent MAX_FETCH slice. Caller should get a different code so the
    // frontend can render an actionable error (e.g. "widen context").
    spyOn(StreamRepository, "findById").mockResolvedValue(makeStream())
    spyOn(UserRepository, "findByIds").mockResolvedValue([])
    spyOn(PersonaRepository, "findByIds").mockResolvedValue([])
    spyOn(MessageRepository, "list").mockResolvedValue([makeMessage({ id: "msg_recent" })])
    spyOn(MessageRepository, "findById").mockResolvedValue(makeMessage({ id: "msg_old", streamId: "stream_source" }))

    await expect(
      ThreadResolver.fetch({} as any, {
        kind: ContextRefKinds.THREAD,
        streamId: "stream_source",
        fromMessageId: "msg_old",
      })
    ).rejects.toMatchObject({ code: "CONTEXT_ANCHOR_OUT_OF_WINDOW" })
  })

  it("throws CONTEXT_ANCHOR_NOT_FOUND when the anchor exists but is in a different stream", async () => {
    spyOn(StreamRepository, "findById").mockResolvedValue(makeStream())
    spyOn(UserRepository, "findByIds").mockResolvedValue([])
    spyOn(PersonaRepository, "findByIds").mockResolvedValue([])
    spyOn(MessageRepository, "list").mockResolvedValue([makeMessage({ id: "msg_recent" })])
    spyOn(MessageRepository, "findById").mockResolvedValue(
      makeMessage({ id: "msg_elsewhere", streamId: "stream_other" })
    )

    await expect(
      ThreadResolver.fetch({} as any, {
        kind: ContextRefKinds.THREAD,
        streamId: "stream_source",
        fromMessageId: "msg_elsewhere",
      })
    ).rejects.toMatchObject({ code: "CONTEXT_ANCHOR_NOT_FOUND" })
  })

  it("prepends the parent (root) message when the source is a thread", async () => {
    // Regression: threads without the root message are unintelligible.
    // `buildThreadContext` has always done this for the persona-agent path;
    // the bag resolver must match.
    const thread = makeStream({
      id: "stream_thread",
      type: "thread",
      parentStreamId: "stream_root",
      parentMessageId: "msg_root",
    })
    spyOn(StreamRepository, "findById").mockResolvedValue(thread)
    spyOn(UserRepository, "findByIds").mockResolvedValue([{ id: "usr_author", name: "Author" }] as any)
    spyOn(PersonaRepository, "findByIds").mockResolvedValue([])
    spyOn(MessageRepository, "list").mockResolvedValue([
      makeMessage({ id: "msg_reply_1", streamId: "stream_thread" }),
      makeMessage({ id: "msg_reply_2", streamId: "stream_thread" }),
    ])
    spyOn(MessageRepository, "findById").mockResolvedValue(
      makeMessage({
        id: "msg_root",
        streamId: "stream_root",
        contentMarkdown: "the originating message",
      })
    )

    const result = await ThreadResolver.fetch({} as any, {
      kind: ContextRefKinds.THREAD,
      streamId: "stream_thread",
    })

    expect(result.items.map((i) => i.messageId)).toEqual(["msg_root", "msg_reply_1", "msg_reply_2"])
    expect(result.items[0].contentMarkdown).toBe("the originating message")
  })

  it("skips the root prepend when the source stream has no parentMessageId (scratchpad/channel)", async () => {
    spyOn(StreamRepository, "findById").mockResolvedValue(makeStream({ parentMessageId: null }))
    spyOn(UserRepository, "findByIds").mockResolvedValue([{ id: "usr_author", name: "Author" }] as any)
    spyOn(PersonaRepository, "findByIds").mockResolvedValue([])
    spyOn(MessageRepository, "list").mockResolvedValue([makeMessage({ id: "msg_a" })])
    const findById = spyOn(MessageRepository, "findById").mockResolvedValue(null)

    const result = await ThreadResolver.fetch({} as any, {
      kind: ContextRefKinds.THREAD,
      streamId: "stream_source",
    })

    expect(result.items.map((i) => i.messageId)).toEqual(["msg_a"])
    expect(findById).not.toHaveBeenCalled()
  })

  it("returns the anchored slice when both endpoints resolve", async () => {
    spyOn(StreamRepository, "findById").mockResolvedValue(makeStream())
    spyOn(UserRepository, "findByIds").mockResolvedValue([{ id: "usr_author", name: "Author" }] as any)
    spyOn(PersonaRepository, "findByIds").mockResolvedValue([])
    spyOn(MessageRepository, "list").mockResolvedValue([
      makeMessage({ id: "msg_a", sequence: 1n }),
      makeMessage({ id: "msg_b", sequence: 2n }),
      makeMessage({ id: "msg_c", sequence: 3n }),
      makeMessage({ id: "msg_d", sequence: 4n }),
    ])

    const result = await ThreadResolver.fetch({} as any, {
      kind: ContextRefKinds.THREAD,
      streamId: "stream_source",
      fromMessageId: "msg_b",
      toMessageId: "msg_c",
    })

    expect(result.items.map((i) => i.messageId)).toEqual(["msg_b", "msg_c"])
  })
})
