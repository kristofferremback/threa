import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { AttachmentSafetyStatuses } from "@threa/types"
import { EventService } from "./event-service"
import { MessageRepository } from "./repository"
import { MessageVersionRepository } from "./version-repository"
import { StreamEventRepository, StreamMemberRepository, StreamRepository } from "../streams"
import { AttachmentRepository } from "../attachments"
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
    ).rejects.toThrow("Invalid attachment IDs: must be clean, unattached, and belong to this workspace")

    expect(AttachmentRepository.attachToMessage).not.toHaveBeenCalled()
  })
})

describe("EventService.createMessage idempotency", () => {
  afterEach(() => {
    mock.restore()
  })

  it("returns existing message when clientId matches a previously created message", async () => {
    const existingMessage = {
      id: "msg_existing",
      streamId: "stream_1",
      sequence: 1n,
      authorId: "usr_1",
      authorType: "user" as const,
      contentJson: { type: "doc" as const, content: [] },
      contentMarkdown: "hello",
      replyCount: 0,
      reactions: {},
      editedAt: null,
      deletedAt: null,
      createdAt: new Date(),
    }

    spyOn(MessageRepository, "findByClientId").mockResolvedValue(existingMessage)

    const service = new EventService({} as any)

    const result = await service.createMessage({
      workspaceId: "ws_1",
      streamId: "stream_1",
      authorId: "usr_1",
      authorType: "user",
      contentJson: { type: "doc", content: [] },
      contentMarkdown: "hello",
      clientId: "temp_abc123",
    })

    expect(result).toBe(existingMessage)
    expect(MessageRepository.findByClientId).toHaveBeenCalledWith(expect.anything(), "stream_1", "temp_abc123")
  })

  it("creates new message when clientId does not match any existing message", async () => {
    spyOn(MessageRepository, "findByClientId").mockResolvedValue(null)
    spyOn(db, "withTransaction").mockImplementation(((_db: unknown, callback: (client: any) => Promise<unknown>) =>
      callback({})) as any)
    spyOn(StreamRepository, "findById").mockResolvedValue({ id: "stream_1", type: "scratchpad" } as any)
    spyOn(messagesTotal, "inc").mockImplementation(() => undefined)
    spyOn(StreamEventRepository, "insert").mockResolvedValue({
      id: "evt_1",
      streamId: "stream_1",
      sequence: 1n,
      eventType: "message_created",
      payload: {},
      actorId: "usr_1",
      actorType: "user",
      createdAt: new Date(),
    } as any)
    const insertedMessage = {
      id: "msg_new",
      streamId: "stream_1",
      sequence: 1n,
      authorId: "usr_1",
      authorType: "user" as const,
      contentJson: { type: "doc" as const, content: [] },
      contentMarkdown: "hello",
      replyCount: 0,
      reactions: {},
      editedAt: null,
      deletedAt: null,
      createdAt: new Date(),
    }
    spyOn(MessageRepository, "insert").mockResolvedValue(insertedMessage)
    spyOn(StreamMemberRepository, "update").mockResolvedValue(undefined as any)
    spyOn(OutboxRepository, "insert").mockResolvedValue(undefined as any)

    const service = new EventService({} as any)

    const result = await service.createMessage({
      workspaceId: "ws_1",
      streamId: "stream_1",
      authorId: "usr_1",
      authorType: "user",
      contentJson: { type: "doc", content: [] },
      contentMarkdown: "hello",
      clientId: "temp_new123",
    })

    expect(result).toBe(insertedMessage)
    expect(MessageRepository.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ clientId: "temp_new123" })
    )
  })

  it("skips idempotency check when clientId is not provided", async () => {
    spyOn(db, "withTransaction").mockImplementation(((_db: unknown, callback: (client: any) => Promise<unknown>) =>
      callback({})) as any)
    spyOn(StreamRepository, "findById").mockResolvedValue({ id: "stream_1", type: "scratchpad" } as any)
    spyOn(messagesTotal, "inc").mockImplementation(() => undefined)
    spyOn(StreamEventRepository, "insert").mockResolvedValue({
      id: "evt_1",
      streamId: "stream_1",
      sequence: 1n,
      eventType: "message_created",
      payload: {},
      actorId: "usr_1",
      actorType: "user",
      createdAt: new Date(),
    } as any)
    spyOn(MessageRepository, "insert").mockResolvedValue({
      id: "msg_new",
      streamId: "stream_1",
      sequence: 1n,
      authorId: "usr_1",
      authorType: "user" as const,
      contentJson: { type: "doc" as const, content: [] },
      contentMarkdown: "hello",
      replyCount: 0,
      reactions: {},
      editedAt: null,
      deletedAt: null,
      createdAt: new Date(),
    })
    spyOn(StreamMemberRepository, "update").mockResolvedValue(undefined as any)
    spyOn(OutboxRepository, "insert").mockResolvedValue(undefined as any)
    const findByClientIdSpy = spyOn(MessageRepository, "findByClientId")

    const service = new EventService({} as any)

    await service.createMessage({
      workspaceId: "ws_1",
      streamId: "stream_1",
      authorId: "usr_1",
      authorType: "user",
      contentJson: { type: "doc", content: [] },
      contentMarkdown: "hello",
    })

    expect(findByClientIdSpy).not.toHaveBeenCalled()
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
