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
        authorId: "member_1",
        authorType: "member",
        contentJson: { type: "doc", content: [] },
        contentMarkdown: "hello",
        attachmentIds: ["attach_1"],
      })
    ).rejects.toThrow("Invalid attachment IDs: must be clean, unattached, and belong to this workspace")

    expect(AttachmentRepository.attachToMessage).not.toHaveBeenCalled()
  })
})

describe("EventService.editMessage version capture", () => {
  const existingMessage = {
    id: "msg_1",
    streamId: "stream_1",
    contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "original" }] }] },
    contentMarkdown: "original",
    authorId: "member_1",
    authorType: "member",
  }
  let isMemberSpy: ReturnType<typeof spyOn>
  let hasParticipatedSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    spyOn(db, "withTransaction").mockImplementation(((_db: unknown, callback: (client: any) => Promise<unknown>) =>
      callback({})) as any)
    spyOn(MessageRepository, "findByIdForUpdate").mockResolvedValue(existingMessage as any)
    spyOn(MessageRepository, "findById").mockResolvedValue(existingMessage as any)
    isMemberSpy = spyOn(StreamMemberRepository, "isMember").mockResolvedValue(true)
    hasParticipatedSpy = spyOn(StreamPersonaParticipantRepository, "hasParticipated").mockResolvedValue(false)
    spyOn(MessageVersionRepository, "insert").mockResolvedValue({
      id: "msgv_1",
      messageId: "msg_1",
      versionNumber: 1,
      contentJson: existingMessage.contentJson,
      contentMarkdown: "original",
      editedBy: "member_1",
      createdAt: new Date(),
    })
    spyOn(StreamEventRepository, "insert").mockResolvedValue({
      id: "evt_1",
      streamId: "stream_1",
      sequence: 2n,
      eventType: "message_edited",
      payload: {},
      actorId: "member_1",
      actorType: "member",
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
      actorId: "member_1",
    })

    expect(MessageVersionRepository.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        messageId: "msg_1",
        contentJson: existingMessage.contentJson,
        contentMarkdown: "original",
        editedBy: "member_1",
      })
    )
  })

  it("should not create version when message does not exist", async () => {
    spyOn(MessageRepository, "findByIdForUpdate").mockResolvedValue(null)

    const service = new EventService({} as any)

    await service.editMessage({
      workspaceId: "ws_1",
      messageId: "msg_nonexistent",
      streamId: "stream_1",
      contentJson: { type: "doc", content: [] },
      contentMarkdown: "edited",
      actorId: "member_1",
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
})
