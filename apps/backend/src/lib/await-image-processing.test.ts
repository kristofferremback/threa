import { describe, it, expect, spyOn, afterEach } from "bun:test"
import { awaitImageProcessing, hasPendingImageProcessing } from "./await-image-processing"
import { AttachmentRepository } from "../repositories/attachment-repository"
import type { Attachment } from "../repositories/attachment-repository"

describe("awaitImageProcessing", () => {
  afterEach(() => {
    // spyOn automatically restores after each test in Bun
  })

  it("returns immediately when no attachments provided", async () => {
    const mockPool = {} as any

    const result = await awaitImageProcessing(mockPool, [])

    expect(result).toEqual({
      allCompleted: true,
      completedIds: [],
      failedOrTimedOutIds: [],
    })
  })

  it("returns completed for already-completed attachments", async () => {
    const mockPool = {} as any
    const mockAttachment: Attachment = {
      id: "attach_1",
      workspaceId: "ws_1",
      streamId: "stream_1",
      messageId: "msg_1",
      uploadedBy: "user_1",
      filename: "test.png",
      mimeType: "image/png",
      sizeBytes: 1024,
      storageProvider: "s3",
      storagePath: "/test/path",
      processingStatus: "completed",
      createdAt: new Date(),
    }

    spyOn(AttachmentRepository, "findByIds").mockResolvedValue([mockAttachment])

    const result = await awaitImageProcessing(mockPool, ["attach_1"], 1000)

    expect(result).toEqual({
      allCompleted: true,
      completedIds: ["attach_1"],
      failedOrTimedOutIds: [],
    })
  })

  it("returns failed status for failed attachments", async () => {
    const mockPool = {} as any
    const mockAttachment: Attachment = {
      id: "attach_1",
      workspaceId: "ws_1",
      streamId: "stream_1",
      messageId: "msg_1",
      uploadedBy: "user_1",
      filename: "test.png",
      mimeType: "image/png",
      sizeBytes: 1024,
      storageProvider: "s3",
      storagePath: "/test/path",
      processingStatus: "failed",
      createdAt: new Date(),
    }

    spyOn(AttachmentRepository, "findByIds").mockResolvedValue([mockAttachment])

    const result = await awaitImageProcessing(mockPool, ["attach_1"], 1000)

    expect(result).toEqual({
      allCompleted: false,
      completedIds: [],
      failedOrTimedOutIds: ["attach_1"],
    })
  })

  it("handles mix of completed and failed attachments", async () => {
    const mockPool = {} as any
    const mockAttachments: Attachment[] = [
      {
        id: "attach_1",
        workspaceId: "ws_1",
        streamId: "stream_1",
        messageId: "msg_1",
        uploadedBy: "user_1",
        filename: "success.png",
        mimeType: "image/png",
        sizeBytes: 1024,
        storageProvider: "s3",
        storagePath: "/test/path1",
        processingStatus: "completed",
        createdAt: new Date(),
      },
      {
        id: "attach_2",
        workspaceId: "ws_1",
        streamId: "stream_1",
        messageId: "msg_1",
        uploadedBy: "user_1",
        filename: "failed.png",
        mimeType: "image/png",
        sizeBytes: 1024,
        storageProvider: "s3",
        storagePath: "/test/path2",
        processingStatus: "failed",
        createdAt: new Date(),
      },
    ]

    spyOn(AttachmentRepository, "findByIds").mockResolvedValue(mockAttachments)

    const result = await awaitImageProcessing(mockPool, ["attach_1", "attach_2"], 1000)

    expect(result.allCompleted).toBe(false)
    expect(result.completedIds).toContain("attach_1")
    expect(result.failedOrTimedOutIds).toContain("attach_2")
  })

  it("times out for pending attachments", async () => {
    const mockPool = {} as any
    const mockAttachment: Attachment = {
      id: "attach_1",
      workspaceId: "ws_1",
      streamId: "stream_1",
      messageId: "msg_1",
      uploadedBy: "user_1",
      filename: "pending.png",
      mimeType: "image/png",
      sizeBytes: 1024,
      storageProvider: "s3",
      storagePath: "/test/path",
      processingStatus: "pending",
      createdAt: new Date(),
    }

    spyOn(AttachmentRepository, "findByIds").mockResolvedValue([mockAttachment])

    // Use very short timeout to speed up test
    const result = await awaitImageProcessing(mockPool, ["attach_1"], 100)

    expect(result.allCompleted).toBe(false)
    expect(result.completedIds).toHaveLength(0)
    expect(result.failedOrTimedOutIds).toContain("attach_1")
  })
})

describe("hasPendingImageProcessing", () => {
  it("returns false for empty array", async () => {
    const mockPool = {} as any

    const result = await hasPendingImageProcessing(mockPool, [])

    expect(result).toBe(false)
  })

  it("returns false when all attachments are completed", async () => {
    const mockPool = {} as any
    const mockAttachment: Attachment = {
      id: "attach_1",
      workspaceId: "ws_1",
      streamId: "stream_1",
      messageId: "msg_1",
      uploadedBy: "user_1",
      filename: "test.png",
      mimeType: "image/png",
      sizeBytes: 1024,
      storageProvider: "s3",
      storagePath: "/test/path",
      processingStatus: "completed",
      createdAt: new Date(),
    }

    spyOn(AttachmentRepository, "findByIds").mockResolvedValue([mockAttachment])

    const result = await hasPendingImageProcessing(mockPool, ["attach_1"])

    expect(result).toBe(false)
  })

  it("returns true when any attachment is pending", async () => {
    const mockPool = {} as any
    const mockAttachment: Attachment = {
      id: "attach_1",
      workspaceId: "ws_1",
      streamId: "stream_1",
      messageId: "msg_1",
      uploadedBy: "user_1",
      filename: "test.png",
      mimeType: "image/png",
      sizeBytes: 1024,
      storageProvider: "s3",
      storagePath: "/test/path",
      processingStatus: "pending",
      createdAt: new Date(),
    }

    spyOn(AttachmentRepository, "findByIds").mockResolvedValue([mockAttachment])

    const result = await hasPendingImageProcessing(mockPool, ["attach_1"])

    expect(result).toBe(true)
  })

  it("returns true when any attachment is processing", async () => {
    const mockPool = {} as any
    const mockAttachment: Attachment = {
      id: "attach_1",
      workspaceId: "ws_1",
      streamId: "stream_1",
      messageId: "msg_1",
      uploadedBy: "user_1",
      filename: "test.png",
      mimeType: "image/png",
      sizeBytes: 1024,
      storageProvider: "s3",
      storagePath: "/test/path",
      processingStatus: "processing",
      createdAt: new Date(),
    }

    spyOn(AttachmentRepository, "findByIds").mockResolvedValue([mockAttachment])

    const result = await hasPendingImageProcessing(mockPool, ["attach_1"])

    expect(result).toBe(true)
  })
})
