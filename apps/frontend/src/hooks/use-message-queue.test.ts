import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useMessageQueue } from "./use-message-queue"

// Mock dependencies
const mockCreate = vi.fn()
const mockMarkPending = vi.fn()
const mockMarkFailed = vi.fn()
const mockMarkSent = vi.fn()
const mockRegisterQueueNotify = vi.fn()
let mockIsConnected = true

vi.mock("@/contexts", () => ({
  useSocketConnected: () => mockIsConnected,
  useMessageService: () => ({
    create: mockCreate,
  }),
  usePendingMessages: () => ({
    markPending: mockMarkPending,
    markFailed: mockMarkFailed,
    markSent: mockMarkSent,
    registerQueueNotify: mockRegisterQueueNotify,
  }),
}))

const mockSetQueryData = vi.fn()
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    setQueryData: mockSetQueryData,
  }),
}))

// Mock IndexedDB
interface MockPendingMessage {
  clientId: string
  workspaceId: string
  streamId: string
  content: string
  contentFormat: string
  contentJson?: { type: string; content: Array<{ type: string; content?: Array<{ type: string; text: string }> }> }
  attachmentIds?: string[]
  createdAt: number
  retryCount: number
}

let mockPendingMessages: MockPendingMessage[] = []
const mockDelete = vi.fn().mockImplementation((id: string) => {
  mockPendingMessages = mockPendingMessages.filter((m) => m.clientId !== id)
  return Promise.resolve()
})
const mockUpdate = vi.fn().mockResolvedValue(1)

const mockEventsDelete = vi.fn().mockResolvedValue(undefined)
const mockEventsUpdate = vi.fn().mockResolvedValue(1)

vi.mock("@/db", () => ({
  db: {
    pendingMessages: {
      orderBy: () => ({
        toArray: () => Promise.resolve([...mockPendingMessages]),
      }),
      delete: (...args: unknown[]) => mockDelete(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
    events: {
      delete: (...args: unknown[]) => mockEventsDelete(...args),
      update: (...args: unknown[]) => mockEventsUpdate(...args),
    },
  },
}))

vi.mock("./use-streams", () => ({
  streamKeys: {
    bootstrap: (wsId: string, sId: string) => ["stream", "bootstrap", wsId, sId],
  },
}))

vi.mock("@threa/prosemirror", () => ({
  parseMarkdown: (md: string) => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: md }] }],
  }),
}))

