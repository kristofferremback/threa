import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useDraftComposer } from "./use-draft-composer"

// Mock useDraftMessage
const mockSaveDraftDebounced = vi.fn()
const mockAddDraftAttachment = vi.fn()
const mockRemoveDraftAttachment = vi.fn()
const mockClearDraft = vi.fn()

let mockDraftIsLoaded = true
let mockDraftContent = ""
let mockDraftAttachments: Array<{ id: string; filename: string; mimeType: string; sizeBytes: number }> = []

vi.mock("./use-draft-message", () => ({
  useDraftMessage: () => ({
    isLoaded: mockDraftIsLoaded,
    content: mockDraftContent,
    attachments: mockDraftAttachments,
    saveDraftDebounced: mockSaveDraftDebounced,
    addAttachment: mockAddDraftAttachment,
    removeAttachment: mockRemoveDraftAttachment,
    clearDraft: mockClearDraft,
  }),
}))

// Mock useAttachments
let mockPendingAttachments: Array<{
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  status: "uploading" | "uploaded" | "error"
  error?: string
}> = []

const mockFileInputRef = { current: null }
const mockHandleFileSelect = vi.fn()
const mockRemoveAttachment = vi.fn()
const mockClearAttachments = vi.fn()
const mockRestoreAttachments = vi.fn()

vi.mock("./use-attachments", () => ({
  useAttachments: () => ({
    pendingAttachments: mockPendingAttachments,
    fileInputRef: mockFileInputRef,
    handleFileSelect: mockHandleFileSelect,
    removeAttachment: mockRemoveAttachment,
    uploadedIds: mockPendingAttachments
      .filter((a) => a.status === "uploaded" && !a.id.startsWith("temp_"))
      .map((a) => a.id),
    isUploading: mockPendingAttachments.some((a) => a.status === "uploading"),
    hasFailed: mockPendingAttachments.some((a) => a.status === "error"),
    clear: mockClearAttachments,
    restore: mockRestoreAttachments,
  }),
}))

