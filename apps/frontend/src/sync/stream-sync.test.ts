import { describe, it, expect, vi, beforeEach } from "vitest"
import type { StreamBootstrap, StreamEvent } from "@threa/types"

// ---------------------------------------------------------------------------
// In-memory mock of the Dexie tables used by applyStreamBootstrap.
// Tracks all mutations so tests can assert what was written / deleted.
// ---------------------------------------------------------------------------

let eventsStore: Map<string, Record<string, unknown>>
let streamsStore: Map<string, Record<string, unknown>>
let pendingMessagesStore: Map<string, Record<string, unknown>>

function resetStores() {
  eventsStore = new Map()
  streamsStore = new Map()
  pendingMessagesStore = new Map()
}

/** Build a chainable Dexie-like query mock for a Map-backed store */
function mockTable(store: Map<string, Record<string, unknown>>, primaryKey = "id") {
  return {
    get: vi.fn((id: string) => Promise.resolve(store.get(id) ?? undefined)),
    put: vi.fn((item: Record<string, unknown>) => {
      store.set(item[primaryKey] as string, item)
      return Promise.resolve()
    }),
    bulkPut: vi.fn((items: Record<string, unknown>[]) => {
      for (const item of items) store.set(item[primaryKey] as string, item)
      return Promise.resolve()
    }),
    delete: vi.fn((id: string) => {
      store.delete(id)
      return Promise.resolve()
    }),
    bulkDelete: vi.fn((ids: string[]) => {
      for (const id of ids) store.delete(id)
      return Promise.resolve()
    }),
    where: vi.fn((field: string) => ({
      equals: vi.fn((value: unknown) => ({
        filter: vi.fn((predicate: (item: Record<string, unknown>) => boolean) => ({
          toArray: vi.fn(() =>
            Promise.resolve(Array.from(store.values()).filter((item) => item[field] === value && predicate(item)))
          ),
        })),
        toArray: vi.fn(() => Promise.resolve(Array.from(store.values()).filter((item) => item[field] === value))),
      })),
    })),
  }
}

vi.mock("@/db", () => {
  return {
    db: {
      get events() {
        return mockTable(eventsStore)
      },
      get streams() {
        return mockTable(streamsStore)
      },
      get pendingMessages() {
        return mockTable(pendingMessagesStore, "clientId")
      },
      // transaction just runs the callback — no real IDB transaction semantics needed
      transaction: vi.fn((_mode: string, _tables: unknown[], fn: () => Promise<void>) => fn()),
    },
  }
})

// Mock imports that stream-sync.ts pulls in (only needed for registerStreamSocketHandlers,
// not for applyStreamBootstrap, but the module-level import must resolve)
vi.mock("@/hooks/use-workspaces", () => ({
  workspaceKeys: {
    bootstrap: (wsId: string) => ["workspaces", "bootstrap", wsId],
  },
}))

