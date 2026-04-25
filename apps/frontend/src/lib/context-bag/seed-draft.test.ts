import { describe, it, expect, vi, beforeEach } from "vitest"
import { ContextRefKinds } from "@threa/types"
import { seedDraftWithContextRef } from "./seed-draft"
import * as dbModule from "@/db"
import * as draftStoreModule from "@/stores/draft-store"
import type { DraftContextRef } from "./types"

function makeRef(overrides: Partial<DraftContextRef> = {}): DraftContextRef {
  return {
    refKind: ContextRefKinds.THREAD,
    streamId: "stream_src",
    fromMessageId: null,
    toMessageId: null,
    originMessageId: null,
    status: "ready",
    fingerprint: null,
    errorMessage: null,
    ...overrides,
  }
}

describe("seedDraftWithContextRef", () => {
  const put = vi.fn()
  const upsert = vi.fn()

  beforeEach(() => {
    vi.restoreAllMocks()
    put.mockReset()
    upsert.mockReset()
    put.mockResolvedValue(undefined)
    vi.spyOn(dbModule.db.draftMessages, "put").mockImplementation(((...args: unknown[]) =>
      put(...args)) as unknown as typeof dbModule.db.draftMessages.put)
    vi.spyOn(draftStoreModule, "upsertDraftMessageInCache").mockImplementation(((...args: unknown[]) =>
      upsert(...args)) as unknown as typeof draftStoreModule.upsertDraftMessageInCache)
  })

  it("writes a DraftMessage with the ref under contextRefs and an empty body", async () => {
    await seedDraftWithContextRef({ workspaceId: "ws_1", streamId: "stream_new", ref: makeRef() })

    expect(put).toHaveBeenCalledTimes(1)
    const [draft] = put.mock.calls[0] as [Record<string, unknown>]
    expect(draft).toMatchObject({
      id: "stream:stream_new",
      workspaceId: "ws_1",
      attachments: [],
    })
    const refs = draft.contextRefs as DraftContextRef[]
    expect(refs).toHaveLength(1)
    expect(refs[0].streamId).toBe("stream_src")
    expect(refs[0].status).toBe("ready")
  })

  it("primes the in-memory draft cache so the composer picks it up without waiting on Dexie", async () => {
    await seedDraftWithContextRef({ workspaceId: "ws_1", streamId: "stream_new", ref: makeRef() })

    expect(upsert).toHaveBeenCalledTimes(1)
    const [workspaceId, draft] = upsert.mock.calls[0] as [string, { id: string }]
    expect(workspaceId).toBe("ws_1")
    expect(draft.id).toBe("stream:stream_new")
  })
})