describe("useDraftComposer", () => {
  const workspaceId = "ws_123"
  const draftKey = "stream:stream_456"
  const scopeId = "stream_456"

  beforeEach(() => {
    vi.clearAllMocks()
    mockDraftIsLoaded = true
    mockDraftContent = ""
    mockDraftAttachments = []
    mockPendingAttachments = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe("initialization", () => {
    it("should return isLoaded=false while draft is loading", () => {
      mockDraftIsLoaded = false

      const { result } = renderHook(() => useDraftComposer({ workspaceId, draftKey, scopeId }))

      expect(result.current.isLoaded).toBe(false)
      expect(result.current.content).toBe("")
    })

    it("should return isLoaded=true after draft finishes loading", () => {
      mockDraftIsLoaded = true

      const { result } = renderHook(() => useDraftComposer({ workspaceId, draftKey, scopeId }))

      expect(result.current.isLoaded).toBe(true)
    })

    it("should restore saved content on initialization", () => {
      mockDraftIsLoaded = true
      mockDraftContent = "Saved content"

      const { result } = renderHook(() => useDraftComposer({ workspaceId, draftKey, scopeId }))

      expect(result.current.content).toBe("Saved content")
    })

    it("should restore saved attachments on initialization", () => {
      mockDraftIsLoaded = true
      mockDraftAttachments = [{ id: "attach_1", filename: "test.txt", mimeType: "text/plain", sizeBytes: 100 }]

      renderHook(() => useDraftComposer({ workspaceId, draftKey, scopeId }))

      expect(mockRestoreAttachments).toHaveBeenCalledWith(mockDraftAttachments)
    })

    it("should not restore while still loading", () => {
      mockDraftIsLoaded = false
      mockDraftContent = "Should not appear"
      mockDraftAttachments = [{ id: "attach_1", filename: "test.txt", mimeType: "text/plain", sizeBytes: 100 }]

      renderHook(() => useDraftComposer({ workspaceId, draftKey, scopeId }))

      expect(mockRestoreAttachments).not.toHaveBeenCalled()
    })

    it("should use initialContent when provided", () => {
      mockDraftIsLoaded = true
      mockDraftContent = "" // No saved draft

      const { result } = renderHook(() =>
        useDraftComposer({ workspaceId, draftKey, scopeId, initialContent: "Initial text" })
      )

      expect(result.current.content).toBe("Initial text")
    })
  })

  describe("scope change", () => {
    it("should reset content when scopeId changes", () => {
      const { result, rerender } = renderHook(({ scopeId }) => useDraftComposer({ workspaceId, draftKey, scopeId }), {
        initialProps: { scopeId: "stream_1" },
      })

      // Set content
      act(() => {
        result.current.setContent("Some content")
      })
      expect(result.current.content).toBe("Some content")

      // Change scope
      rerender({ scopeId: "stream_2" })

      expect(result.current.content).toBe("")
    })

    it("should clear attachments when scopeId changes", () => {
      const { rerender } = renderHook(({ scopeId }) => useDraftComposer({ workspaceId, draftKey, scopeId }), {
        initialProps: { scopeId: "stream_1" },
      })

      // Change scope
      rerender({ scopeId: "stream_2" })

      expect(mockClearAttachments).toHaveBeenCalled()
    })
  })

  describe("handleContentChange", () => {
    it("should update content immediately", () => {
      const { result } = renderHook(() => useDraftComposer({ workspaceId, draftKey, scopeId }))

      act(() => {
        result.current.handleContentChange("New content")
      })

      expect(result.current.content).toBe("New content")
    })

    it("should call saveDraftDebounced", () => {
      const { result } = renderHook(() => useDraftComposer({ workspaceId, draftKey, scopeId }))

      act(() => {
        result.current.handleContentChange("New content")
      })

      expect(mockSaveDraftDebounced).toHaveBeenCalledWith("New content")
    })
  })

  describe("handleRemoveAttachment", () => {
    it("should remove from both UI and draft storage", () => {
      const { result } = renderHook(() => useDraftComposer({ workspaceId, draftKey, scopeId }))

      act(() => {
        result.current.handleRemoveAttachment("attach_123")
      })

      expect(mockRemoveAttachment).toHaveBeenCalledWith("attach_123")
      expect(mockRemoveDraftAttachment).toHaveBeenCalledWith("attach_123")
    })
  })

  describe("canSend", () => {
    it("should be true with content", () => {
      const { result } = renderHook(() => useDraftComposer({ workspaceId, draftKey, scopeId }))

      act(() => {
        result.current.setContent("Hello")
      })

      expect(result.current.canSend).toBe(true)
    })

    it("should be true with uploaded attachments only", () => {
      mockPendingAttachments = [
        { id: "attach_1", filename: "test.txt", mimeType: "text/plain", sizeBytes: 100, status: "uploaded" },
      ]

      const { result } = renderHook(() => useDraftComposer({ workspaceId, draftKey, scopeId }))

      expect(result.current.canSend).toBe(true)
    })

    it("should be false when sending", () => {
      const { result } = renderHook(() => useDraftComposer({ workspaceId, draftKey, scopeId }))

      act(() => {
        result.current.setContent("Hello")
        result.current.setIsSending(true)
      })

      expect(result.current.canSend).toBe(false)
    })

    it("should be false when uploading", () => {
      mockPendingAttachments = [
        { id: "temp_1", filename: "test.txt", mimeType: "text/plain", sizeBytes: 100, status: "uploading" },
      ]

      const { result } = renderHook(() => useDraftComposer({ workspaceId, draftKey, scopeId }))

      act(() => {
        result.current.setContent("Hello")
      })

      expect(result.current.canSend).toBe(false)
    })

    it("should be false when uploads have failed", () => {
      mockPendingAttachments = [
        { id: "temp_1", filename: "test.txt", mimeType: "text/plain", sizeBytes: 100, status: "error" },
      ]

      const { result } = renderHook(() => useDraftComposer({ workspaceId, draftKey, scopeId }))

      act(() => {
        result.current.setContent("Hello")
      })

      expect(result.current.canSend).toBe(false)
    })

    it("should be false with empty content and no attachments", () => {
      const { result } = renderHook(() => useDraftComposer({ workspaceId, draftKey, scopeId }))

      expect(result.current.canSend).toBe(false)
    })

    it("should be false with whitespace-only content", () => {
      const { result } = renderHook(() => useDraftComposer({ workspaceId, draftKey, scopeId }))

      act(() => {
        result.current.setContent("   ")
      })

      expect(result.current.canSend).toBe(false)
    })
  })

  describe("isSending state", () => {
    it("should update when setIsSending is called", () => {
      const { result } = renderHook(() => useDraftComposer({ workspaceId, draftKey, scopeId }))

      expect(result.current.isSending).toBe(false)

      act(() => {
        result.current.setIsSending(true)
      })

      expect(result.current.isSending).toBe(true)

      act(() => {
        result.current.setIsSending(false)
      })

      expect(result.current.isSending).toBe(false)
    })
  })

  describe("clear helpers", () => {
    it("should expose clearDraft from useDraftMessage", () => {
      const { result } = renderHook(() => useDraftComposer({ workspaceId, draftKey, scopeId }))

      act(() => {
        result.current.clearDraft()
      })

      expect(mockClearDraft).toHaveBeenCalled()
    })

    it("should expose clearAttachments from useAttachments", () => {
      const { result } = renderHook(() => useDraftComposer({ workspaceId, draftKey, scopeId }))

      act(() => {
        result.current.clearAttachments()
      })

      expect(mockClearAttachments).toHaveBeenCalled()
    })
  })

  describe("attachment passthrough", () => {
    it("should expose pendingAttachments", () => {
      mockPendingAttachments = [
        { id: "attach_1", filename: "test.txt", mimeType: "text/plain", sizeBytes: 100, status: "uploaded" },
      ]

      const { result } = renderHook(() => useDraftComposer({ workspaceId, draftKey, scopeId }))

      expect(result.current.pendingAttachments).toEqual(mockPendingAttachments)
    })

    it("should expose uploadedIds", () => {
      mockPendingAttachments = [
        { id: "attach_1", filename: "test.txt", mimeType: "text/plain", sizeBytes: 100, status: "uploaded" },
        { id: "temp_2", filename: "uploading.txt", mimeType: "text/plain", sizeBytes: 100, status: "uploading" },
      ]

      const { result } = renderHook(() => useDraftComposer({ workspaceId, draftKey, scopeId }))

      expect(result.current.uploadedIds).toEqual(["attach_1"])
    })

    it("should expose isUploading", () => {
      mockPendingAttachments = [
        { id: "temp_1", filename: "test.txt", mimeType: "text/plain", sizeBytes: 100, status: "uploading" },
      ]

      const { result } = renderHook(() => useDraftComposer({ workspaceId, draftKey, scopeId }))

      expect(result.current.isUploading).toBe(true)
    })

    it("should expose hasFailed", () => {
      mockPendingAttachments = [
        { id: "temp_1", filename: "test.txt", mimeType: "text/plain", sizeBytes: 100, status: "error" },
      ]

      const { result } = renderHook(() => useDraftComposer({ workspaceId, draftKey, scopeId }))

      expect(result.current.hasFailed).toBe(true)
    })

    it("should expose fileInputRef", () => {
      const { result } = renderHook(() => useDraftComposer({ workspaceId, draftKey, scopeId }))

      expect(result.current.fileInputRef).toBe(mockFileInputRef)
    })

    it("should expose handleFileSelect", () => {
      const { result } = renderHook(() => useDraftComposer({ workspaceId, draftKey, scopeId }))

      expect(result.current.handleFileSelect).toBe(mockHandleFileSelect)
    })
  })
})
