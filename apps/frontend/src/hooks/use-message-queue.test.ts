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

const mockStreamCreate = vi.fn()

vi.mock("@/contexts", () => ({
  useSocketConnected: () => mockIsConnected,
  useMessageService: () => ({
    create: mockCreate,
  }),
  useStreamService: () => ({
    create: mockStreamCreate,
  }),
  usePendingMessages: () => ({
    markPending: mockMarkPending,
    markFailed: mockMarkFailed,
    markSent: mockMarkSent,
    registerQueueNotify: mockRegisterQueueNotify,
  }),
}))

const mockSubscribeStream = vi.fn()
vi.mock("@/sync/sync-engine", () => ({
  useSyncEngine: () => ({
    subscribeStream: mockSubscribeStream,
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
  retryAfter?: number
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
      get: (id: string) => Promise.resolve(mockPendingMessages.find((m) => m.clientId === id)),
      delete: (...args: unknown[]) => mockDelete(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
    events: {
      get: vi.fn().mockResolvedValue(undefined),
      put: vi.fn().mockResolvedValue(undefined),
      delete: (...args: unknown[]) => mockEventsDelete(...args),
      update: (...args: unknown[]) => mockEventsUpdate(...args),
    },
    streams: {
      put: vi.fn().mockResolvedValue(undefined),
    },
    draftScratchpads: {
      delete: vi.fn().mockResolvedValue(undefined),
    },
    draftMessages: {
      delete: vi.fn().mockResolvedValue(undefined),
    },
    transaction: vi.fn().mockImplementation((_mode: string, _tables: unknown, fn: () => Promise<void>) => fn()),
  },
  sequenceToNum: (seq: string) => Number(seq),
}))

vi.mock("./use-streams", () => ({
  streamKeys: {
    bootstrap: (wsId: string, sId: string) => ["stream", "bootstrap", wsId, sId],
  },
}))

vi.mock("./use-workspaces", () => ({
  workspaceKeys: {
    bootstrap: (wsId: string) => ["workspace", "bootstrap", wsId],
  },
}))

vi.mock("@threa/prosemirror", () => ({
  parseMarkdown: (md: string) => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: md }] }],
  }),
}))

vi.mock("@/lib/draft-promotions", () => ({
  emitDraftPromoted: vi.fn(),
}))

vi.mock("@/sync/stream-sync", () => ({
  optimisticReplyCountUpdate: vi.fn(),
}))

vi.mock("@/stores/draft-store", () => ({
  deleteDraftScratchpadFromCache: vi.fn(),
  deleteDraftMessageFromCache: vi.fn(),
}))

vi.mock("@threa/types", () => ({
  StreamTypes: {
    THREAD: "thread",
    SCRATCHPAD: "scratchpad",
  },
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
      clientMessageId: "temp_abc",
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

    expect(mockUpdate).toHaveBeenCalledWith("temp_fail", {
      retryCount: 1,
      retryAfter: expect.any(Number),
    })
    expect(mockEventsUpdate).toHaveBeenCalledWith("temp_fail", { _status: "failed" })
    expect(mockMarkFailed).toHaveBeenCalledWith("temp_fail")
  })

  it("should retry high-retry-count messages (no max retry cap) with backoff", async () => {
    mockPendingMessages = [
      {
        clientId: "temp_many_retries",
        workspaceId: "ws_1",
        streamId: "stream_1",
        content: "Persistent",
        contentFormat: "markdown",
        createdAt: 1000,
        retryCount: 10,
        retryAfter: 0, // backoff expired, ready to retry
      },
    ]

    renderHook(() => useMessageQueue())

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    // Should still attempt to send — no retry cap
    expect(mockCreate).toHaveBeenCalled()
    expect(mockMarkPending).toHaveBeenCalledWith("temp_many_retries")
  })

  it("should skip messages whose retryAfter has not passed", async () => {
    mockPendingMessages = [
      {
        clientId: "temp_backoff",
        workspaceId: "ws_1",
        streamId: "stream_1",
        content: "Waiting",
        contentFormat: "markdown",
        createdAt: 1000,
        retryCount: 5,
        retryAfter: Date.now() + 60_000, // 1 minute in the future
      },
    ]

    renderHook(() => useMessageQueue())

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    // Should NOT attempt to send — backoff hasn't expired
    expect(mockCreate).not.toHaveBeenCalled()
    // Message stays in queue, not marked as failed
    expect(mockDelete).not.toHaveBeenCalled()
    expect(mockMarkFailed).not.toHaveBeenCalled()
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
      clientMessageId: "temp_attach",
    })
  })
})
