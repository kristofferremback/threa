import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { SummaryRepository } from "./summary-repository"

function fakeDb(rows: any[]) {
  return {
    query: mock(async () => ({ rows })),
  } as any
}

describe("SummaryRepository.find", () => {
  afterEach(() => mock.restore())

  it("returns the row when all four key parts match", async () => {
    const db = fakeDb([
      {
        id: "cs_1",
        workspace_id: "ws_1",
        ref_kind: "thread",
        ref_key: "thread:stream_x",
        fingerprint: "sha256:abc",
        inputs: [],
        summary_text: "summary text",
        model: "openrouter:openai/gpt-5.4-nano",
        created_at: new Date("2026-04-22T09:00:00Z"),
      },
    ])
    const result = await SummaryRepository.find(db, {
      workspaceId: "ws_1",
      refKind: "thread",
      refKey: "thread:stream_x",
      fingerprint: "sha256:abc",
    })
    expect(result?.summaryText).toBe("summary text")
    expect(result?.model).toBe("openrouter:openai/gpt-5.4-nano")
  })

  it("returns null when no row matches the fingerprint", async () => {
    const db = fakeDb([])
    const result = await SummaryRepository.find(db, {
      workspaceId: "ws_1",
      refKind: "thread",
      refKey: "thread:stream_x",
      fingerprint: "sha256:zzz",
    })
    expect(result).toBeNull()
  })
})

describe("SummaryRepository.upsert", () => {
  afterEach(() => mock.restore())

  it("returns the inserted row when ON CONFLICT does not fire", async () => {
    const insertedRow = {
      id: "cs_new",
      workspace_id: "ws_1",
      ref_kind: "thread",
      ref_key: "thread:stream_y",
      fingerprint: "sha256:new",
      inputs: [],
      summary_text: "fresh",
      model: "openrouter:openai/gpt-5.4-nano",
      created_at: new Date(),
    }
    const query = mock(async () => ({ rows: [insertedRow] }))
    const db = { query } as any

    const result = await SummaryRepository.upsert(db, {
      workspaceId: "ws_1",
      refKind: "thread",
      refKey: "thread:stream_y",
      fingerprint: "sha256:new",
      inputs: [],
      summaryText: "fresh",
      model: "openrouter:openai/gpt-5.4-nano",
    })

    expect(result.summaryText).toBe("fresh")
    expect(query).toHaveBeenCalledTimes(1)
  })

  it("falls back to a SELECT when the insert is suppressed by a concurrent winner", async () => {
    // First call: INSERT ... ON CONFLICT DO NOTHING returns zero rows because
    // another writer landed the same (workspace, ref_kind, ref_key, fingerprint)
    // key first. The repo then re-reads the winning row via `find`.
    const existingRow = {
      id: "cs_existing",
      workspace_id: "ws_1",
      ref_kind: "thread",
      ref_key: "thread:stream_z",
      fingerprint: "sha256:shared",
      inputs: [],
      summary_text: "winner",
      model: "openrouter:openai/gpt-5.4-nano",
      created_at: new Date(),
    }
    const query = mock((async (..._args: any[]) => {
      const call = query.mock.calls.length
      if (call === 1) return { rows: [] }
      return { rows: [existingRow] }
    }) as any)
    const db = { query } as any

    const result = await SummaryRepository.upsert(db, {
      workspaceId: "ws_1",
      refKind: "thread",
      refKey: "thread:stream_z",
      fingerprint: "sha256:shared",
      inputs: [],
      summaryText: "loser (never written)",
      model: "openrouter:openai/gpt-5.4-nano",
    })

    expect(result.summaryText).toBe("winner")
    expect(query).toHaveBeenCalledTimes(2)
  })

  it("throws when the race fallback finds nothing (should be unreachable under correct unique-index config)", async () => {
    // Both the INSERT and the follow-up SELECT return empty. This only happens
    // if the unique index is missing or misconfigured — we surface it loudly
    // rather than returning a broken summary.
    const db = { query: mock(async () => ({ rows: [] })) } as any
    await expect(
      SummaryRepository.upsert(db, {
        workspaceId: "ws_1",
        refKind: "thread",
        refKey: "thread:stream_nope",
        fingerprint: "sha256:nope",
        inputs: [],
        summaryText: "x",
        model: "openrouter:openai/gpt-5.4-nano",
      })
    ).rejects.toThrow(/ON CONFLICT raced/)
  })
})
