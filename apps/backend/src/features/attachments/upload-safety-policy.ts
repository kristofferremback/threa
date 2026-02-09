import { AttachmentSafetyStatuses, type AttachmentSafetyStatus } from "@threa/types"
import type { StorageProvider } from "../../lib/storage/s3-client"
import { logger } from "../../lib/logger"

export interface AttachmentSafetyPolicy {
  allowedMimeTypes: string[]
  malwareScanEnabled: boolean
}

export interface MalwareScanInput {
  storagePath: string
  filename: string
  mimeType: string
}

export interface MalwareScanResult {
  status: AttachmentSafetyStatus
  reason?: string
}

export interface MalwareScanner {
  scan(input: MalwareScanInput): Promise<MalwareScanResult>
}

const SCAN_HEAD_BYTES = 8 * 1024

const SUSPICIOUS_EXTENSIONS = [
  ".exe",
  ".dll",
  ".bat",
  ".cmd",
  ".scr",
  ".com",
  ".js",
  ".vbs",
  ".msi",
  ".ps1",
  ".jar",
] as const

const MALWARE_SIGNATURES = ["EICAR-STANDARD-ANTIVIRUS-TEST-FILE", "X5O!P%@AP"] as const

export function createAttachmentSafetyPolicy(params: AttachmentSafetyPolicy): AttachmentSafetyPolicy {
  const normalizedMimeTypes = Array.from(
    new Set(
      params.allowedMimeTypes.map((mimeType) => mimeType.trim().toLowerCase()).filter((mimeType) => mimeType.length > 0)
    )
  )

  if (normalizedMimeTypes.length === 0) {
    throw new Error("Attachment MIME allowlist cannot be empty")
  }

  return {
    allowedMimeTypes: normalizedMimeTypes,
    malwareScanEnabled: params.malwareScanEnabled,
  }
}

export function isMimeTypeAllowed(mimeType: string, allowedMimeTypes: string[]): boolean {
  return allowedMimeTypes.includes(mimeType.toLowerCase())
}

export function isAttachmentSafeForSharing(safetyStatus: AttachmentSafetyStatus): boolean {
  return safetyStatus === AttachmentSafetyStatuses.CLEAN
}

export function safetyStatusBlockReason(safetyStatus: AttachmentSafetyStatus): string {
  switch (safetyStatus) {
    case AttachmentSafetyStatuses.PENDING_SCAN:
      return "Attachment is pending malware scan"
    case AttachmentSafetyStatuses.QUARANTINED:
      return "Attachment is quarantined due to malware scan"
    case AttachmentSafetyStatuses.CLEAN:
      return ""
  }
}

function hasSuspiciousExtension(filename: string): boolean {
  const lowerFilename = filename.toLowerCase()
  return SUSPICIOUS_EXTENSIONS.some((ext) => lowerFilename.endsWith(ext))
}

function containsMalwareSignature(buffer: Buffer): boolean {
  const preview = buffer.toString("utf8").toUpperCase()
  return MALWARE_SIGNATURES.some((signature) => preview.includes(signature))
}

export function createMalwareScanner(storage: StorageProvider, policy: AttachmentSafetyPolicy): MalwareScanner {
  return {
    async scan(input: MalwareScanInput): Promise<MalwareScanResult> {
      if (!policy.malwareScanEnabled) {
        return { status: AttachmentSafetyStatuses.CLEAN }
      }

      if (hasSuspiciousExtension(input.filename)) {
        logger.warn(
          {
            filename: input.filename,
            mimeType: input.mimeType,
            storagePath: input.storagePath,
          },
          "Attachment has suspicious extension; continuing malware scan"
        )
      }

      try {
        const head = await storage.getObjectRange(input.storagePath, 0, SCAN_HEAD_BYTES - 1)

        if (containsMalwareSignature(head)) {
          return {
            status: AttachmentSafetyStatuses.QUARANTINED,
            reason: "signature_match",
          }
        }

        return { status: AttachmentSafetyStatuses.CLEAN }
      } catch (err) {
        logger.warn(
          {
            err,
            storagePath: input.storagePath,
            filename: input.filename,
          },
          "Malware scan failed; quarantining attachment"
        )

        return {
          status: AttachmentSafetyStatuses.QUARANTINED,
          reason: "scan_error",
        }
      }
    },
  }
}
