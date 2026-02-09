import { afterEach, describe, expect, test, vi } from "bun:test"
import type { QueryResult, QueryResultRow } from "pg"
import type { Querier } from "../../db"
import { CronRepository } from "./cron-repository"

interface EnsureScheduleRow extends QueryResultRow {
  id: string
  queue_name: string
  interval_seconds: number
  payload: unknown
  workspace_id: string | null
  next_tick_needed_at: Date
  enabled: boolean
  created_at: Date
  updated_at: Date
  created: boolean
}

function createEnsureScheduleRow(created: boolean): EnsureScheduleRow {
  return {
    id: "cron_01",
    queue_name: "memo.batch.check",
    interval_seconds: 30,
    payload: { workspaceId: "system" },
    workspace_id: null,
    next_tick_needed_at: new Date("2026-02-09T10:00:00.000Z"),
    enabled: true,
    created_at: new Date("2026-02-09T09:59:00.000Z"),
    updated_at: new Date("2026-02-09T09:59:00.000Z"),
    created,
  }
}

function createQuerierWithRow(row: EnsureScheduleRow): Querier {
  const query = vi.fn(async () => {
    return {
      rows: [row],
      rowCount: 1,
    } as QueryResult<EnsureScheduleRow>
  })

  return {
    query: query as Querier["query"],
  }
}

describe("CronRepository.ensureSchedule", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test("should return created=true when database reports inserted row", async () => {
    const db = createQuerierWithRow(createEnsureScheduleRow(true))

    const result = await CronRepository.ensureSchedule(db, {
      id: "cron_01",
      queueName: "memo.batch.check",
      intervalSeconds: 30,
      payload: { workspaceId: "system" },
      workspaceId: null,
    })

    expect(result.created).toBe(true)
  })

  test("should return created=false when database reports existing row", async () => {
    const db = createQuerierWithRow(createEnsureScheduleRow(false))

    const result = await CronRepository.ensureSchedule(db, {
      id: "cron_01",
      queueName: "memo.batch.check",
      intervalSeconds: 30,
      payload: { workspaceId: "system" },
      workspaceId: null,
    })

    expect(result.created).toBe(false)
  })
})
