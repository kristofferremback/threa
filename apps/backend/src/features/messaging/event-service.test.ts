import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { AttachmentSafetyStatuses } from "@threa/types"
import { EventService } from "./event-service"
import { MessageRepository } from "./repository"
import { SharedMessageRepository } from "./sharing/repository"
import { MessageVersionRepository } from "./version-repository"
import { StreamEventRepository, StreamMemberRepository, StreamRepository } from "../streams"
import { AttachmentRepository, AttachmentReferenceRepository } from "../attachments"
import { OutboxRepository } from "../../lib/outbox"
import * as db from "../../db"
import { messagesTotal } from "../../lib/observability"
import { StreamPersonaParticipantRepository } from "../agents"

describe("EventService attachment safety checks", () => {
  beforeEach(() => {
    spyOn(db, "withTransaction").mockImplementation(((_db: unknown, callback: (client: any) => Promise<unknown>) =>
      callback({})) as any)
    spyOn(StreamRepository, "findById").mockResolvedValue({ id: "stream_1", type: "scratchpad" } as any)
    spyOn(AttachmentRepository, "findByIds").mockResolvedValue([])
    spyOn(AttachmentRepository, "attachToMessage").mockResolvedValue(0)
    spyOn(messagesTotal, "inc").mockImplementation(() => undefined)
  })

  afterEach(() => {
    mock.restore()
  })

  it("rejects attachments that are not malware-scan clean", async () => {
    spyOn(AttachmentRepository, "findByIds").mockResolvedValue([
      {
        id: "attach_1",
        workspaceId: "ws_1",
        streamId: null,
        messageId: null,
        safetyStatus: AttachmentSafetyStatuses.QUARANTINED,
        filename: "unsafe.exe",
        mimeType: "application/octet-stream",
        sizeBytes: 10,
      },
    ] as any)

    const service = new EventService({} as any)

    await expect(
      service.createMessage({
        workspaceId: "ws_1",
        streamId: "stream_1",
        authorId: "usr_1",
        authorType: "user",
        contentJson: { type: "doc", content: [] },
        contentMarkdown: "hello",
        attachmentIds: ["attach_1"],
      })
    ).rejects.toThrow("Invalid attachment IDs: must be malware-scan clean")

    expect(AttachmentRepository.attachToMessage).not.toHaveBeenCalled()
  })

  it("allows re-referencing an attachment the author can already read and skips re-attach", async () => {
    spyOn(AttachmentRepository, "findByIds").mockResolvedValue([
      {
        id: "attach_1",
        workspaceId: "ws_1",
        streamId: "stream_source",
        messageId: "msg_source",
        safetyStatus: AttachmentSafetyStatuses.CLEAN,
        filename: "shared.png",
        mimeType: "image/png",
        sizeBytes: 100,
      },
    ] as any)
    // checkStreamAccess() resolves to the source stream as long as the
    // stream row exists and is public (or the user is a member).
    spyOn(StreamRepository, "findById").mockResolvedValue({
      id: "stream_source",
      workspaceId: "ws_1",
      rootStreamId: null,
      visibility: "public",
      type: "channel",
    } as any)
    spyOn(StreamMemberRepository, "isMember").mockResolvedValue(true)
    spyOn(StreamMemberRepository, "update").mockResolvedValue(undefined as any)
    spyOn(StreamEventRepository, "insert").mockImplementation((async (_client: any, params: any) => ({
      id: "evt_1",
      streamId: params.streamId,
      sequence: 1n,
      eventType: params.eventType,
      payload: params.payload,
      actorId: params.actorId,
      actorType: params.actorType,
      createdAt: new Date(),
    })) as any)
    spyOn(MessageRepository, "insert").mockImplementation((async (_client: any, params: any) => ({
      id: params.id,
      streamId: params.streamId,
      sequence: params.sequence,
      authorId: params.authorId,
      authorType: params.authorType,
      contentJson: params.contentJson,
      contentMarkdown: params.contentMarkdown,
      replyCount: 0,
      clientMessageId: null,
      sentVia: null,
      reactions: {},
      metadata: {},
      editedAt: null,
      deletedAt: null,
      createdAt: new Date(),
    })) as any)
    spyOn(MessageRepository, "findByClientMessageId").mockResolvedValue(null)
    spyOn(OutboxRepository, "insert").mockResolvedValue(undefined as any)
    spyOn(SharedMessageRepository, "deleteByShareMessageId").mockResolvedValue(undefined)
    const insertManySpy = spyOn(AttachmentReferenceRepository, "insertMany").mockResolvedValue(0)

    const service = new EventService({} as any)
    await service.createMessage({
      workspaceId: "ws_1",
      streamId: "stream_target",
      authorId: "usr_1",
      authorType: "user",
      contentJson: { type: "doc", content: [] },
      contentMarkdown: "resending image",
      attachmentIds: ["attach_1"],
    })

    expect(AttachmentRepository.attachToMessage).not.toHaveBeenCalled()
    expect(insertManySpy).toHaveBeenCalledTimes(1)
    const callArgs = insertManySpy.mock.calls[0]?.[1] as Array<{ attachmentId: string; streamId: string }>
    expect(callArgs).toHaveLength(1)
    expect(callArgs[0]?.attachmentId).toBe("attach_1")
    expect(callArgs[0]?.streamId).toBe("stream_target")
  })

  it("rejects re-referencing an attachment the author cannot read", async () => {
    spyOn(AttachmentRepository, "findByIds").mockResolvedValue([
      {
        id: "attach_1",
        workspaceId: "ws_1",
        streamId: "stream_secret",
        messageId: "msg_secret",
        safetyStatus: AttachmentSafetyStatuses.CLEAN,
        filename: "secret.png",
        mimeType: "image/png",
        sizeBytes: 100,
      },
    ] as any)
    // No matching stream → checkStreamAccess returns null.
    spyOn(StreamRepository, "findById").mockResolvedValue(null)
    spyOn(SharedMessageRepository, "listSourcesGrantedToViewer").mockResolvedValue(new Set())
    spyOn(AttachmentReferenceRepository, "hasViewerAccessByReference").mockResolvedValue(false)

    const service = new EventService({} as any)
    await expect(
      service.createMessage({
        workspaceId: "ws_1",
        streamId: "stream_target",
        authorId: "usr_1",
        authorType: "user",
        contentJson: { type: "doc", content: [] },
        contentMarkdown: "stealing",
        attachmentIds: ["attach_1"],
      })
    ).rejects.toThrow("cannot reference an attachment without read access")
  })
})

