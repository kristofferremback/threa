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

  it("throws CONTEXT_ANCHOR_NOT_FOUND when fromMessageId is absent from the fetched window", async () => {
    spyOn(StreamRepository, "findById").mockResolvedValue(makeStream())
    spyOn(UserRepository, "findByIds").mockResolvedValue([])
    spyOn(PersonaRepository, "findByIds").mockResolvedValue([])
    spyOn(MessageRepository, "list").mockResolvedValue([makeMessage({ id: "msg_recent" })])

    await expect(
      ThreadResolver.fetch({} as any, {
        kind: ContextRefKinds.THREAD,
        streamId: "stream_source",
        fromMessageId: "msg_gone",
      })
    ).rejects.toMatchObject({ code: "CONTEXT_ANCHOR_NOT_FOUND" })
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
