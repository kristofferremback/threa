import type { Request, Response } from "express"
import type { AttachmentService } from "../services/attachment-service"
import type { StreamService } from "../services/stream-service"

interface Dependencies {
  attachmentService: AttachmentService
  streamService: StreamService
}

export function createAttachmentHandlers({ attachmentService, streamService }: Dependencies) {
  return {
    async upload(req: Request, res: Response) {
      const userId = req.userId!
      const workspaceId = req.workspaceId!
      const { streamId } = req.params

      // Validate stream exists and belongs to workspace
      const stream = await streamService.getStreamById(streamId)
      if (!stream || stream.workspaceId !== workspaceId) {
        return res.status(404).json({ error: "Stream not found" })
      }

      // Validate user is a member of the stream
      const isMember = await streamService.isMember(streamId, userId)
      if (!isMember) {
        return res.status(403).json({ error: "Not a member of this stream" })
      }

      // Check file was uploaded
      const file = req.file
      if (!file) {
        return res.status(400).json({ error: "No file provided" })
      }

      const attachment = await attachmentService.upload({
        workspaceId,
        streamId,
        filename: file.originalname,
        mimeType: file.mimetype,
        filePath: file.path,
        sizeBytes: file.size,
      })

      res.status(201).json({ attachment })
    },

    async getDownloadUrl(req: Request, res: Response) {
      const userId = req.userId!
      const workspaceId = req.workspaceId!
      const { attachmentId } = req.params

      const attachment = await attachmentService.getById(attachmentId)
      if (!attachment || attachment.workspaceId !== workspaceId) {
        return res.status(404).json({ error: "Attachment not found" })
      }

      // Validate user has access to the stream
      const isMember = await streamService.isMember(attachment.streamId, userId)
      if (!isMember) {
        return res.status(403).json({ error: "Access denied" })
      }

      const url = await attachmentService.getDownloadUrl(attachment)
      res.json({ url, expiresIn: 900 })
    },

    async delete(req: Request, res: Response) {
      const userId = req.userId!
      const workspaceId = req.workspaceId!
      const { attachmentId } = req.params

      const attachment = await attachmentService.getById(attachmentId)
      if (!attachment || attachment.workspaceId !== workspaceId) {
        return res.status(404).json({ error: "Attachment not found" })
      }

      // Only allow deletion of unattached files
      if (attachment.messageId) {
        return res.status(403).json({ error: "Cannot delete attached files" })
      }

      // Validate user has access to the stream
      const isMember = await streamService.isMember(attachment.streamId, userId)
      if (!isMember) {
        return res.status(403).json({ error: "Access denied" })
      }

      await attachmentService.delete(attachmentId)
      res.status(204).send()
    },
  }
}
