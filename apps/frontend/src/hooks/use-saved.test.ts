import { describe, it, expect, beforeEach } from "vitest"
import type { SavedMessageView } from "@threa/types"
import { db } from "@/db"
import { replaceSavedPage } from "./use-saved"

const WORKSPACE_ID = "ws_test"

function makeView(overrides: Partial<SavedMessageView> & { id: string; messageId: string }): SavedMessageView {
  const now = new Date().toISOString()
  return {
    workspaceId: WORKSPACE_ID,
    userId: "usr_me",
    streamId: "stream_1",
    status: "saved",
    remindAt: null,
    reminderSentAt: null,
    savedAt: now,
    statusChangedAt: now,
    message: null,
    unavailableReason: null,
    ...overrides,
  }
}

describe("replaceSavedPage", () => {
  beforeEach(async () => {
    await db.savedMessages.clear()
  })

  it("deletes cached rows that are missing from the server response", async () => {
    const fetchStartedAt = Date.now()
    // Seed a row that was cached before the fetch started (i.e. the server's
    // view of it should win).
    await db.savedMessages.put({
      id: "saved_stale",
      workspaceId: WORKSPACE_ID,
      userId: "usr_me",
      messageId: "msg_stale",
      streamId: "stream_1",
      status: "saved",
      remindAt: null,
      reminderSentAt: null,
      savedAt: new Date().toISOString(),
      statusChangedAt: new Date().toISOString(),
      message: null,
      unavailableReason: null,
      _savedAtMs: Date.now() - 60_000,
      _statusChangedAtMs: Date.now() - 60_000,
      _cachedAt: fetchStartedAt - 1_000,
    })

    await replaceSavedPage(WORKSPACE_ID, "saved", [], fetchStartedAt)

    const remaining = await db.savedMessages.toArray()
    expect(remaining).toEqual([])
  })

  it("preserves rows written after fetchStartedAt (concurrent socket writes)", async () => {
    const fetchStartedAt = Date.now()
    // Simulate a socket write that lands while the list fetch is in flight.
    await db.savedMessages.put({
      id: "saved_concurrent",
      workspaceId: WORKSPACE_ID,
      userId: "usr_me",
      messageId: "msg_concurrent",
      streamId: "stream_1",
      status: "saved",
      remindAt: null,
      reminderSentAt: null,
      savedAt: new Date().toISOString(),
      statusChangedAt: new Date().toISOString(),
      message: null,
      unavailableReason: null,
      _savedAtMs: Date.now(),
      _statusChangedAtMs: Date.now(),
      _cachedAt: fetchStartedAt + 10,
    })

    await replaceSavedPage(WORKSPACE_ID, "saved", [], fetchStartedAt)

    const remaining = await db.savedMessages.toArray()
    expect(remaining.map((r) => r.id)).toEqual(["saved_concurrent"])
  })

  it("bulkPuts the server response and deletes stale rows in one pass", async () => {
    const fetchStartedAt = Date.now()
    // Stale row the server no longer knows about.
    await db.savedMessages.put({
      id: "saved_stale",
      workspaceId: WORKSPACE_ID,
      userId: "usr_me",
      messageId: "msg_stale",
      streamId: "stream_1",
      status: "saved",
      remindAt: null,
      reminderSentAt: null,
      savedAt: new Date().toISOString(),
      statusChangedAt: new Date().toISOString(),
      message: null,
      unavailableReason: null,
      _savedAtMs: Date.now(),
      _statusChangedAtMs: Date.now(),
      _cachedAt: fetchStartedAt - 1_000,
    })

    await replaceSavedPage(
      WORKSPACE_ID,
      "saved",
      [makeView({ id: "saved_fresh", messageId: "msg_fresh" })],
      fetchStartedAt
    )

    const remaining = await db.savedMessages.toArray()
    expect(remaining.map((r) => r.id)).toEqual(["saved_fresh"])
  })

  it("leaves rows in other statuses alone", async () => {
    const fetchStartedAt = Date.now()
    // A "done" row must survive reconciliation of the "saved" tab.
    await db.savedMessages.put({
      id: "saved_done",
      workspaceId: WORKSPACE_ID,
      userId: "usr_me",
      messageId: "msg_done",
      streamId: "stream_1",
      status: "done",
      remindAt: null,
      reminderSentAt: null,
      savedAt: new Date().toISOString(),
      statusChangedAt: new Date().toISOString(),
      message: null,
      unavailableReason: null,
      _savedAtMs: Date.now(),
      _statusChangedAtMs: Date.now(),
      _cachedAt: fetchStartedAt - 1_000,
    })

    await replaceSavedPage(WORKSPACE_ID, "saved", [], fetchStartedAt)

    const remaining = await db.savedMessages.toArray()
    expect(remaining.map((r) => r.id)).toEqual(["saved_done"])
  })
})
