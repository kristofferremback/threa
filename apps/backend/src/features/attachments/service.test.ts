import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { AttachmentSafetyStatuses } from "@threa/types"
import * as db from "../../db"
import { AttachmentRepository } from "./repository"
import { AttachmentExtractionRepository } from "./extraction-repository"
import { AttachmentService } from "./service"

function createService() {
  const storage = {
    getSignedDownloadUrl: mock(async () => "https://example.com/file"),
    delete: mock(async () => {}),
  } as any

  const malwareScanner = {
    scan: mock(async () => ({ status: AttachmentSafetyStatuses.CLEAN })),
  } as any

  return {
    service: new AttachmentService({} as any, storage, malwareScanner),
    storage,
  }
}

describe("AttachmentService", () => {
  afterEach(() => {
    mock.restore()
  })

  it("deletes attachment metadata in transaction before deleting S3 object", async () => {
    const steps: string[] = []
    spyOn(db, "withTransaction").mockImplementation((async (_db: unknown, callback: (client: any) => Promise<any>) => {
      steps.push("transaction:start")
      const result = await callback({})
      steps.push("transaction:end")
      return result
    }) as any)

    spyOn(AttachmentRepository, "findByIdForUpdate").mockImplementation(async () => {
      steps.push("attachment:lock")
      return {
        id: "attach_1",
        workspaceId: "ws_1",
        streamId: null,
        messageId: null,
        uploadedBy: "member_1",
        filename: "unsafe.exe",
        mimeType: "application/octet-stream",
        sizeBytes: 10,
        storageProvider: "s3",
        storagePath: "ws_1/attach_1/unsafe.exe",
        processingStatus: "pending",
        safetyStatus: "quarantined",
        createdAt: new Date(),
      } as any
    })
    spyOn(AttachmentExtractionRepository, "deleteByAttachmentId").mockImplementation(async () => {
      steps.push("extraction:delete")
      return true
    })
    spyOn(AttachmentRepository, "delete").mockImplementation(async () => {
      steps.push("attachment:delete")
      return true
    })

    const { service, storage } = createService()
    storage.delete = mock(async () => {
      steps.push("storage:delete")
    })

    const deleted = await service.delete("attach_1")

    expect(deleted).toBe(true)
    expect(steps).toEqual([
      "transaction:start",
      "attachment:lock",
      "extraction:delete",
      "attachment:delete",
      "transaction:end",
      "storage:delete",
    ])
  })

  it("returns false when attachment does not exist", async () => {
    spyOn(db, "withTransaction").mockImplementation((async (_db: unknown, callback: (client: any) => Promise<any>) =>
      callback({})) as any)
    spyOn(AttachmentRepository, "findByIdForUpdate").mockResolvedValue(null)
    spyOn(AttachmentExtractionRepository, "deleteByAttachmentId").mockResolvedValue(true)
    spyOn(AttachmentRepository, "delete").mockResolvedValue(true)

    const { service, storage } = createService()
    const deleted = await service.delete("attach_missing")

    expect(deleted).toBe(false)
    expect(AttachmentExtractionRepository.deleteByAttachmentId).not.toHaveBeenCalled()
    expect(AttachmentRepository.delete).not.toHaveBeenCalled()
    expect(storage.delete).not.toHaveBeenCalled()
  })

  it("quarantines stale pending scans and returns recovered count", async () => {
    spyOn(db, "withTransaction").mockImplementation((async (_db: unknown, callback: (client: any) => Promise<any>) =>
      callback({})) as any)
    const quarantineSpy = spyOn(AttachmentRepository, "quarantineStalePendingScans").mockResolvedValue([
      "attach_1",
      "attach_2",
    ])

    const { service } = createService()
    const recovered = await service.recoverStalePendingScans({ staleThresholdMs: 60_000, batchSize: 25 })

    expect(recovered).toBe(2)
    expect(quarantineSpy).toHaveBeenCalledTimes(1)
    expect(quarantineSpy.mock.calls[0]?.[1]?.limit).toBe(25)
    expect(quarantineSpy.mock.calls[0]?.[1]?.olderThan).toBeInstanceOf(Date)
  })

  it("rejects invalid recovery options", async () => {
    spyOn(db, "withTransaction").mockImplementation((async (_db: unknown, callback: (client: any) => Promise<any>) =>
      callback({})) as any)

    const { service } = createService()

    await expect(service.recoverStalePendingScans({ staleThresholdMs: 0 })).rejects.toThrow(
      "staleThresholdMs must be positive"
    )
    await expect(service.recoverStalePendingScans({ batchSize: 0 })).rejects.toThrow("batchSize must be positive")
  })
})
