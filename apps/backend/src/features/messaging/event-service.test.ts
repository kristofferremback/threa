import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { AttachmentSafetyStatuses } from "@threa/types"
import { EventService } from "./event-service"
import { StreamRepository } from "../streams"
import { AttachmentRepository } from "../attachments"
import * as db from "../../db"
import { messagesTotal } from "../../lib/observability"

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
