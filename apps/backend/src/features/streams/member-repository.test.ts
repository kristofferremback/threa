import { describe, expect, test, mock } from "bun:test"
import { StreamMemberRepository } from "./member-repository"
import type { Querier } from "../../db"

function makeDb(rows: Record<string, unknown>[]) {
  const query = mock(() => Promise.resolve({ rows, rowCount: rows.length }))
  return { query } as unknown as Querier & { query: ReturnType<typeof mock> }
}

describe("StreamMemberRepository.countMembersNotIn", () => {
  test("returns the parsed count when the query yields a row", async () => {
    const db = makeDb([{ count: "3" }])
    expect(await StreamMemberRepository.countMembersNotIn(db, "stream_target", "stream_source")).toBe(3)
  })

  test("returns 0 when the query yields no rows", async () => {
    const db = makeDb([])
    expect(await StreamMemberRepository.countMembersNotIn(db, "stream_target", "stream_source")).toBe(0)
  })

  test("joins both streams on member_id (not the dropped user_id column)", async () => {
    const db = makeDb([{ count: "0" }])
    await StreamMemberRepository.countMembersNotIn(db, "stream_target", "stream_source")
    const sqlArg = (db.query as any).mock.calls[0][0]
    const rendered = JSON.stringify(sqlArg)
    expect(rendered).toContain("stream_members")
    expect(rendered).toContain("member_id")
    expect(rendered).not.toContain("user_id")
  })
})