describe("EventService.editMessage version capture", () => {
  const existingMessage = {
    id: "msg_1",
    streamId: "stream_1",
    contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "original" }] }] },
    contentMarkdown: "original",
    authorId: "usr_1",
    authorType: "user",
  }
  let findByIdForUpdateSpy: ReturnType<typeof spyOn>
  let isMemberSpy: ReturnType<typeof spyOn>
  let hasParticipatedSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    spyOn(db, "withTransaction").mockImplementation(((_db: unknown, callback: (client: any) => Promise<unknown>) =>
      callback({})) as any)
    findByIdForUpdateSpy = spyOn(MessageRepository, "findByIdForUpdate").mockResolvedValue(existingMessage as any)
    spyOn(MessageRepository, "findById").mockResolvedValue(existingMessage as any)
    // editMessage now looks up the stream post-edit to decide whether to
    // publish a thread-summary update to the parent (for reply edits). Default
    // to a non-thread stream so the publishParentThreadUpdate branch short-
    // circuits — tests that care about the thread path can override per case.
    spyOn(StreamRepository, "findById").mockResolvedValue({
      id: "stream_1",
      type: "scratchpad",
      parentStreamId: null,
      parentMessageId: null,
    } as any)
    isMemberSpy = spyOn(StreamMemberRepository, "isMember").mockResolvedValue(true)
    hasParticipatedSpy = spyOn(StreamPersonaParticipantRepository, "hasParticipated").mockResolvedValue(false)
    spyOn(MessageVersionRepository, "insert").mockResolvedValue({
      id: "msgv_1",
      messageId: "msg_1",
      versionNumber: 1,
      contentJson: existingMessage.contentJson,
      contentMarkdown: "original",
      editedBy: "usr_1",
      createdAt: new Date(),
    })
    spyOn(StreamEventRepository, "insert").mockResolvedValue({
      id: "evt_1",
      streamId: "stream_1",
      sequence: 2n,
      eventType: "message_edited",
      payload: {},
      actorId: "usr_1",
      actorType: "user",
      createdAt: new Date(),
    } as any)
    spyOn(MessageRepository, "updateContent").mockResolvedValue({
      ...existingMessage,
      contentMarkdown: "edited",
      editedAt: new Date(),
    } as any)
    spyOn(OutboxRepository, "insert").mockResolvedValue(undefined as any)
    spyOn(SharedMessageRepository, "deleteByShareMessageId").mockResolvedValue(undefined)
    spyOn(SharedMessageRepository, "insert").mockResolvedValue({} as any)
  })

  afterEach(() => {
    mock.restore()
  })

  it("should snapshot pre-edit content as a version record", async () => {
    const service = new EventService({} as any)

    await service.editMessage({
      workspaceId: "ws_1",
      messageId: "msg_1",
      streamId: "stream_1",
      contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "edited" }] }] },
      contentMarkdown: "edited",
      actorId: "usr_1",
    })

    expect(MessageVersionRepository.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        messageId: "msg_1",
        contentJson: existingMessage.contentJson,
        contentMarkdown: "original",
        editedBy: "usr_1",
      })
    )
  })

  it("should not create version when message does not exist", async () => {
    findByIdForUpdateSpy.mockResolvedValue(null)

    const service = new EventService({} as any)

    await service.editMessage({
      workspaceId: "ws_1",
      messageId: "msg_nonexistent",
      streamId: "stream_1",
      contentJson: { type: "doc", content: [] },
      contentMarkdown: "edited",
      actorId: "usr_1",
    })

    expect(MessageVersionRepository.insert).not.toHaveBeenCalled()
  })

  it("resolves actor type as persona when not provided", async () => {
    isMemberSpy.mockResolvedValue(false)
    hasParticipatedSpy.mockResolvedValue(true)
    const service = new EventService({} as any)

    await service.editMessage({
      workspaceId: "ws_1",
      messageId: "msg_1",
      streamId: "stream_1",
      contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "edited" }] }] },
      contentMarkdown: "edited",
      actorId: "persona_1",
    })

    expect(StreamEventRepository.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorType: "persona",
      })
    )
  })

  it("throws when actor type cannot be resolved", async () => {
    isMemberSpy.mockResolvedValue(false)
    hasParticipatedSpy.mockResolvedValue(false)
    findByIdForUpdateSpy.mockResolvedValue({
      ...existingMessage,
      authorId: "another_actor",
    })
    const service = new EventService({} as any)

    await expect(
      service.editMessage({
        workspaceId: "ws_1",
        messageId: "msg_1",
        streamId: "stream_1",
        contentJson: { type: "doc", content: [] },
        contentMarkdown: "edited",
        actorId: "unknown_actor",
      })
    ).rejects.toThrow("has no resolved type")

    expect(MessageVersionRepository.insert).not.toHaveBeenCalled()
  })

  it("uses existing message author type when actorType is omitted", async () => {
    isMemberSpy.mockResolvedValue(false)
    hasParticipatedSpy.mockResolvedValue(false)
    const service = new EventService({} as any)

    await service.editMessage({
      workspaceId: "ws_1",
      messageId: "msg_1",
      streamId: "stream_1",
      contentJson: { type: "doc", content: [] },
      contentMarkdown: "edited",
      actorId: "usr_1",
    })

    expect(StreamEventRepository.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorType: "user",
      })
    )
  })
})