describe("useMessageQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPendingMessages = []
    mockIsConnected = true
    mockCreate.mockResolvedValue({ id: "msg_1" })
  })

  it("should register its notify callback on mount", () => {
    renderHook(() => useMessageQueue())

    expect(mockRegisterQueueNotify).toHaveBeenCalledWith(expect.any(Function))
  })

  it("should process a pending message when connected", async () => {
    mockPendingMessages = [
      {
        clientId: "temp_abc",
        workspaceId: "ws_1",
        streamId: "stream_1",
        content: "Hello",
        contentFormat: "markdown",
        contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] },
        createdAt: 1000,
        retryCount: 0,
      },
    ]

    renderHook(() => useMessageQueue())

    // Wait for async queue processing
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    expect(mockMarkPending).toHaveBeenCalledWith("temp_abc")
    expect(mockCreate).toHaveBeenCalledWith("ws_1", "stream_1", {
      streamId: "stream_1",
      contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] },
      contentMarkdown: "Hello",
      attachmentIds: undefined,
    })
    expect(mockDelete).toHaveBeenCalledWith("temp_abc")
    expect(mockMarkSent).toHaveBeenCalledWith("temp_abc")
  })

  it("should mark message as failed and increment retryCount when API call fails", async () => {
    mockCreate.mockRejectedValue(new Error("Network error"))
    mockPendingMessages = [
      {
        clientId: "temp_fail",
        workspaceId: "ws_1",
        streamId: "stream_1",
        content: "Fail",
        contentFormat: "markdown",
        createdAt: 1000,
        retryCount: 0,
      },
    ]

    renderHook(() => useMessageQueue())

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    expect(mockUpdate).toHaveBeenCalledWith("temp_fail", { retryCount: 1 })
    expect(mockEventsUpdate).toHaveBeenCalledWith("temp_fail", { _status: "failed" })
    expect(mockMarkFailed).toHaveBeenCalledWith("temp_fail")
  })

  it("should skip messages that have exceeded max retry count", async () => {
    mockPendingMessages = [
      {
        clientId: "temp_exhausted",
        workspaceId: "ws_1",
        streamId: "stream_1",
        content: "Exhausted",
        contentFormat: "markdown",
        createdAt: 1000,
        retryCount: 3,
      },
    ]

    renderHook(() => useMessageQueue())

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockMarkFailed).toHaveBeenCalledWith("temp_exhausted")
    expect(mockEventsUpdate).toHaveBeenCalledWith("temp_exhausted", { _status: "failed" })
    expect(mockDelete).toHaveBeenCalledWith("temp_exhausted")
  })

  it("should not attempt send or increment retryCount when offline", async () => {
    mockIsConnected = false
    mockPendingMessages = [
      {
        clientId: "temp_offline",
        workspaceId: "ws_1",
        streamId: "stream_1",
        content: "Offline msg",
        contentFormat: "markdown",
        createdAt: 1000,
        retryCount: 0,
      },
    ]

    renderHook(() => useMessageQueue())

    // Trigger the queue via the registered notify callback
    const notifyFn = mockRegisterQueueNotify.mock.calls[0][0]
    await act(async () => {
      notifyFn()
      await new Promise((r) => setTimeout(r, 10))
    })

    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockMarkFailed).not.toHaveBeenCalled()
    expect(mockDelete).not.toHaveBeenCalled()
    // Message should still be in the queue untouched
    expect(mockPendingMessages).toHaveLength(1)
    expect(mockPendingMessages[0].retryCount).toBe(0)
  })

  it("should reset db.events._status to pending before retrying a failed message", async () => {
    mockPendingMessages = [
      {
        clientId: "temp_retry_status",
        workspaceId: "ws_1",
        streamId: "stream_1",
        content: "Retry me",
        contentFormat: "markdown",
        createdAt: 1000,
        retryCount: 1,
      },
    ]

    renderHook(() => useMessageQueue())

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    // The first events.update call should be the _status: "pending" reset
    expect(mockEventsUpdate).toHaveBeenCalledWith("temp_retry_status", { _status: "pending" })
    expect(mockMarkPending).toHaveBeenCalledWith("temp_retry_status")
  })

  it("should deliver newer messages when an older message fails (no head-of-line blocking)", async () => {
    // Message A will fail, message B should still be delivered
    let callCount = 0
    mockCreate.mockImplementation(() => {
      callCount++
      if (callCount === 1) return Promise.reject(new Error("Server error"))
      return Promise.resolve({ id: "msg_b" })
    })

    mockPendingMessages = [
      {
        clientId: "temp_a",
        workspaceId: "ws_1",
        streamId: "stream_1",
        content: "Message A",
        contentFormat: "markdown",
        createdAt: 1000,
        retryCount: 0,
      },
      {
        clientId: "temp_b",
        workspaceId: "ws_1",
        streamId: "stream_1",
        content: "Message B",
        contentFormat: "markdown",
        createdAt: 2000,
        retryCount: 0,
      },
    ]

    renderHook(() => useMessageQueue())

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    // A should have failed and been skipped
    expect(mockMarkFailed).toHaveBeenCalledWith("temp_a")
    // B should have been sent successfully
    expect(mockMarkSent).toHaveBeenCalledWith("temp_b")
    expect(mockCreate).toHaveBeenCalledTimes(2)
  })

  it("should process messages with attachmentIds", async () => {
    mockPendingMessages = [
      {
        clientId: "temp_attach",
        workspaceId: "ws_1",
        streamId: "stream_1",
        content: "With attachments",
        contentFormat: "markdown",
        contentJson: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "With attachments" }] }],
        },
        attachmentIds: ["attach_1", "attach_2"],
        createdAt: 1000,
        retryCount: 0,
      },
    ]

    renderHook(() => useMessageQueue())

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    expect(mockCreate).toHaveBeenCalledWith("ws_1", "stream_1", {
      streamId: "stream_1",
      contentJson: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "With attachments" }] }],
      },
      contentMarkdown: "With attachments",
      attachmentIds: ["attach_1", "attach_2"],
    })
  })
})
