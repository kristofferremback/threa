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

  it("flashes events that arrive after the baseline is set", () => {
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

  it("does not flash bootstrap events that arrive after IDB snapshot", () => {
    // Step 1: IDB cache loads with events up to sequence 5
    const idbEvents = [makeEvent({ id: "evt_1", sequence: "1" }), makeEvent({ id: "evt_5", sequence: "5" })]

    const { result, rerender } = renderHook(
      ({ events, bootstrapMax }) => useNewMessageIndicator(events, currentUserId, streamId, bootstrapMax),
      { initialProps: { events: idbEvents, bootstrapMax: null as string | null } }
    )

    expect(result.current.size).toBe(0)

    // Step 2: Bootstrap resolves — its max sequence is 10.
    // IDB live query hasn't updated yet, but bootstrapMaxSequence is now available.
    rerender({ events: idbEvents, bootstrapMax: "10" })
    expect(result.current.size).toBe(0)

    // Step 3: IDB live query fires with bootstrap events included
    const withBootstrap = [
      ...idbEvents,
      makeEvent({ id: "evt_8", sequence: "8" }),
      makeEvent({ id: "evt_10", sequence: "10" }),
    ]
    rerender({ events: withBootstrap, bootstrapMax: "10" })

    // These should NOT flash — they're from bootstrap, not from a live socket
    expect(result.current.size).toBe(0)
  })

  it("still flashes genuine socket events that arrive after bootstrap", () => {
    const idbEvents = [makeEvent({ id: "evt_1", sequence: "1" })]

    const { result, rerender } = renderHook(
      ({ events, bootstrapMax }) => useNewMessageIndicator(events, currentUserId, streamId, bootstrapMax),
      { initialProps: { events: idbEvents, bootstrapMax: null as string | null } }
    )

    // Bootstrap resolves with max sequence 5
    const bootstrapEvents = [makeEvent({ id: "evt_1", sequence: "1" }), makeEvent({ id: "evt_5", sequence: "5" })]
    rerender({ events: bootstrapEvents, bootstrapMax: "5" })
    expect(result.current.size).toBe(0)

    // Now a genuine socket event arrives with sequence 6
    const withSocket = [...bootstrapEvents, makeEvent({ id: "evt_6", sequence: "6" })]
    rerender({ events: withSocket, bootstrapMax: "5" })

    expect(result.current.has("evt_6")).toBe(true)
  })

  it("does not re-flash on back-and-forth navigation", () => {
    const events = [makeEvent({ id: "evt_1", sequence: "1" }), makeEvent({ id: "evt_5", sequence: "5" })]

    const { result, rerender } = renderHook(
      ({ events, sid, bootstrapMax }) => useNewMessageIndicator(events, currentUserId, sid, bootstrapMax),
      { initialProps: { events, sid: streamId, bootstrapMax: "5" as string | null } }
    )

    expect(result.current.size).toBe(0)

    // Navigate away — streamId changes, reset
    rerender({ events: [], sid: "stream_2", bootstrapMax: null })
    expect(result.current.size).toBe(0)

    // Navigate back — same events reload
    rerender({ events, sid: streamId, bootstrapMax: "5" })
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
