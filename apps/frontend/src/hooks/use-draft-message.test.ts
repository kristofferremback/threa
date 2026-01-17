import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useDraftMessage, getDraftMessageKey } from "./use-draft-message"
import type { JSONContent } from "@threa/types"

const EMPTY_DOC: JSONContent = { type: "doc", content: [{ type: "paragraph" }] }
const makeDoc = (text: string): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : undefined }],
})

// Mock Dexie database
const mockGet = vi.fn()
const mockPut = vi.fn()
const mockDelete = vi.fn()

vi.mock("@/db", () => ({
  db: {
    draftMessages: {
      get: (...args: unknown[]) => mockGet(...args),
      put: (...args: unknown[]) => mockPut(...args),
      delete: (...args: unknown[]) => mockDelete(...args),
    },
  },
}))

// Mock useLiveQuery to simulate Dexie's async loading behavior
let liveQueryResult: unknown = undefined
let liveQueryLoading = true

vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: (_queryFn: () => Promise<unknown>, _deps: unknown[], initialValue: unknown) => {
    // Return initial value while "loading", then the result
    if (liveQueryLoading) {
      return initialValue
    }
    return liveQueryResult
  },
}))

describe("getDraftMessageKey", () => {
  it("should return stream key format for stream type", () => {
    const key = getDraftMessageKey({ type: "stream", streamId: "stream_123" })
    expect(key).toBe("stream:stream_123")
  })

  it("should return thread key format for thread type", () => {
    const key = getDraftMessageKey({ type: "thread", parentMessageId: "msg_456" })
    expect(key).toBe("thread:msg_456")
  })
})

