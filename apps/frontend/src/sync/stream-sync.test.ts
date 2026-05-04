import { describe, it, expect, beforeEach } from "vitest"
import { db } from "@/db"
import {
  applyStreamBootstrap,
  getLatestPersistedSequence,
  toCachedStreamBootstrap,
  updateMessageEvent,
} from "./stream-sync"
import type { StreamBootstrap, StreamEvent } from "@threa/types"

// With fake-indexeddb loaded in test setup, Dexie works against a real
// in-memory IndexedDB. No mocks needed — tests exercise actual queries.

function makeEvent(overrides: Partial<StreamEvent> & { id: string; streamId: string; sequence: string }): StreamEvent {
  return {
    eventType: "message_created",
    payload: { messageId: overrides.id, contentMarkdown: "test" },
    actorId: "user_1",
    actorType: "user",
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeBootstrap(events: StreamEvent[], streamId: string): StreamBootstrap {
  return {
    stream: {
      id: streamId,
      workspaceId: "ws_1",
      type: "channel",
      displayName: "test",
      slug: "test",
      description: null,
      visibility: "public",
      parentStreamId: null,
      parentMessageId: null,
      rootStreamId: null,
      companionMode: "off",
      companionPersonaId: null,
      createdBy: "user_1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      archivedAt: null,
    },
    events,
    members: [],
    botMemberIds: [],
    membership: null as unknown as StreamBootstrap["membership"],
    latestSequence: events.length > 0 ? events[events.length - 1].sequence : "0",
    hasOlderEvents: false,
    syncMode: "replace",
    unreadCount: 0,
    mentionCount: 0,
    activityCount: 0,
  }
}

describe("applyStreamBootstrap (real IndexedDB)", () => {
  beforeEach(async () => {
    await db.events.clear()
    await db.streams.clear()
    await db.pendingMessages.clear()
  })

  it("preserves a socket-delivered event that arrived during the bootstrap fetch (race condition)", async () => {
    const streamId = "stream_race"

    // Simulate: socket handler wrote event X to IDB while bootstrap was in flight
    const socketEvent = makeEvent({ id: "evt_X", streamId, sequence: "200" })
    await db.events.put({ ...socketEvent, workspaceId: "ws_1", _sequenceNum: 200, _cachedAt: Date.now() })

    // Bootstrap returns events A(100) and B(150) — snapshot taken before X existed
    const bootstrapEvents = [
      makeEvent({ id: "evt_A", streamId, sequence: "100" }),
      makeEvent({ id: "evt_B", streamId, sequence: "150" }),
    ]
    const bootstrap = makeBootstrap(bootstrapEvents, streamId)

    await applyStreamBootstrap("ws_1", streamId, bootstrap)

    // All three events must be in IDB
    const allEvents = await db.events.where("streamId").equals(streamId).toArray()
    const ids = allEvents.map((e) => e.id).sort()
    expect(ids).toEqual(["evt_A", "evt_B", "evt_X"])
  })

  it("preserves events from previous sessions (IDB is append-only)", async () => {
    const streamId = "stream_prev"

    // Old event from a previous session
    const oldEvent = makeEvent({ id: "evt_old", streamId, sequence: "50" })
    await db.events.put({ ...oldEvent, workspaceId: "ws_1", _sequenceNum: 50, _cachedAt: Date.now() - 86400000 })

    const bootstrap = makeBootstrap([makeEvent({ id: "evt_A", streamId, sequence: "100" })], streamId)

    await applyStreamBootstrap("ws_1", streamId, bootstrap)

    expect(await db.events.get("evt_old")).toBeDefined()
    expect(await db.events.get("evt_A")).toBeDefined()
  })

  it("prunes stale cached events that fall inside the fetched bootstrap window", async () => {
    const streamId = "stream_stale_window"

    await db.events.bulkPut([
      {
        ...makeEvent({ id: "evt_old_page", streamId, sequence: "50" }),
        workspaceId: "ws_1",
        _sequenceNum: 50,
        _cachedAt: Date.now() - 1000,
      },
      {
        ...makeEvent({
          id: "evt_ghost",
          streamId,
          sequence: "120",
          payload: { messageId: "evt_ghost", contentMarkdown: "ghost bot message" },
        }),
        workspaceId: "ws_1",
        _sequenceNum: 120,
        _cachedAt: Date.now() - 1000,
      },
      {
        ...makeEvent({ id: "evt_socket_new", streamId, sequence: "200" }),
        workspaceId: "ws_1",
        _sequenceNum: 200,
        _cachedAt: Date.now(),
      },
    ])

    const bootstrap = makeBootstrap(
      [makeEvent({ id: "evt_A", streamId, sequence: "100" }), makeEvent({ id: "evt_B", streamId, sequence: "150" })],
      streamId
    )

    await applyStreamBootstrap("ws_1", streamId, bootstrap)

    expect(await db.events.get("evt_old_page")).toBeDefined()
    expect(await db.events.get("evt_A")).toBeDefined()
    expect(await db.events.get("evt_B")).toBeDefined()
    expect(await db.events.get("evt_socket_new")).toBeDefined()
    expect(await db.events.get("evt_ghost")).toBeUndefined()
  })

  it("removes stale optimistic events (temp_*) not in the send queue", async () => {
    const streamId = "stream_stale"

    // Stale optimistic event — NOT in pendingMessages
    await db.events.put({
      id: "temp_stale",
      workspaceId: "ws_1",
      streamId,
      sequence: "999",
      _sequenceNum: 999,
      eventType: "message_created",
      payload: {},
      actorId: null,
      actorType: null,
      createdAt: new Date().toISOString(),
      _status: "pending",
      _cachedAt: Date.now(),
    })

    const bootstrap = makeBootstrap([makeEvent({ id: "evt_A", streamId, sequence: "100" })], streamId)
    await applyStreamBootstrap("ws_1", streamId, bootstrap)

    expect(await db.events.get("temp_stale")).toBeUndefined()
    expect(await db.events.get("evt_A")).toBeDefined()
  })

  it("preserves optimistic events that are still in the send queue", async () => {
    const streamId = "stream_pending"

    // Optimistic event — still in pendingMessages
    await db.events.put({
      id: "temp_pending",
      workspaceId: "ws_1",
      streamId,
      sequence: "999",
      _sequenceNum: 999,
      eventType: "message_created",
      payload: {},
      actorId: null,
      actorType: null,
      createdAt: new Date().toISOString(),
      _status: "pending",
      _cachedAt: Date.now(),
    })
    await db.pendingMessages.add({
      clientId: "temp_pending",
      workspaceId: "ws_1",
      streamId,
      content: "hello",
      contentFormat: "markdown",
      createdAt: Date.now(),
      retryCount: 0,
    })

    const bootstrap = makeBootstrap([makeEvent({ id: "evt_A", streamId, sequence: "100" })], streamId)
    await applyStreamBootstrap("ws_1", streamId, bootstrap)

    expect(await db.events.get("temp_pending")).toBeDefined()
    expect(await db.events.get("evt_A")).toBeDefined()
  })

  it("writes stream metadata to IDB", async () => {
    const streamId = "stream_meta"
    const bootstrap = makeBootstrap([], streamId)

    await applyStreamBootstrap("ws_1", streamId, bootstrap)

    const stream = await db.streams.get(streamId)
    expect(stream).toBeDefined()
    expect(stream?.workspaceId).toBe("ws_1")
    expect(stream?.displayName).toBe("test")
  })

  it("appends reconnect catch-up events without pruning the existing visible window", async () => {
    const streamId = "stream_append"
    const initialBootstrap = makeBootstrap(
      [makeEvent({ id: "evt_A", streamId, sequence: "100" }), makeEvent({ id: "evt_B", streamId, sequence: "150" })],
      streamId
    )
    await applyStreamBootstrap("ws_1", streamId, initialBootstrap)

    const appendBootstrap = {
      ...makeBootstrap([makeEvent({ id: "evt_C", streamId, sequence: "200" })], streamId),
      syncMode: "append" as const,
      latestSequence: "200",
    }

    await applyStreamBootstrap("ws_1", streamId, appendBootstrap)

    const allEvents = await db.events.where("streamId").equals(streamId).sortBy("_sequenceNum")
    expect(allEvents.map((event) => event.id)).toEqual(["evt_A", "evt_B", "evt_C"])
  })

  it("increments windowVersion only for reconnect replace responses", () => {
    const streamId = "stream_window"
    const initial = toCachedStreamBootstrap(
      makeBootstrap([makeEvent({ id: "evt_A", streamId, sequence: "10" })], streamId)
    )
    const append = toCachedStreamBootstrap(
      {
        ...makeBootstrap([makeEvent({ id: "evt_B", streamId, sequence: "20" })], streamId),
        syncMode: "append",
        latestSequence: "20",
      },
      initial,
      { incrementWindowVersionOnReplace: false }
    )
    const replace = toCachedStreamBootstrap(
      makeBootstrap([makeEvent({ id: "evt_C", streamId, sequence: "30" })], streamId),
      append,
      { incrementWindowVersionOnReplace: true }
    )

    expect(initial.windowVersion).toBe(0)
    expect(append.windowVersion).toBe(0)
    expect(replace.windowVersion).toBe(1)
  })

  it("derives the reconnect cursor from the latest persisted non-optimistic event", async () => {
    const streamId = "stream_cursor"
    await db.events.bulkPut([
      {
        ...makeEvent({ id: "evt_real", streamId, sequence: "200" }),
        workspaceId: "ws_1",
        _sequenceNum: 200,
        _cachedAt: Date.now(),
      },
      {
        ...makeEvent({ id: "temp_pending", streamId, sequence: `${Date.now()}` }),
        workspaceId: "ws_1",
        _sequenceNum: Date.now(),
        _status: "pending",
        _cachedAt: Date.now(),
      },
    ])

    expect(await getLatestPersistedSequence(streamId)).toBe("200")
  })
})

// ---------------------------------------------------------------------------
// updateMessageEvent — atomic payload updates
// ---------------------------------------------------------------------------

describe("updateMessageEvent", () => {
  beforeEach(async () => {
    await db.events.clear()
  })

  it("updates a message payload in place", async () => {
    const streamId = "stream_update"
    const messageId = "msg_1"
    await db.events.put({
      ...makeEvent({ id: "evt_1", streamId, sequence: "100", payload: { messageId, contentMarkdown: "hello" } }),
      workspaceId: "ws_1",
      _sequenceNum: 100,
      _cachedAt: Date.now(),
    })

    await updateMessageEvent(streamId, messageId, (p) => ({ ...p, replyCount: 5 }))

    const event = await db.events.get("evt_1")
    expect((event?.payload as Record<string, unknown>).replyCount).toBe(5)
  })

  it("does not lose fields when multiple concurrent updates target the same message", async () => {
    const streamId = "stream_race_update"
    const messageId = "msg_race"
    await db.events.put({
      ...makeEvent({ id: "evt_race", streamId, sequence: "100", payload: { messageId, contentMarkdown: "hello" } }),
      workspaceId: "ws_1",
      _sequenceNum: 100,
      _cachedAt: Date.now(),
    })

    // Simulate the race that happens when messages:moved, stream:created and
    // message:updated socket handlers all update the same parent message
    // concurrently. With the old read-then-update implementation the last
    // write would overwrite earlier ones and lose fields.
    await Promise.all([
      updateMessageEvent(streamId, messageId, (p) => ({
        ...p,
        replyCount: 3,
        threadSummary: { lastReplyContentMarkdown: "hi", participantIds: ["u1"] },
      })),
      updateMessageEvent(streamId, messageId, (p) => ({
        ...p,
        threadId: "thread_123",
      })),
    ])

    const event = await db.events.get("evt_race")
    const payload = event?.payload as Record<string, unknown>
    expect(payload.threadId).toBe("thread_123")
    expect(payload.replyCount).toBe(3)
    expect(payload.threadSummary).toEqual({ lastReplyContentMarkdown: "hi", participantIds: ["u1"] })
  })
})

// ---------------------------------------------------------------------------
// Read-side filtering (the logic inside useEvents useMemo)
// ---------------------------------------------------------------------------

describe("event display filtering", () => {
  function filterEventsForDisplay(idbEvents: Array<{ sequence: string; _status?: string }>, bootstrapFloor: bigint) {
    return idbEvents.filter((e) => {
      if (e._status === "pending" || e._status === "failed") return true
      return BigInt(e.sequence) >= bootstrapFloor
    })
  }

  it("includes socket events newer than bootstrap window", () => {
    const events = [
      { sequence: "50", _status: undefined },
      { sequence: "100", _status: undefined },
      { sequence: "150", _status: undefined },
      { sequence: "200", _status: undefined },
    ]
    const displayed = filterEventsForDisplay(events, 100n)
    expect(displayed.map((e) => e.sequence)).toEqual(["100", "150", "200"])
  })

  it("excludes events from previous sessions below bootstrap window", () => {
    const events = [
      { sequence: "10", _status: undefined },
      { sequence: "50", _status: undefined },
      { sequence: "100", _status: undefined },
    ]
    const displayed = filterEventsForDisplay(events, 100n)
    expect(displayed).toEqual([{ sequence: "100", _status: undefined }])
  })

  it("includes pending/failed optimistic events regardless of sequence", () => {
    const events = [
      { sequence: "50", _status: undefined },
      { sequence: "100", _status: undefined },
      { sequence: "999999", _status: "pending" },
      { sequence: "999998", _status: "failed" },
    ]
    const displayed = filterEventsForDisplay(events, 100n)
    expect(displayed).toHaveLength(3)
  })

  it("the race condition scenario end-to-end", () => {
    const idbEvents = [
      { sequence: "30", _status: undefined },
      { sequence: "100", _status: undefined },
      { sequence: "120", _status: undefined },
      { sequence: "150", _status: undefined },
      { sequence: "200", _status: undefined },
    ]
    const displayed = filterEventsForDisplay(idbEvents, 100n)
    expect(displayed.map((e) => e.sequence)).toEqual(["100", "120", "150", "200"])
  })
})
