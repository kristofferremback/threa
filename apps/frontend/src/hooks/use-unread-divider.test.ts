import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { useUnreadDivider } from "./use-unread-divider"
import * as useScrollToElementModule from "./use-scroll-to-element"

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(useScrollToElementModule, "useScrollToElement").mockImplementation(
    (() => undefined) as unknown as typeof useScrollToElementModule.useScrollToElement
  )
})

function makeMessageEvent(id: string, actorId: string) {
  return {
    id,
    streamId: "stream_1",
    sequence: id,
    eventType: "message_created",
    payload: { messageId: `msg_${id}` },
    actorId,
    actorType: "user",
    createdAt: new Date().toISOString(),
  } as const
}

describe("useUnreadDivider", () => {
  it("clears the displayed divider when the stream becomes read after mount", async () => {
    const events = [makeMessageEvent("event_1", "other"), makeMessageEvent("event_2", "other")]

    const { result, rerender } = renderHook(
      ({ lastReadEventId }: { lastReadEventId: string | null | undefined }) =>
        useUnreadDivider({
          events,
          lastReadEventId,
          currentUserId: "me",
          streamId: "stream_1",
        }),
      {
        initialProps: { lastReadEventId: null as string | null | undefined },
      }
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    rerender({ lastReadEventId: null })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.dividerEventId).toBe("event_1")

    rerender({ lastReadEventId: "event_2" })

    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.firstUnreadEventId).toBeUndefined()
    expect(result.current.dividerEventId).toBeUndefined()
  })
})
