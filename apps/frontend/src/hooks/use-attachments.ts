import { useState, useCallback, useRef, type ChangeEvent, type RefObject } from "react"
import { attachmentsApi } from "@/api"

export interface PendingAttachment {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  status: "uploading" | "uploaded" | "error"
  error?: string
}

export interface UseAttachmentsReturn {
  /** Current pending attachments */
  pendingAttachments: PendingAttachment[]
  /** Ref to attach to a hidden file input */
  fileInputRef: RefObject<HTMLInputElement | null>
  /** Handler for file input change event */
  handleFileSelect: (e: ChangeEvent<HTMLInputElement>) => void
  /** Remove an attachment by ID */
  removeAttachment: (id: string) => void
  /** IDs of successfully uploaded attachments */
  uploadedIds: string[]
  /** Whether any files are currently uploading */
  isUploading: boolean
  /** Whether any uploads failed */
  hasFailed: boolean
  /** Clear all attachments */
  clear: () => void
  /** Restore attachments from saved state */
  restore: (attachments: Array<{ id: string; filename: string; mimeType: string; sizeBytes: number }>) => void
}

export function useAttachments(workspaceId: string): UseAttachmentsReturn {
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files || files.length === 0) return

      // Reset input so same file can be selected again
      e.target.value = ""

      for (const file of Array.from(files)) {
        const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`

        // Add as uploading
        setPendingAttachments((prev) => [
          ...prev,
          {
            id: tempId,
            filename: file.name,
            mimeType: file.type || "application/octet-stream",
            sizeBytes: file.size,
            status: "uploading",
          },
        ])

        try {
          const attachment = await attachmentsApi.upload(workspaceId, file)

          if (!attachment || !attachment.id) {
            throw new Error("Invalid response: missing attachment data")
          }

          // Replace temp with real attachment
          setPendingAttachments((prev) =>
            prev.map((a) =>
              a.id === tempId
                ? {
                    id: attachment.id,
                    filename: attachment.filename,
                    mimeType: attachment.mimeType,
                    sizeBytes: attachment.sizeBytes,
                    status: "uploaded" as const,
                  }
                : a
            )
          )
        } catch (err) {
          // Mark as error
          setPendingAttachments((prev) =>
            prev.map((a) =>
              a.id === tempId
                ? {
                    ...a,
                    status: "error" as const,
                    error: err instanceof Error ? err.message : "Upload failed",
                  }
                : a
            )
          )
        }
      }
    },
    [workspaceId]
  )

  const removeAttachment = useCallback(
    async (attachmentId: string) => {
      const attachment = pendingAttachments.find((a) => a.id === attachmentId)
      if (!attachment) return

      // Remove from UI immediately
      setPendingAttachments((prev) => prev.filter((a) => a.id !== attachmentId))

      // If it was successfully uploaded, delete from server
      if (attachment.status === "uploaded" && !attachmentId.startsWith("temp_")) {
        try {
          await attachmentsApi.delete(workspaceId, attachmentId)
        } catch (err) {
          console.warn("Failed to delete attachment from server:", err)
        }
      }
    },
    [pendingAttachments, workspaceId]
  )

  const clear = useCallback(() => {
    setPendingAttachments([])
  }, [])

  const restore = useCallback(
    (attachments: Array<{ id: string; filename: string; mimeType: string; sizeBytes: number }>) => {
      setPendingAttachments(
        attachments.map((a) => ({
          ...a,
          status: "uploaded" as const,
        }))
      )
    },
    []
  )

  const uploadedIds = pendingAttachments
    .filter((a) => a.status === "uploaded" && !a.id.startsWith("temp_"))
    .map((a) => a.id)

  const isUploading = pendingAttachments.some((a) => a.status === "uploading")
  const hasFailed = pendingAttachments.some((a) => a.status === "error")

  return {
    pendingAttachments,
    fileInputRef,
    handleFileSelect,
    removeAttachment,
    uploadedIds,
    isUploading,
    hasFailed,
    clear,
    restore,
  }
}
