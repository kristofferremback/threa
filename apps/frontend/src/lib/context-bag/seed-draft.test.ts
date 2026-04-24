import { describe, it, expect, vi, beforeEach } from "vitest"
import { ContextRefKinds } from "@threa/types"
import { buildChipSeedDoc, seedDraftWithContextRefChip } from "./seed-draft"
import * as dbModule from "@/db"
import * as draftStoreModule from "@/stores/draft-store"
import type { ContextRefChipAttrs } from "@/components/editor/context-ref-chip-extension"

function makeChip(overrides: Partial<ContextRefChipAttrs> = {}): ContextRefChipAttrs {
  return {
    refKind: ContextRefKinds.THREAD,
    streamId: "stream_src",
    fromMessageId: null,
    toMessageId: null,
    label: "Thread from #intro",
    status: "ready",
    fingerprint: null,
    errorMessage: null,
    ...overrides,
  }
}

describe("buildChipSeedDoc", () => {
  it("produces a doc with the chip followed by a trailing space", () => {
    const doc = buildChipSeedDoc(makeChip())
    expect(doc.type).toBe("doc")
    const para = doc.content?.[0]
    expect(para?.type).toBe("paragraph")
    expect(para?.content?.[0]?.type).toBe("contextRefChip")
    expect(para?.content?.[0]?.attrs).toMatchObject({
      refKind: "thread",
      streamId: "stream_src",
      label: "Thread from #intro",
      status: "ready",
    })
    expect(para?.content?.[1]).toEqual({ type: "text", text: " " })
  })
})

describe("seedDraftWithContextRefChip", () => {
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

  it("writes a DraftMessage with the chip doc under the stream draft key", async () => {
    await seedDraftWithContextRefChip({
      workspaceId: "ws_1",
      streamId: "stream_new",
      chip: makeChip(),
    })

    expect(put).toHaveBeenCalledTimes(1)
    const [draft] = put.mock.calls[0] as [Record<string, unknown>]
    expect(draft).toMatchObject({
      id: "stream:stream_new",
      workspaceId: "ws_1",
      attachments: [],
    })
    const content = draft.contentJson as { content?: Array<{ content?: Array<{ type: string }> }> }
    expect(content.content?.[0]?.content?.[0]?.type).toBe("contextRefChip")
  })

  it("also primes the in-memory draft cache so the composer picks it up without waiting on Dexie", async () => {
    await seedDraftWithContextRefChip({
      workspaceId: "ws_1",
      streamId: "stream_new",
      chip: makeChip(),
    })

    expect(upsert).toHaveBeenCalledTimes(1)
    const [workspaceId, draft] = upsert.mock.calls[0] as [string, { id: string }]
    expect(workspaceId).toBe("ws_1")
    expect(draft.id).toBe("stream:stream_new")
  })
})
