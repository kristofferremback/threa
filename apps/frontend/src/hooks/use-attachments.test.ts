import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { useAttachments } from "./use-attachments"

// Mock the attachments API
const mockUpload = vi.fn()
const mockDelete = vi.fn()

vi.mock("@/api", () => ({
  attachmentsApi: {
    upload: (...args: unknown[]) => mockUpload(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}))

describe("useAttachments", () => {
  const workspaceId = "ws_123"

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function createFile(name: string, type: string, size: number = 1024): File {
    const content = new Array(size).fill("a").join("")
    return new File([content], name, { type })
  }

  function createChangeEvent(files: File[]): React.ChangeEvent<HTMLInputElement> {
    // Create a mock FileList
    const fileList = {
      length: files.length,
      item: (index: number) => files[index] ?? null,
      [Symbol.iterator]: function* () {
        for (const file of files) yield file
      },
    } as FileList
    files.forEach((file, i) => {
      Object.defineProperty(fileList, i, { value: file, enumerable: true })
    })

    return {
      target: {
        files: fileList,
        value: "",
      },
    } as unknown as React.ChangeEvent<HTMLInputElement>
  }

  describe("file upload", () => {
    it("should add file as uploading then update to uploaded on success", async () => {
      mockUpload.mockResolvedValue({
        id: "attach_123",
        filename: "test.txt",
        mimeType: "text/plain",
        sizeBytes: 1024,
      })

      const { result } = renderHook(() => useAttachments(workspaceId))

      const file = createFile("test.txt", "text/plain")

      await act(async () => {
        await result.current.handleFileSelect(createChangeEvent([file]))
      })

      // Should have the uploaded attachment
      await waitFor(() => {
        expect(result.current.pendingAttachments).toHaveLength(1)
        expect(result.current.pendingAttachments[0]).toMatchObject({
          id: "attach_123",
          filename: "test.txt",
          status: "uploaded",
        })
      })

      expect(result.current.uploadedIds).toContain("attach_123")
      expect(result.current.isUploading).toBe(false)
      expect(result.current.hasFailed).toBe(false)
    })

    it("should mark attachment as error on upload failure", async () => {
      mockUpload.mockRejectedValue(new Error("Upload failed"))

      const { result } = renderHook(() => useAttachments(workspaceId))

      const file = createFile("test.txt", "text/plain")

      await act(async () => {
        await result.current.handleFileSelect(createChangeEvent([file]))
      })

      await waitFor(() => {
        expect(result.current.pendingAttachments).toHaveLength(1)
        expect(result.current.pendingAttachments[0].status).toBe("error")
        expect(result.current.pendingAttachments[0].error).toBe("Upload failed")
      })

      expect(result.current.hasFailed).toBe(true)
      expect(result.current.uploadedIds).toHaveLength(0)
    })

    it("should handle multiple files with mixed success/failure", async () => {
      mockUpload
        .mockResolvedValueOnce({
          id: "attach_1",
          filename: "success.txt",
          mimeType: "text/plain",
          sizeBytes: 100,
        })
        .mockRejectedValueOnce(new Error("Failed"))

      const { result } = renderHook(() => useAttachments(workspaceId))

      const file1 = createFile("success.txt", "text/plain", 100)
      const file2 = createFile("fail.txt", "text/plain", 100)

      await act(async () => {
        await result.current.handleFileSelect(createChangeEvent([file1, file2]))
      })

      await waitFor(() => {
        expect(result.current.pendingAttachments).toHaveLength(2)
      })

      const uploaded = result.current.pendingAttachments.find((a) => a.status === "uploaded")
      const failed = result.current.pendingAttachments.find((a) => a.status === "error")

      expect(uploaded?.filename).toBe("success.txt")
      expect(failed?.filename).toBe("fail.txt")
      expect(result.current.hasFailed).toBe(true)
      expect(result.current.uploadedIds).toEqual(["attach_1"])
    })
  })

  describe("remove attachment", () => {
    it("should remove attachment from pending list", async () => {
      mockUpload.mockResolvedValue({
        id: "attach_123",
        filename: "test.txt",
        mimeType: "text/plain",
        sizeBytes: 1024,
      })

      const { result } = renderHook(() => useAttachments(workspaceId))

      // Upload a file first
      await act(async () => {
        await result.current.handleFileSelect(createChangeEvent([createFile("test.txt", "text/plain")]))
      })

      await waitFor(() => {
        expect(result.current.pendingAttachments).toHaveLength(1)
      })

      // Remove it
      await act(async () => {
        await result.current.removeAttachment("attach_123")
      })

      expect(result.current.pendingAttachments).toHaveLength(0)
      expect(mockDelete).toHaveBeenCalledWith(workspaceId, "attach_123")
    })

    it("should not call delete API for failed uploads", async () => {
      mockUpload.mockRejectedValue(new Error("Failed"))

      const { result } = renderHook(() => useAttachments(workspaceId))

      await act(async () => {
        await result.current.handleFileSelect(createChangeEvent([createFile("test.txt", "text/plain")]))
      })

      await waitFor(() => {
        expect(result.current.pendingAttachments).toHaveLength(1)
        expect(result.current.pendingAttachments[0].status).toBe("error")
      })

      const tempId = result.current.pendingAttachments[0].id

      await act(async () => {
        await result.current.removeAttachment(tempId)
      })

      expect(result.current.pendingAttachments).toHaveLength(0)
      expect(mockDelete).not.toHaveBeenCalled()
    })
  })

  describe("clear", () => {
    it("should remove all pending attachments", async () => {
      mockUpload.mockResolvedValue({
        id: "attach_123",
        filename: "test.txt",
        mimeType: "text/plain",
        sizeBytes: 1024,
      })

      const { result } = renderHook(() => useAttachments(workspaceId))

      await act(async () => {
        await result.current.handleFileSelect(createChangeEvent([createFile("test.txt", "text/plain")]))
      })

      await waitFor(() => {
        expect(result.current.pendingAttachments).toHaveLength(1)
      })

      act(() => {
        result.current.clear()
      })

      expect(result.current.pendingAttachments).toHaveLength(0)
    })
  })

  describe("restore", () => {
    it("should populate attachments from saved state", () => {
      const { result } = renderHook(() => useAttachments(workspaceId))

      const savedAttachments = [
        { id: "attach_1", filename: "file1.txt", mimeType: "text/plain", sizeBytes: 100 },
        { id: "attach_2", filename: "file2.txt", mimeType: "text/plain", sizeBytes: 200 },
      ]

      act(() => {
        result.current.restore(savedAttachments)
      })

      expect(result.current.pendingAttachments).toHaveLength(2)
      expect(result.current.pendingAttachments[0]).toMatchObject({
        id: "attach_1",
        filename: "file1.txt",
        status: "uploaded",
      })
      expect(result.current.pendingAttachments[1]).toMatchObject({
        id: "attach_2",
        filename: "file2.txt",
        status: "uploaded",
      })
      expect(result.current.uploadedIds).toEqual(["attach_1", "attach_2"])
    })
  })
})
