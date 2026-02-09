import { afterEach, describe, expect, test, vi } from "bun:test"
import type { Pool } from "pg"
import { ScheduleManager } from "./schedule-manager"
import { CronRepository, type CronSchedule } from "./cron-repository"

interface ScheduleManagerInternals {
  generateTicks: () => Promise<void>
}

function createSchedule(overrides: Partial<CronSchedule> = {}): CronSchedule {
  return {
    id: "cron_test_1",
    queueName: "memo.batch.check",
    intervalSeconds: 30,
    payload: { workspaceId: "system" },
    workspaceId: null,
    nextTickNeededAt: new Date("2026-02-09T10:00:00.000Z"),
    enabled: true,
    createdAt: new Date("2026-02-09T09:59:00.000Z"),
    updatedAt: new Date("2026-02-09T09:59:00.000Z"),
    ...overrides,
  }
}

describe("ScheduleManager", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test("should create ticks using deterministic nextTickNeededAt timestamps", async () => {
    const schedule = createSchedule()
    const pool = {} as Pool

    vi.spyOn(CronRepository, "findSchedulesNeedingTicks").mockResolvedValue([schedule])
    const createTicksSpy = vi.spyOn(CronRepository, "createTicks").mockResolvedValue([])
    const randomSpy = vi.spyOn(Math, "random")

    const manager = new ScheduleManager(pool, {
      lookaheadSeconds: 60,
      batchSize: 100,
      intervalMs: 1000,
    })

    await (manager as unknown as ScheduleManagerInternals).generateTicks()

    expect(randomSpy).not.toHaveBeenCalled()
    expect(createTicksSpy).toHaveBeenCalledWith(pool, {
      schedules: [
        {
          scheduleId: schedule.id,
          queueName: schedule.queueName,
          payload: schedule.payload,
          workspaceId: schedule.workspaceId,
          executeAt: schedule.nextTickNeededAt,
          intervalSeconds: schedule.intervalSeconds,
        },
      ],
    })
  })

  test("should not create ticks when no schedules need generation", async () => {
    const pool = {} as Pool
    vi.spyOn(CronRepository, "findSchedulesNeedingTicks").mockResolvedValue([])
    const createTicksSpy = vi.spyOn(CronRepository, "createTicks").mockResolvedValue([])

    const manager = new ScheduleManager(pool, {
      lookaheadSeconds: 60,
      batchSize: 100,
      intervalMs: 1000,
    })

    await (manager as unknown as ScheduleManagerInternals).generateTicks()

    expect(createTicksSpy).not.toHaveBeenCalled()
  })
})
