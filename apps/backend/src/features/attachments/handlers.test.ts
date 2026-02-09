import { describe, expect, it, mock } from "bun:test"
import { AttachmentSafetyStatuses } from "@threa/types"
import { createAttachmentHandlers } from "./handlers"

function createResponse() {
  const res: any = {}
  res.status = mock((code: number) => {
    res.statusCode = code
    return res
  })
  res.json = mock((body: unknown) => {
    res.body = body
    return res
  })
  res.send = mock(() => res)
  return res
}

function buildAttachment(safetyStatus: (typeof AttachmentSafetyStatuses)[keyof typeof AttachmentSafetyStatuses]) {
  return {
    id: "attach_1",
    workspaceId: "ws_1",
    streamId: null,
    messageId: null,
    uploadedBy: "member_1",
    filename: "test.png",
    mimeType: "image/png",
    sizeBytes: 100,
    storageProvider: "s3",
    storagePath: "ws_1/attach_1/test.png",
    processingStatus: "pending",
    safetyStatus,
    createdAt: new Date(),
  }
}

describe("attachment handlers safety gating", () => {
  it("rejects upload when scanner quarantines the file", async () => {
    const attachmentService = {
      create: mock(() => Promise.resolve(buildAttachment(AttachmentSafetyStatuses.QUARANTINED))),
      delete: mock(() => Promise.resolve(true)),
    } as any

    const streamService = {
      isMember: mock(() => Promise.resolve(true)),
    } as any

    const handlers = createAttachmentHandlers({ attachmentService, streamService })
    const res = createResponse()

    await handlers.upload(
      {
        member: { id: "member_1" },
        workspaceId: "ws_1",
        attachmentId: "attach_1",
        file: {
          key: "ws_1/attach_1/test.png",
          originalname: "test.png",
          mimetype: "image/png",
          size: 100,
        },
      } as any,
      res
    )

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.body).toEqual({ error: "Attachment is quarantined due to malware scan" })
    expect(attachmentService.delete).toHaveBeenCalledWith("attach_1")
  })

  it("returns 500 with attachmentId when quarantined cleanup fails", async () => {
    const attachmentService = {
      create: mock(() => Promise.resolve(buildAttachment(AttachmentSafetyStatuses.QUARANTINED))),
      delete: mock(() => Promise.reject(new Error("s3 delete failed"))),
    } as any

    const streamService = {
      isMember: mock(() => Promise.resolve(true)),
    } as any

    const handlers = createAttachmentHandlers({ attachmentService, streamService })
    const res = createResponse()

    await handlers.upload(
      {
        member: { id: "member_1" },
        workspaceId: "ws_1",
        attachmentId: "attach_1",
        file: {
          key: "ws_1/attach_1/test.png",
          originalname: "test.png",
          mimetype: "image/png",
          size: 100,
        },
      } as any,
      res
    )

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.body).toEqual({
      error: "Attachment quarantined and cleanup failed",
      attachmentId: "attach_1",
    })
    expect(attachmentService.delete).toHaveBeenCalledWith("attach_1")
  })

  it("blocks download URL while malware scan is pending", async () => {
    const attachmentService = {
      getById: mock(() => Promise.resolve(buildAttachment(AttachmentSafetyStatuses.PENDING_SCAN))),
      getDownloadUrl: mock(() => Promise.resolve("https://download")),
    } as any

    const streamService = {
      isMember: mock(() => Promise.resolve(true)),
    } as any

    const handlers = createAttachmentHandlers({ attachmentService, streamService })
    const res = createResponse()

    await handlers.getDownloadUrl(
      {
        member: { id: "member_1" },
        workspaceId: "ws_1",
        params: { attachmentId: "attach_1" },
      } as any,
      res
    )

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.body).toEqual({ error: "Attachment is pending malware scan" })
    expect(attachmentService.getDownloadUrl).not.toHaveBeenCalled()
  })

  it("blocks download URL for quarantined attachments", async () => {
    const attachmentService = {
      getById: mock(() => Promise.resolve(buildAttachment(AttachmentSafetyStatuses.QUARANTINED))),
      getDownloadUrl: mock(() => Promise.resolve("https://download")),
    } as any

    const streamService = {
      isMember: mock(() => Promise.resolve(true)),
    } as any

    const handlers = createAttachmentHandlers({ attachmentService, streamService })
    const res = createResponse()

    await handlers.getDownloadUrl(
      {
        member: { id: "member_1" },
        workspaceId: "ws_1",
        params: { attachmentId: "attach_1" },
      } as any,
      res
    )

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.body).toEqual({ error: "Attachment is quarantined due to malware scan" })
    expect(attachmentService.getDownloadUrl).not.toHaveBeenCalled()
  })

  it("returns download URL for clean attachments", async () => {
    const attachmentService = {
      getById: mock(() => Promise.resolve(buildAttachment(AttachmentSafetyStatuses.CLEAN))),
      getDownloadUrl: mock(() => Promise.resolve("https://download")),
    } as any

    const streamService = {
      isMember: mock(() => Promise.resolve(true)),
    } as any

    const handlers = createAttachmentHandlers({ attachmentService, streamService })
    const res = createResponse()

    await handlers.getDownloadUrl(
      {
        member: { id: "member_1" },
        workspaceId: "ws_1",
        params: { attachmentId: "attach_1" },
      } as any,
      res
    )

    expect(attachmentService.getDownloadUrl).toHaveBeenCalled()
    expect(res.body).toEqual({ url: "https://download", expiresIn: 900 })
  })
})