// ---------------------------------------------------------------------------
// Import AFTER mocks are set up
// ---------------------------------------------------------------------------
const { applyStreamBootstrap } = await import("./stream-sync")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    membership: null as unknown as StreamBootstrap["membership"],
    latestSequence: events.length > 0 ? events[events.length - 1].sequence : "0",
    hasOlderEvents: false,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("applyStreamBootstrap", () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
  })

  it("preserves a socket-delivered event that arrived during the bootstrap fetch (race condition)", async () => {
    const streamId = "stream_1"

    // Simulate: socket handler wrote event X to IDB while bootstrap was in flight.
    // X has sequence 200 — it was created AFTER the server took the bootstrap snapshot.
    const socketEvent = makeEvent({ id: "evt_X", streamId, sequence: "200" })
    eventsStore.set("evt_X", { ...socketEvent, _cachedAt: Date.now() })

    // Bootstrap returns events A(100) and B(150) — snapshot taken before X existed.
    const bootstrapEvents = [
      makeEvent({ id: "evt_A", streamId, sequence: "100" }),
      makeEvent({ id: "evt_B", streamId, sequence: "150" }),
    ]
    const bootstrap = makeBootstrap(bootstrapEvents, streamId)

    await applyStreamBootstrap("ws_1", streamId, bootstrap)

    // All three events must be in IDB: A, B (from bootstrap), and X (from socket)
    expect(eventsStore.has("evt_A")).toBe(true)
    expect(eventsStore.has("evt_B")).toBe(true)
    expect(eventsStore.has("evt_X")).toBe(true)
  })

  it("preserves events from previous sessions (IDB is append-only for non-temp events)", async () => {
    const streamId = "stream_1"

    // Old event from a previous session — still in IDB
    const oldEvent = makeEvent({ id: "evt_old", streamId, sequence: "50" })
    eventsStore.set("evt_old", { ...oldEvent, _cachedAt: Date.now() - 86400000 })

    const bootstrapEvents = [makeEvent({ id: "evt_A", streamId, sequence: "100" })]
    const bootstrap = makeBootstrap(bootstrapEvents, streamId)

    await applyStreamBootstrap("ws_1", streamId, bootstrap)

    // Old event is preserved in IDB (not deleted)
    expect(eventsStore.has("evt_old")).toBe(true)
    expect(eventsStore.has("evt_A")).toBe(true)
  })

  it("removes stale optimistic events (temp_*) that are no longer in the send queue", async () => {
    const streamId = "stream_1"

    // Stale optimistic event — NOT in pendingMessages (already sent or abandoned)
    eventsStore.set("temp_stale", {
      id: "temp_stale",
      streamId,
      sequence: "999",
      eventType: "message_created",
      payload: {},
      _status: "pending",
      _cachedAt: Date.now(),
    })

    const bootstrap = makeBootstrap([makeEvent({ id: "evt_A", streamId, sequence: "100" })], streamId)

    await applyStreamBootstrap("ws_1", streamId, bootstrap)

    // Stale temp event should be deleted
    expect(eventsStore.has("temp_stale")).toBe(false)
    expect(eventsStore.has("evt_A")).toBe(true)
  })

  it("preserves optimistic events that are still in the send queue", async () => {
    const streamId = "stream_1"

    // Optimistic event — still in pendingMessages (awaiting send)
    eventsStore.set("temp_pending", {
      id: "temp_pending",
      streamId,
      sequence: "999",
      eventType: "message_created",
      payload: {},
      _status: "pending",
      _cachedAt: Date.now(),
    })
    pendingMessagesStore.set("temp_pending", {
      clientId: "temp_pending",
      streamId,
      content: "hello",
      retryCount: 0,
    })

    const bootstrap = makeBootstrap([makeEvent({ id: "evt_A", streamId, sequence: "100" })], streamId)

    await applyStreamBootstrap("ws_1", streamId, bootstrap)

    // Pending temp event should be preserved
    expect(eventsStore.has("temp_pending")).toBe(true)
    expect(eventsStore.has("evt_A")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Read-side filtering (the logic inside useEvents useMemo)
// ---------------------------------------------------------------------------

describe("event display filtering", () => {
  /**
   * Extracted filter predicate matching the logic in useEvents.
   * Given a bootstrapFloor (BigInt), returns only events that should be displayed.
   */
  function filterEventsForDisplay(idbEvents: Array<{ sequence: string; _status?: string }>, bootstrapFloor: bigint) {
    return idbEvents.filter((e) => {
      if (e._status === "pending" || e._status === "failed") return true
      return BigInt(e.sequence) >= bootstrapFloor
    })
  }

  it("includes socket events newer than bootstrap window", () => {
    const bootstrapFloor = 100n

    const events = [
      { sequence: "50", _status: undefined }, // old, from previous session
      { sequence: "100", _status: undefined }, // bootstrap oldest
      { sequence: "150", _status: undefined }, // bootstrap middle
      { sequence: "200", _status: undefined }, // socket event during bootstrap
    ]

    const displayed = filterEventsForDisplay(events, bootstrapFloor)

    expect(displayed).toEqual([
      { sequence: "100", _status: undefined },
      { sequence: "150", _status: undefined },
      { sequence: "200", _status: undefined }, // socket event preserved
    ])
  })

  it("excludes events from previous sessions below bootstrap window", () => {
    const bootstrapFloor = 100n

    const events = [
      { sequence: "10", _status: undefined },
      { sequence: "50", _status: undefined },
      { sequence: "100", _status: undefined },
    ]

    const displayed = filterEventsForDisplay(events, bootstrapFloor)

    expect(displayed).toEqual([{ sequence: "100", _status: undefined }])
  })

  it("includes pending/failed optimistic events regardless of sequence", () => {
    const bootstrapFloor = 100n

    const events = [
      { sequence: "50", _status: undefined }, // excluded (old)
      { sequence: "100", _status: undefined }, // included (>= floor)
      { sequence: "999999", _status: "pending" }, // included (pending)
      { sequence: "999998", _status: "failed" }, // included (failed)
    ]

    const displayed = filterEventsForDisplay(events, bootstrapFloor)

    expect(displayed).toEqual([
      { sequence: "100", _status: undefined },
      { sequence: "999999", _status: "pending" },
      { sequence: "999998", _status: "failed" },
    ])
  })

  it("the race condition scenario end-to-end: socket event during bootstrap is displayed", () => {
    // Bootstrap returned events with sequences 100-150
    // Socket delivered event with sequence 200 during the fetch
    // bootstrapFloor = min(bootstrap sequences) = 100
    const bootstrapFloor = 100n

    const idbEvents = [
      { sequence: "30", _status: undefined }, // stale from last session
      { sequence: "100", _status: undefined }, // from bootstrap
      { sequence: "120", _status: undefined }, // from bootstrap
      { sequence: "150", _status: undefined }, // from bootstrap
      { sequence: "200", _status: undefined }, // from socket (the race)
    ]

    const displayed = filterEventsForDisplay(idbEvents, bootstrapFloor)

    // Event at sequence 200 MUST be included — it arrived via socket during
    // the bootstrap fetch window. Dropping it violates INV-53.
    expect(displayed.map((e) => e.sequence)).toEqual(["100", "120", "150", "200"])
  })
})