describe("EventService.createMessage metadata propagation", () => {
  const baseParams = {
    workspaceId: "ws_1",
    streamId: "stream_1",
    authorId: "usr_1",
    authorType: "user" as const,
    contentJson: { type: "doc", content: [] },
    contentMarkdown: "hello",
  }

  beforeEach(() => {
    spyOn(db, "withTransaction").mockImplementation(((_db: unknown, callback: (client: any) => Promise<unknown>) =>
      callback({})) as any)
    spyOn(StreamRepository, "findById").mockResolvedValue({ id: "stream_1", type: "scratchpad" } as any)
    spyOn(AttachmentRepository, "findByIds").mockResolvedValue([])
    spyOn(AttachmentRepository, "attachToMessage").mockResolvedValue(0)
    spyOn(StreamMemberRepository, "isMember").mockResolvedValue(true)
    spyOn(StreamMemberRepository, "update").mockResolvedValue(undefined as any)
    spyOn(StreamEventRepository, "insert").mockImplementation((async (_client: any, params: any) => ({
      id: "evt_1",
      streamId: params.streamId,
      sequence: 1n,
      eventType: params.eventType,
      payload: params.payload,
      actorId: params.actorId,
      actorType: params.actorType,
      createdAt: new Date(),
    })) as any)
    spyOn(MessageRepository, "insert").mockImplementation((async (_client: any, params: any) => ({
      id: params.id,
      streamId: params.streamId,
      sequence: params.sequence,
      authorId: params.authorId,
      authorType: params.authorType,
      contentJson: params.contentJson,
      contentMarkdown: params.contentMarkdown,
      replyCount: 0,
      clientMessageId: params.clientMessageId ?? null,
      sentVia: params.sentVia ?? null,
      reactions: {},
      metadata: params.metadata ?? {},
      editedAt: null,
      deletedAt: null,
      createdAt: new Date(),
    })) as any)
    spyOn(MessageRepository, "findById").mockResolvedValue(null)
    spyOn(OutboxRepository, "insert").mockResolvedValue(undefined as any)
    spyOn(messagesTotal, "inc").mockImplementation(() => undefined)
    spyOn(SharedMessageRepository, "deleteByShareMessageId").mockResolvedValue(undefined)
    spyOn(SharedMessageRepository, "insert").mockResolvedValue({} as any)
  })

  afterEach(() => {
    mock.restore()
  })

  it("propagates non-empty metadata to the event payload and the projection", async () => {
    const service = new EventService({} as any)
    const metadata = { "github.pr.id": "42", "github.event": "review_requested" }

    await service.createMessage({ ...baseParams, metadata })

    expect(StreamEventRepository.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "message_created",
        payload: expect.objectContaining({ metadata }),
      })
    )
    expect(MessageRepository.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ metadata }))
  })

  it("omits metadata from the event payload and projection when unset or empty", async () => {
    const service = new EventService({} as any)

    await service.createMessage({ ...baseParams, metadata: {} })

    const eventPayload = (StreamEventRepository.insert as any).mock.calls[0][1].payload
    expect(eventPayload).not.toHaveProperty("metadata")

    const insertParams = (MessageRepository.insert as any).mock.calls[0][1]
    expect(insertParams.metadata).toBeUndefined()
  })
})
