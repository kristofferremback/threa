import { describe, expect, it, mock } from "bun:test"
import { AttachmentSafetyStatuses } from "@threa/types"
import {
  createAttachmentSafetyPolicy,
  createMalwareScanner,
  isAttachmentSafeForSharing,
  isMimeTypeAllowed,
  safetyStatusBlockReason,
} from "./upload-safety-policy"

describe("createAttachmentSafetyPolicy", () => {
  it("normalizes and deduplicates allowed MIME types", () => {
    const policy = createAttachmentSafetyPolicy({
      allowedMimeTypes: [" image/png ", "IMAGE/PNG", "application/pdf"],
      malwareScanEnabled: true,
    })

    expect(policy.allowedMimeTypes).toEqual(["image/png", "application/pdf"])
    expect(policy.malwareScanEnabled).toBe(true)
  })

  it("throws when allowlist is empty", () => {
    expect(() =>
      createAttachmentSafetyPolicy({
        allowedMimeTypes: ["   "],
        malwareScanEnabled: true,
      })
    ).toThrow("Attachment MIME allowlist cannot be empty")
  })
})

describe("MIME allowlist checks", () => {
  it("matches MIME types case-insensitively", () => {
    expect(isMimeTypeAllowed("IMAGE/PNG", ["image/png"])).toBe(true)
  })

  it("returns false for non-allowlisted MIME types", () => {
    expect(isMimeTypeAllowed("application/x-msdownload", ["image/png"])).toBe(false)
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
        allowedMimeTypes: ["image/png"],
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

  it("does not quarantine based on extension alone", async () => {
    const scanner = createMalwareScanner(
      {
        getObjectRange: mock(() => Promise.resolve(Buffer.from(""))),
      } as any,
      {
        allowedMimeTypes: ["image/png"],
        malwareScanEnabled: true,
      }
    )

    const result = await scanner.scan({
      storagePath: "ws_1/attach_1/payload.exe",
      filename: "payload.exe",
      mimeType: "application/octet-stream",
    })

    expect(result).toEqual({ status: AttachmentSafetyStatuses.CLEAN })
  })

  it("quarantines EICAR signature matches", async () => {
    const scanner = createMalwareScanner(
      {
        getObjectRange: mock(() => Promise.resolve(Buffer.from("X5O!P%@AP test"))),
      } as any,
      {
        allowedMimeTypes: ["image/png"],
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
