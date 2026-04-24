import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"
import { SharedMessagesProvider } from "@/components/shared-messages/context"
import { useSharedMessageSource } from "./use-shared-message-source"
import { db } from "@/db"

async function clearEvents() {
  await db.events.clear()
}

describe("useSharedMessageSource", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await clearEvents()
  })

  afterEach(async () => {
    vi.useRealTimers()
    await clearEvents()
  })

  it("resolves from the server hydration map when present", () => {
    const { result } = renderHook(() => useSharedMessageSource("msg_1", "stream_src"), {
      wrapper: ({ children }) => (
        <SharedMessagesProvider
          map={{
            msg_1: {
              state: "ok",
              messageId: "msg_1",
              streamId: "stream_src",
              authorId: "usr_1",
              authorName: "Ada",
              authorType: "user",
              contentJson: { type: "doc", content: [] },
              contentMarkdown: "hello from hydration",
              editedAt: null,
              createdAt: "2026-04-23T10:00:00Z",
            },
          }}
        >
          {children}
        </SharedMessagesProvider>
      ),
    })

    expect(result.current).toEqual({
      status: "resolved",
      contentMarkdown: "hello from hydration",
      authorId: "usr_1",
      actorType: "user",
      authorName: "Ada",
      editedAt: null,
    })
  })

  it("returns deleted / missing tombstones from hydration", () => {
    const { result, rerender } = renderHook(({ id }) => useSharedMessageSource(id, "stream_src"), {
      initialProps: { id: "msg_del" },
      wrapper: ({ children }) => (
        <SharedMessagesProvider
          map={{
            msg_del: { state: "deleted", messageId: "msg_del", deletedAt: "2026-04-23T10:00:00Z" },
            msg_missing: { state: "missing", messageId: "msg_missing" },
          }}
        >
          {children}
        </SharedMessagesProvider>
      ),
    })

    expect(result.current).toEqual({ status: "deleted" })

    rerender({ id: "msg_missing" })
    expect(result.current).toEqual({ status: "missing" })
  })

  it("falls back to the local IDB event cache when hydration is absent", async () => {
    await db.events.put({
      id: "evt_cached",
      workspaceId: "ws_1",
      streamId: "stream_src",
      sequence: "1",
      _sequenceNum: 1,
      eventType: "message_created",
      payload: { messageId: "msg_cached", contentMarkdown: "local snippet" },
      actorId: "usr_42",
      actorType: "user",
      createdAt: "2026-04-23T10:00:00Z",
      _cachedAt: Date.now(),
    })

    const { result } = renderHook(() => useSharedMessageSource("msg_cached", "stream_src"))

    await waitFor(() => {
      expect(result.current.status).toBe("resolved")
    })
    expect(result.current).toMatchObject({
      status: "resolved",
      contentMarkdown: "local snippet",
      authorId: "usr_42",
      actorType: "user",
    })
  })

  it("stays blank for the first 300ms then surfaces a skeleton hint", () => {
    const { result } = renderHook(() => useSharedMessageSource("msg_absent", "stream_src"))

    expect(result.current).toEqual({ status: "pending", showSkeleton: false })

    act(() => {
      vi.advanceTimersByTime(299)
    })
    expect(result.current).toEqual({ status: "pending", showSkeleton: false })

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toEqual({ status: "pending", showSkeleton: true })
  })

  it("resets the skeleton state when the pointer identity changes", () => {
    const { result, rerender } = renderHook(({ id }) => useSharedMessageSource(id, "stream_src"), {
      initialProps: { id: "msg_a" },
    })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(result.current).toEqual({ status: "pending", showSkeleton: true })

    rerender({ id: "msg_b" })
    // New pointer must re-enter the pre-threshold blank state rather than
    // inheriting the previous skeleton.
    expect(result.current).toEqual({ status: "pending", showSkeleton: false })
  })
})
