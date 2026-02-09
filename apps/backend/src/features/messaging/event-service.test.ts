import { describe, expect, it, mock } from "bun:test"
import { AttachmentSafetyStatuses } from "@threa/types"

const mockWithTransaction = mock((_pool: unknown, fn: (client: unknown) => Promise<unknown>) => fn({}))
const mockFindStreamById = mock(() => Promise.resolve({ id: "stream_1", type: "scratchpad" }))
const mockEventInsert = mock(() => Promise.resolve({ sequence: "1", createdAt: new Date("2026-01-01T00:00:00Z") }))
const mockMessageInsert = mock(() => Promise.resolve({ id: "msg_1" }))
const mockStreamMemberUpdate = mock(() => Promise.resolve())
const mockAttachmentFindByIds = mock(() => Promise.resolve([] as any[]))
const mockAttachToMessage = mock(() => Promise.resolve(0))
const mockOutboxInsert = mock(() => Promise.resolve())
const mockPersonaParticipation = mock(() => Promise.resolve())
const mockMessagesTotalInc = mock(() => {})

mock.module("../../db", () => ({
  withTransaction: mockWithTransaction,
}))

mock.module("../streams", () => ({
  StreamRepository: {
    findById: mockFindStreamById,
  },
  StreamEventRepository: {
    insert: mockEventInsert,
  },
  StreamMemberRepository: {
    update: mockStreamMemberUpdate,
  },
}))

mock.module("./repository", () => ({
  MessageRepository: {
    insert: mockMessageInsert,
    findById: mock(() => Promise.resolve(null)),
    updateContent: mock(() => Promise.resolve(null)),
    softDelete: mock(() => Promise.resolve(null)),
    addReaction: mock(() => Promise.resolve(null)),
    removeReaction: mock(() => Promise.resolve(null)),
    incrementReplyCount: mock(() => Promise.resolve()),
    decrementReplyCount: mock(() => Promise.resolve()),
  },
}))

mock.module("../attachments", () => ({
  AttachmentRepository: {
    findByIds: mockAttachmentFindByIds,
    attachToMessage: mockAttachToMessage,
  },
}))

mock.module("../../lib/outbox", () => ({
  OutboxRepository: {
    insert: mockOutboxInsert,
  },
}))

mock.module("../agents", () => ({
  StreamPersonaParticipantRepository: {
    recordParticipation: mockPersonaParticipation,
  },
}))

mock.module("../../lib/id", () => ({
  eventId: () => "evt_1",
  messageId: () => "msg_1",
}))

mock.module("../../lib/serialization", () => ({
  serializeBigInt: (value: unknown) => value,
}))

mock.module("../../lib/observability", () => ({
  messagesTotal: {
    inc: mockMessagesTotalInc,
  },
}))

import { EventService } from "./event-service"

describe("EventService attachment safety checks", () => {
  it("rejects attachments that are not malware-scan clean", async () => {
    mockAttachmentFindByIds.mockResolvedValue([
      {
        id: "attach_1",
        workspaceId: "ws_1",
        messageId: null,
        safetyStatus: AttachmentSafetyStatuses.QUARANTINED,
        filename: "unsafe.exe",
        mimeType: "application/octet-stream",
        sizeBytes: 10,
      },
    ])

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

    expect(mockAttachToMessage).not.toHaveBeenCalled()
  })
})
