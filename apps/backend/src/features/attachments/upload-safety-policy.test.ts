import { describe, expect, it, mock } from "bun:test"
import { AttachmentSafetyStatuses } from "@threa/types"
import {
  createAttachmentSafetyPolicy,
  createMalwareScanner,
  isAttachmentSafeForSharing,
  safetyStatusBlockReason,
} from "./upload-safety-policy"

describe("createAttachmentSafetyPolicy", () => {
  it("preserves malware scan enabled setting", () => {
    const policy = createAttachmentSafetyPolicy({
      malwareScanEnabled: true,
    })

    expect(policy.malwareScanEnabled).toBe(true)
  })
})

describe("attachment sharing safety", () => {
  it("only allows clean attachments", () => {
    expect(isAttachmentSafeForSharing(AttachmentSafetyStatuses.CLEAN)).toBe(true)
    expect(isAttachmentSafeForSharing(AttachmentSafetyStatuses.PENDING_SCAN)).toBe(false)
    expect(isAttachmentSafeForSharing(AttachmentSafetyStatuses.QUARANTINED)).toBe(false)
  })

  it("returns status-specific block reasons", () => {
    expect(safetyStatusBlockReason(AttachmentSafetyStatuses.PENDING_SCAN)).toBe("Attachment is pending malware scan")
    expect(safetyStatusBlockReason(AttachmentSafetyStatuses.QUARANTINED)).toBe(
      "Attachment is quarantined due to malware scan"
    )
  })
})

describe("createMalwareScanner", () => {
  it("returns clean when scanning is disabled", async () => {
    const getObjectRange = mock(() => Promise.resolve(Buffer.from("")))
    const scanner = createMalwareScanner(
      {
        getObjectRange,
      } as any,
      {
        malwareScanEnabled: false,
      }
    )

    const result = await scanner.scan({
      storagePath: "ws_1/attach_1/safe.png",
      filename: "safe.png",
      mimeType: "image/png",
    })

    expect(result).toEqual({ status: AttachmentSafetyStatuses.CLEAN })
    expect(getObjectRange).not.toHaveBeenCalled()
  })

  it("returns clean when no malware signature is found", async () => {
    const getObjectRange = mock(() => Promise.resolve(Buffer.from("")))
    const scanner = createMalwareScanner(
      {
        getObjectRange,
      } as any,
      {
        malwareScanEnabled: true,
      }
    )

    const result = await scanner.scan({
      storagePath: "ws_1/attach_1/payload.exe",
      filename: "payload.exe",
      mimeType: "application/octet-stream",
    })

    expect(result).toEqual({ status: AttachmentSafetyStatuses.CLEAN })
    expect(getObjectRange).toHaveBeenCalled()
  })

  it("quarantines EICAR signature matches", async () => {
    const scanner = createMalwareScanner(
      {
        getObjectRange: mock(() => Promise.resolve(Buffer.from("X5O!P%@AP test"))),
      } as any,
      {
        malwareScanEnabled: true,
      }
    )

    const result = await scanner.scan({
      storagePath: "ws_1/attach_1/suspicious.txt",
      filename: "suspicious.txt",
      mimeType: "text/plain",
    })

    expect(result).toEqual({
      status: AttachmentSafetyStatuses.QUARANTINED,
      reason: "signature_match",
    })
  })
})
