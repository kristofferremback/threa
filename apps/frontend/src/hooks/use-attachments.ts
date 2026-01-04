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

export interface UploadResult {
  /** The uploaded attachment */
  attachment: PendingAttachment
  /** For images, the sequential index (1, 2, 3...). Null for non-images. */
  imageIndex: number | null
  /** Temporary ID used during upload - use this to track the node */
  tempId: string
}

export interface UseAttachmentsReturn {
  /** Current pending attachments */
  pendingAttachments: PendingAttachment[]
  /** Ref to attach to a hidden file input */
  fileInputRef: RefObject<HTMLInputElement | null>
  /** Handler for file input change event */
  handleFileSelect: (e: ChangeEvent<HTMLInputElement>) => void
  /** Upload a file programmatically (for paste/drop). Returns temp ID for tracking. */
  uploadFile: (file: File) => Promise<UploadResult>
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
  /** Current image count for numbering */
  imageCount: number
}

export function useAttachments(workspaceId: string): UseAttachmentsReturn {
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const [imageCount, setImageCount] = useState(0)
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

  // Use ref to track image count synchronously for proper indexing
  const imageCountRef = useRef(imageCount)
  imageCountRef.current = imageCount

  const uploadFile = useCallback(
    async (file: File): Promise<UploadResult> => {
      const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`
      const isImage = file.type.startsWith("image/")
      let assignedImageIndex: number | null = null

      // Assign image index immediately if it's an image
      // Use ref for synchronous access, then update state
      if (isImage) {
        assignedImageIndex = imageCountRef.current + 1
        imageCountRef.current = assignedImageIndex
        setImageCount(assignedImageIndex)
      }

      const pendingAttachment: PendingAttachment = {
        id: tempId,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        status: "uploading",
      }

      // Add as uploading
      setPendingAttachments((prev) => [...prev, pendingAttachment])

      try {
        const attachment = await attachmentsApi.upload(workspaceId, file)

        if (!attachment || !attachment.id) {
          throw new Error("Invalid response: missing attachment data")
        }

        const uploadedAttachment: PendingAttachment = {
          id: attachment.id,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          status: "uploaded",
        }

        // Replace temp with real attachment
        setPendingAttachments((prev) => prev.map((a) => (a.id === tempId ? uploadedAttachment : a)))

        return {
          attachment: uploadedAttachment,
          imageIndex: assignedImageIndex,
          tempId,
        }
      } catch (err) {
        const errorAttachment: PendingAttachment = {
          ...pendingAttachment,
          status: "error",
          error: err instanceof Error ? err.message : "Upload failed",
        }

        // Mark as error
        setPendingAttachments((prev) => prev.map((a) => (a.id === tempId ? errorAttachment : a)))

        return {
          attachment: errorAttachment,
          imageIndex: assignedImageIndex,
          tempId,
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
    setImageCount(0)
    imageCountRef.current = 0
  }, [])

  const restore = useCallback(
    (attachments: Array<{ id: string; filename: string; mimeType: string; sizeBytes: number }>) => {
      setPendingAttachments(
        attachments.map((a) => ({
          ...a,
          status: "uploaded" as const,
        }))
      )
      // Count images for proper numbering
      const restoredImageCount = attachments.filter((a) => a.mimeType.startsWith("image/")).length
      setImageCount(restoredImageCount)
      imageCountRef.current = restoredImageCount
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
    uploadFile,
    removeAttachment,
    uploadedIds,
    isUploading,
    hasFailed,
    clear,
    restore,
    imageCount,
  }
}
