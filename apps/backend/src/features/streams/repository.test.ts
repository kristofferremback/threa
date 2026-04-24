import { describe, expect, test, mock } from "bun:test"
import { StreamRepository } from "./repository"
import type { Querier } from "../../db"

function makeDb(rows: Record<string, unknown>[]) {
  const query = mock(() => Promise.resolve({ rows, rowCount: rows.length }))
  return { query } as unknown as Querier & { query: ReturnType<typeof mock> }
}

describe("StreamRepository.isAncestor", () => {
  test("short-circuits without a query when the IDs are equal", async () => {
    const db = makeDb([])
    expect(await StreamRepository.isAncestor(db, "stream_a", "stream_a")).toBe(true)
    expect(db.query).not.toHaveBeenCalled()
  })

  test("returns true when the recursive CTE finds any matching row", async () => {
    const db = makeDb([{ matched: true }])
    expect(await StreamRepository.isAncestor(db, "stream_parent", "stream_thread")).toBe(true)
    expect(db.query).toHaveBeenCalledTimes(1)
  })

  test("returns false when the CTE returns no rows", async () => {
    const db = makeDb([])
    expect(await StreamRepository.isAncestor(db, "stream_other", "stream_thread")).toBe(false)
    expect(db.query).toHaveBeenCalledTimes(1)
  })

  test("query matches on parent chain id OR root_stream_id", async () => {
    const db = makeDb([])
    await StreamRepository.isAncestor(db, "stream_candidate", "stream_start")
    const sqlArg = (db.query as any).mock.calls[0][0]
    // The tagged-template builder stores the interpolated SQL somewhere we can
    // stringify; assert on the shape to catch drift from the recursive CTE.
    const rendered = JSON.stringify(sqlArg)
    expect(rendered).toContain("WITH RECURSIVE chain")
    expect(rendered).toContain("parent_stream_id")
    expect(rendered).toContain("root_stream_id")
  })
})