describe("useDraftMessage", () => {
  const workspaceId = "ws_123"
  const draftKey = "stream:stream_456"

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    liveQueryLoading = true
    liveQueryResult = undefined
    mockGet.mockResolvedValue(undefined)
    mockPut.mockResolvedValue(undefined)
    mockDelete.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe("isLoaded state", () => {
    it("should return isLoaded=false while Dexie is loading", () => {
      liveQueryLoading = true

      const { result } = renderHook(() => useDraftMessage(workspaceId, draftKey))

      expect(result.current.isLoaded).toBe(false)
      expect(result.current.contentJson).toEqual(EMPTY_DOC)
      expect(result.current.attachments).toEqual([])
    })

    it("should return isLoaded=true after Dexie finishes loading with no data", () => {
      liveQueryLoading = false
      liveQueryResult = undefined

      const { result } = renderHook(() => useDraftMessage(workspaceId, draftKey))

      expect(result.current.isLoaded).toBe(true)
      expect(result.current.contentJson).toEqual(EMPTY_DOC)
      expect(result.current.attachments).toEqual([])
    })

    it("should return isLoaded=true with saved content after Dexie loads", () => {
      liveQueryLoading = false
      const savedContentJson = makeDoc("Hello world")
      liveQueryResult = {
        id: draftKey,
        workspaceId,
        contentJson: savedContentJson,
        attachments: [{ id: "attach_1", filename: "test.txt", mimeType: "text/plain", sizeBytes: 100 }],
        updatedAt: Date.now(),
      }

      const { result } = renderHook(() => useDraftMessage(workspaceId, draftKey))

      expect(result.current.isLoaded).toBe(true)
      expect(result.current.contentJson).toEqual(savedContentJson)
      expect(result.current.attachments).toHaveLength(1)
      expect(result.current.attachments[0].filename).toBe("test.txt")
    })
  })

  describe("saveDraft", () => {
    it("should save content to database", async () => {
      liveQueryLoading = false
      liveQueryResult = undefined

      const { result } = renderHook(() => useDraftMessage(workspaceId, draftKey))
      const newContent = makeDoc("New content")

      await act(async () => {
        await result.current.saveDraft(newContent)
      })

      expect(mockPut).toHaveBeenCalledWith(
        expect.objectContaining({
          id: draftKey,
          workspaceId,
          contentJson: newContent,
          attachments: [],
        })
      )
    })

    it("should delete draft when content is empty and no attachments", async () => {
      liveQueryLoading = false
      liveQueryResult = undefined
      mockGet.mockResolvedValue({ attachments: [] })

      const { result } = renderHook(() => useDraftMessage(workspaceId, draftKey))

      await act(async () => {
        await result.current.saveDraft(EMPTY_DOC)
      })

      expect(mockDelete).toHaveBeenCalledWith(draftKey)
      expect(mockPut).not.toHaveBeenCalled()
    })

    it("should preserve existing attachments when saving content", async () => {
      liveQueryLoading = false
      const existingAttachments = [{ id: "attach_1", filename: "file.txt", mimeType: "text/plain", sizeBytes: 50 }]
      mockGet.mockResolvedValue({ attachments: existingAttachments })

      const { result } = renderHook(() => useDraftMessage(workspaceId, draftKey))
      const updatedContent = makeDoc("Updated content")

      await act(async () => {
        await result.current.saveDraft(updatedContent)
      })

      expect(mockPut).toHaveBeenCalledWith(
        expect.objectContaining({
          contentJson: updatedContent,
          attachments: existingAttachments,
        })
      )
    })
  })

  describe("saveDraftDebounced", () => {
    it("should debounce saves", async () => {
      liveQueryLoading = false
      liveQueryResult = undefined

      const { result } = renderHook(() => useDraftMessage(workspaceId, draftKey))
      const thirdContent = makeDoc("Third")

      act(() => {
        result.current.saveDraftDebounced(makeDoc("First"))
        result.current.saveDraftDebounced(makeDoc("Second"))
        result.current.saveDraftDebounced(thirdContent)
      })

      // Nothing saved yet
      expect(mockPut).not.toHaveBeenCalled()

      // Advance past debounce delay
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      // Only the last value should be saved
      expect(mockPut).toHaveBeenCalledTimes(1)
      expect(mockPut).toHaveBeenCalledWith(
        expect.objectContaining({
          contentJson: thirdContent,
        })
      )
    })
  })

  describe("addAttachment", () => {
    it("should add attachment to empty draft", async () => {
      liveQueryLoading = false
      mockGet.mockResolvedValue(undefined)

      const { result } = renderHook(() => useDraftMessage(workspaceId, draftKey))

      const attachment = { id: "attach_1", filename: "new.txt", mimeType: "text/plain", sizeBytes: 100 }

      await act(async () => {
        await result.current.addAttachment(attachment)
      })

      expect(mockPut).toHaveBeenCalledWith(
        expect.objectContaining({
          id: draftKey,
          workspaceId,
          contentJson: EMPTY_DOC,
          attachments: [attachment],
        })
      )
    })

    it("should not add duplicate attachment", async () => {
      liveQueryLoading = false
      const existingAttachment = { id: "attach_1", filename: "existing.txt", mimeType: "text/plain", sizeBytes: 50 }
      mockGet.mockResolvedValue({ contentJson: EMPTY_DOC, attachments: [existingAttachment] })

      const { result } = renderHook(() => useDraftMessage(workspaceId, draftKey))

      await act(async () => {
        await result.current.addAttachment(existingAttachment)
      })

      expect(mockPut).not.toHaveBeenCalled()
    })
  })

  describe("removeAttachment", () => {
    it("should remove attachment from draft", async () => {
      liveQueryLoading = false
      const attachments = [
        { id: "attach_1", filename: "file1.txt", mimeType: "text/plain", sizeBytes: 50 },
        { id: "attach_2", filename: "file2.txt", mimeType: "text/plain", sizeBytes: 100 },
      ]
      mockGet.mockResolvedValue({ id: draftKey, contentJson: makeDoc("Some content"), attachments })

      const { result } = renderHook(() => useDraftMessage(workspaceId, draftKey))

      await act(async () => {
        await result.current.removeAttachment("attach_1")
      })

      expect(mockPut).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [{ id: "attach_2", filename: "file2.txt", mimeType: "text/plain", sizeBytes: 100 }],
        })
      )
    })

    it("should delete draft when removing last attachment and content is empty", async () => {
      liveQueryLoading = false
      const attachment = { id: "attach_1", filename: "file.txt", mimeType: "text/plain", sizeBytes: 50 }
      mockGet.mockResolvedValue({ id: draftKey, contentJson: EMPTY_DOC, attachments: [attachment] })

      const { result } = renderHook(() => useDraftMessage(workspaceId, draftKey))

      await act(async () => {
        await result.current.removeAttachment("attach_1")
      })

      expect(mockDelete).toHaveBeenCalledWith(draftKey)
      expect(mockPut).not.toHaveBeenCalled()
    })
  })

  describe("clearDraft", () => {
    it("should delete the draft", async () => {
      liveQueryLoading = false

      const { result } = renderHook(() => useDraftMessage(workspaceId, draftKey))

      await act(async () => {
        await result.current.clearDraft()
      })

      expect(mockDelete).toHaveBeenCalledWith(draftKey)
    })

    it("should cancel pending debounced save", async () => {
      liveQueryLoading = false

      const { result } = renderHook(() => useDraftMessage(workspaceId, draftKey))

      act(() => {
        result.current.saveDraftDebounced(makeDoc("Will be cancelled"))
      })

      await act(async () => {
        await result.current.clearDraft()
      })

      // Advance past debounce
      await act(async () => {
        vi.advanceTimersByTime(600)
      })

      // Only delete should have been called, not put
      expect(mockDelete).toHaveBeenCalledWith(draftKey)
      expect(mockPut).not.toHaveBeenCalled()
    })
  })
})
