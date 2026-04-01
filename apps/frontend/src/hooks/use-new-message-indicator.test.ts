import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useNewMessageIndicator } from "./use-new-message-indicator"
import type { StreamEvent } from "@threa/types"

function makeEvent(overrides: Partial<StreamEvent> & { id: string; sequence: string }): StreamEvent {
  return {
    eventType: "message_created",
    actorId: "other_user",
    actorType: "user",
    streamId: "stream_1",
    payload: {},
    createdAt: "2026-04-01T00:00:00Z",
    ...overrides,
  } as StreamEvent
}

const currentUserId = "current_user"
const streamId = "stream_1"

describe("useNewMessageIndicator", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("does not flash events present on first render", () => {
    const events = [makeEvent({ id: "evt_1", sequence: "1" }), makeEvent({ id: "evt_2", sequence: "2" })]

    const { result } = renderHook(() => useNewMessageIndicator(events, currentUserId, streamId))

    expect(result.current.size).toBe(0)
  })

  it("flashes events that arrive after the initial snapshot", () => {
    const initial = [makeEvent({ id: "evt_1", sequence: "1" })]

    const { result, rerender } = renderHook(({ events }) => useNewMessageIndicator(events, currentUserId, streamId), {
      initialProps: { events: initial },
    })

    const updated = [...initial, makeEvent({ id: "evt_2", sequence: "2" })]
    rerender({ events: updated })

    expect(result.current.has("evt_2")).toBe(true)
  })

  it("does not flash events from the current user", () => {
    const initial = [makeEvent({ id: "evt_1", sequence: "1" })]

    const { result, rerender } = renderHook(({ events }) => useNewMessageIndicator(events, currentUserId, streamId), {
      initialProps: { events: initial },
    })

    const updated = [...initial, makeEvent({ id: "evt_2", sequence: "2", actorId: currentUserId })]
    rerender({ events: updated })

    expect(result.current.size).toBe(0)
  })

  it("does not flash events at or before lastReadEventId", () => {
    // All events are read — lastReadEventId is the last event
    const events = [makeEvent({ id: "evt_1", sequence: "1" }), makeEvent({ id: "evt_5", sequence: "5" })]

    const { result, rerender } = renderHook(
      ({ events: evts, lastRead }) => useNewMessageIndicator(evts, currentUserId, streamId, lastRead),
      { initialProps: { events, lastRead: "evt_5" as string | null } }
    )

    expect(result.current.size).toBe(0)

    // Even if events array changes reference (data source transition),
    // read events should never flash
    rerender({ events: [...events], lastRead: "evt_5" })
    expect(result.current.size).toBe(0)
  })

  it("does not flash already-present unread events (divider handles those)", () => {
    // evt_5 is the last read event; evt_8 and evt_10 are unread but already
    // present when the stream opened — they get the "--- New ---" divider,
    // not the flash animation.
    const events = [
      makeEvent({ id: "evt_1", sequence: "1" }),
      makeEvent({ id: "evt_5", sequence: "5" }),
      makeEvent({ id: "evt_8", sequence: "8" }),
      makeEvent({ id: "evt_10", sequence: "10" }),
    ]

    const { result } = renderHook(() => useNewMessageIndicator(events, currentUserId, streamId, "evt_5"))

    expect(result.current.size).toBe(0)
  })

  it("flashes genuine socket events that arrive after the read boundary", () => {
    const events = [makeEvent({ id: "evt_1", sequence: "1" }), makeEvent({ id: "evt_5", sequence: "5" })]

    const { result, rerender } = renderHook(
      ({ events: evts, lastRead }) => useNewMessageIndicator(evts, currentUserId, streamId, lastRead),
      { initialProps: { events, lastRead: "evt_5" as string | null } }
    )

    expect(result.current.size).toBe(0)

    // Auto-mark-as-read advances lastReadEventId to evt_5 (already there).
    // Now a genuine socket event arrives from another user.
    const withSocket = [...events, makeEvent({ id: "evt_6", sequence: "6" })]
    rerender({ events: withSocket, lastRead: "evt_5" })

    expect(result.current.has("evt_6")).toBe(true)
  })

  it("does not flash own messages even when events transition between data sources", () => {
    const initial = [
      makeEvent({ id: "evt_1", sequence: "1", actorId: currentUserId }),
      makeEvent({ id: "evt_3", sequence: "3", actorId: currentUserId }),
    ]

    const { result, rerender } = renderHook(
      ({ events, lastRead }) => useNewMessageIndicator(events, currentUserId, streamId, lastRead),
      { initialProps: { events: initial, lastRead: "evt_3" as string | null } }
    )

    expect(result.current.size).toBe(0)

    // IDB resolves with same events + a socket-delivered event from the user
    const idbEvents = [...initial, makeEvent({ id: "evt_5", sequence: "5", actorId: currentUserId })]
    rerender({ events: idbEvents, lastRead: "evt_3" })

    expect(result.current.size).toBe(0)
  })

  it("does not flash events already present when switching streams", () => {
    const streamAEvents = [makeEvent({ id: "evt_a1", sequence: "10" })]

    const { result, rerender } = renderHook(
      ({ events, sid, lastRead }) => useNewMessageIndicator(events, currentUserId, sid, lastRead),
      { initialProps: { events: streamAEvents, sid: "stream_a", lastRead: "evt_a1" as string | null } }
    )

    expect(result.current.size).toBe(0)

    // Switch to stream B — events arrive from effectiveEvents fallback
    const streamBEvents = [makeEvent({ id: "evt_b1", sequence: "50" }), makeEvent({ id: "evt_b2", sequence: "60" })]
    rerender({ events: streamBEvents, sid: "stream_b", lastRead: "evt_b2" })

    expect(result.current.size).toBe(0)
  })

  it("does not re-flash on back-and-forth navigation", () => {
    const events = [makeEvent({ id: "evt_1", sequence: "1" }), makeEvent({ id: "evt_5", sequence: "5" })]

    const { result, rerender } = renderHook(
      ({ events, sid, lastRead }) => useNewMessageIndicator(events, currentUserId, sid, lastRead),
      { initialProps: { events, sid: streamId, lastRead: "evt_5" as string | null } }
    )

    expect(result.current.size).toBe(0)

    // Navigate away
    rerender({ events: [], sid: "stream_2", lastRead: null })
    expect(result.current.size).toBe(0)

    // Navigate back — same events reload
    rerender({ events, sid: streamId, lastRead: "evt_5" })
    expect(result.current.size).toBe(0)
  })

  it("expires flashed IDs after 2 seconds", () => {
    const initial = [makeEvent({ id: "evt_1", sequence: "1" })]

    const { result, rerender } = renderHook(({ events }) => useNewMessageIndicator(events, currentUserId, streamId), {
      initialProps: { events: initial },
    })

    const updated = [...initial, makeEvent({ id: "evt_2", sequence: "2" })]
    rerender({ events: updated })
    expect(result.current.has("evt_2")).toBe(true)

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(result.current.size).toBe(0)
  })
})
