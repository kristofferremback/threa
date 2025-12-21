/**
 * E2E tests for file attachments.
 *
 * Tests the full flow: upload to MinIO, store metadata, attach to messages.
 * Requires MinIO to be running (started by dev script or docker-compose).
 *
 * Run with: bun test --preload ./tests/setup.ts tests/e2e/attachments.test.ts
 */

import { describe, test, expect } from "bun:test"
import {
  TestClient,
  loginAs,
  createWorkspace,
  createScratchpad,
  uploadAttachment,
  getAttachmentDownloadUrl,
  deleteAttachment,
  sendMessageWithAttachments,
  sendMessage,
} from "../client"

const testRunId = Math.random().toString(36).substring(7)
const testEmail = (name: string) => `${name}-${testRunId}@test.com`

describe("File Attachments E2E", () => {
  describe("Upload", () => {
    test("should upload a text file and store metadata", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("upload-text"), "Upload Text Test")
      const workspace = await createWorkspace(client, `Upload WS ${testRunId}`)
      const stream = await createScratchpad(client, workspace.id)

      const attachment = await uploadAttachment(client, workspace.id, stream.id, {
        content: "Hello, world! This is a test file.",
        filename: "hello.txt",
        mimeType: "text/plain",
      })

      expect(attachment).toMatchObject({
        workspaceId: workspace.id,
        streamId: stream.id,
        filename: "hello.txt",
        mimeType: "text/plain",
        messageId: null,
        storageProvider: "s3",
        processingStatus: "pending",
      })
      expect(attachment.id).toMatch(/^attach_/)
      expect(attachment.sizeBytes).toBeGreaterThan(0)
    })

    test("should upload an image file", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("upload-image"), "Upload Image Test")
      const workspace = await createWorkspace(client, `Upload Img WS ${testRunId}`)
      const stream = await createScratchpad(client, workspace.id)

      // Create a minimal PNG (1x1 transparent pixel)
      const pngData = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00,
        0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
        0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d,
        0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
      ])

      const attachment = await uploadAttachment(client, workspace.id, stream.id, {
        content: pngData,
        filename: "pixel.png",
        mimeType: "image/png",
      })

      expect(attachment.filename).toBe("pixel.png")
      expect(attachment.mimeType).toBe("image/png")
      expect(attachment.sizeBytes).toBe(pngData.length)
    })

    test("should reject disallowed file types", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("upload-reject"), "Upload Reject Test")
      const workspace = await createWorkspace(client, `Upload Reject WS ${testRunId}`)
      const stream = await createScratchpad(client, workspace.id)

      const { status, data } = await client.uploadFile<{ error: string }>(
        `/api/workspaces/${workspace.id}/streams/${stream.id}/attachments`,
        {
          content: "#!/bin/bash\necho 'hello'",
          filename: "script.exe",
          mimeType: "application/x-executable",
        }
      )

      expect(status).toBe(400)
      expect(data.error).toContain("not allowed")
    })

    test("should require stream membership", async () => {
      const client1 = new TestClient()
      const client2 = new TestClient()

      await loginAs(client1, testEmail("upload-member-1"), "Upload Member 1")
      await loginAs(client2, testEmail("upload-member-2"), "Upload Member 2")

      const workspace = await createWorkspace(client1, `Upload Member WS ${testRunId}`)
      const stream = await createScratchpad(client1, workspace.id)

      // client2 is not a member of the workspace
      const { status, data } = await client2.uploadFile<{ error: string }>(
        `/api/workspaces/${workspace.id}/streams/${stream.id}/attachments`,
        {
          content: "Should not upload",
          filename: "forbidden.txt",
          mimeType: "text/plain",
        }
      )

      expect(status).toBe(403)
      expect(data.error).toContain("Not a member")
    })
  })

  describe("Download URL", () => {
    test("should generate presigned download URL", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("download-url"), "Download URL Test")
      const workspace = await createWorkspace(client, `Download WS ${testRunId}`)
      const stream = await createScratchpad(client, workspace.id)

      const attachment = await uploadAttachment(client, workspace.id, stream.id, {
        content: "Content to download",
        filename: "download-me.txt",
        mimeType: "text/plain",
      })

      const url = await getAttachmentDownloadUrl(client, workspace.id, attachment.id)

      expect(url).toMatch(/^http/)
      expect(url).toContain(attachment.id)
      // URL should be a presigned S3/MinIO URL
      expect(url).toMatch(/X-Amz-Signature|signature/)
    })

    test("should actually be downloadable from MinIO", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("download-real"), "Download Real Test")
      const workspace = await createWorkspace(client, `Download Real WS ${testRunId}`)
      const stream = await createScratchpad(client, workspace.id)

      const content = `Test content ${testRunId}`
      const attachment = await uploadAttachment(client, workspace.id, stream.id, {
        content,
        filename: "real-download.txt",
        mimeType: "text/plain",
      })

      const url = await getAttachmentDownloadUrl(client, workspace.id, attachment.id)

      // Actually fetch from MinIO
      const response = await fetch(url)
      expect(response.ok).toBe(true)

      const downloaded = await response.text()
      expect(downloaded).toBe(content)
    })
  })

  describe("Attach to Message", () => {
    test("should attach file to message", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("attach-msg"), "Attach Message Test")
      const workspace = await createWorkspace(client, `Attach WS ${testRunId}`)
      const stream = await createScratchpad(client, workspace.id)

      // Upload first
      const attachment = await uploadAttachment(client, workspace.id, stream.id, {
        content: "File attached to message",
        filename: "attached.txt",
        mimeType: "text/plain",
      })

      expect(attachment.messageId).toBeNull()

      // Send message with attachment
      const message = await sendMessageWithAttachments(client, workspace.id, stream.id, "Here is the file", [
        attachment.id,
      ])

      expect(message.id).toMatch(/^msg_/)
      expect(message.content).toBe("Here is the file")
    })

    test("should attach multiple files to message", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("attach-multi"), "Attach Multi Test")
      const workspace = await createWorkspace(client, `Attach Multi WS ${testRunId}`)
      const stream = await createScratchpad(client, workspace.id)

      const attach1 = await uploadAttachment(client, workspace.id, stream.id, {
        content: "File 1",
        filename: "file1.txt",
        mimeType: "text/plain",
      })

      const attach2 = await uploadAttachment(client, workspace.id, stream.id, {
        content: "File 2",
        filename: "file2.txt",
        mimeType: "text/plain",
      })

      const message = await sendMessageWithAttachments(client, workspace.id, stream.id, "Multiple files attached", [
        attach1.id,
        attach2.id,
      ])

      expect(message.id).toMatch(/^msg_/)
    })

    test("should send message without attachments", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("no-attach"), "No Attach Test")
      const workspace = await createWorkspace(client, `No Attach WS ${testRunId}`)
      const stream = await createScratchpad(client, workspace.id)

      // Regular message without attachments still works
      const message = await sendMessage(client, workspace.id, stream.id, "No files here")

      expect(message.id).toMatch(/^msg_/)
      expect(message.content).toBe("No files here")
    })
  })

  describe("Delete", () => {
    test("should delete unattached file", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("delete-unattached"), "Delete Unattached Test")
      const workspace = await createWorkspace(client, `Delete WS ${testRunId}`)
      const stream = await createScratchpad(client, workspace.id)

      const attachment = await uploadAttachment(client, workspace.id, stream.id, {
        content: "To be deleted",
        filename: "delete-me.txt",
        mimeType: "text/plain",
      })

      await deleteAttachment(client, workspace.id, attachment.id)

      // Should no longer be accessible
      const { status } = await client.get(`/api/workspaces/${workspace.id}/attachments/${attachment.id}/url`)
      expect(status).toBe(404)
    })

    test("should not delete attached file", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("delete-attached"), "Delete Attached Test")
      const workspace = await createWorkspace(client, `Delete Attached WS ${testRunId}`)
      const stream = await createScratchpad(client, workspace.id)

      const attachment = await uploadAttachment(client, workspace.id, stream.id, {
        content: "Attached, cannot delete",
        filename: "keep-me.txt",
        mimeType: "text/plain",
      })

      // Attach to message
      await sendMessageWithAttachments(client, workspace.id, stream.id, "Keeping this file", [attachment.id])

      // Try to delete
      const { status, data } = await client.delete<{ error: string }>(
        `/api/workspaces/${workspace.id}/attachments/${attachment.id}`
      )

      expect(status).toBe(403)
      expect(data.error).toContain("Cannot delete attached")
    })
  })

  describe("Full Flow", () => {
    test("should complete upload-attach-download journey", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("full-flow"), "Full Flow Test")
      const workspace = await createWorkspace(client, `Full Flow WS ${testRunId}`)
      const stream = await createScratchpad(client, workspace.id)

      // 1. Upload file
      const content = `Full flow test content ${testRunId}`
      const attachment = await uploadAttachment(client, workspace.id, stream.id, {
        content,
        filename: "full-flow.txt",
        mimeType: "text/plain",
      })

      expect(attachment.id).toMatch(/^attach_/)
      expect(attachment.messageId).toBeNull()

      // 2. Attach to message
      const message = await sendMessageWithAttachments(client, workspace.id, stream.id, "Check out this file!", [
        attachment.id,
      ])

      expect(message.id).toMatch(/^msg_/)

      // 3. Get download URL and verify content
      const url = await getAttachmentDownloadUrl(client, workspace.id, attachment.id)
      const response = await fetch(url)
      const downloaded = await response.text()

      expect(downloaded).toBe(content)
    })
  })
})
