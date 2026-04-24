import { describe, expect, test, mock } from "bun:test"
import { StreamRepository } from "./repository"
import type { Querier } from "../../db"

function makeDb(rows: Record<string, unknown>[]) {
  const query = mock(() => Promise.resolve({ rows, rowCount: rows.length }))
  return { query, _query: query } as unknown as Querier & { _query: ReturnType<typeof mock> }
}

describe("StreamRepository.isAncestor", () => {
  test("short-circuits without a query when the IDs are equal", async () => {
    const db = makeDb([])
    expect(await StreamRepository.isAncestor(db, "stream_a", "stream_a")).toBe(true)
    expect(db._query).not.toHaveBeenCalled()
  })

  test("returns true when the recursive CTE finds any matching row", async () => {
    const db = makeDb([{ matched: true }])
    expect(await StreamRepository.isAncestor(db, "stream_parent", "stream_thread")).toBe(true)
    expect(db._query).toHaveBeenCalledTimes(1)
  })

  test("returns false when the CTE returns no rows", async () => {
    const db = makeDb([])
    expect(await StreamRepository.isAncestor(db, "stream_other", "stream_thread")).toBe(false)
    expect(db._query).toHaveBeenCalledTimes(1)
  })
})
