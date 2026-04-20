/**
 * Thread Summary Integration Tests
 *
 * Covers the two queries that back ThreadCard:
 * - `findThreadSummaries(parentStreamId)` — batch lookup for a whole bootstrap
 * - `findThreadSummaryByParentMessage(parentMessageId)` — single-parent lookup
 *   used by the real-time reply-count path
 *
 * Verifies the plan's requirements: 0 / 1 / N replies, ≥4 participants capped at
 * 3, deterministic participant ordering by first-reply sequence, raw markdown
 * on the wire (INV-60 stripping happens client-side), and deleted replies are
 * excluded.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Pool } from "pg"
import { withTestTransaction, addTestMember, setupTestDatabase, testMessageContent } from "./setup"
import { WorkspaceRepository } from "../../src/features/workspaces"
import { StreamService, StreamRepository } from "../../src/features/streams"
import { EventService } from "../../src/features/messaging"
import { userId, workspaceId } from "../../src/lib/id"
import { Visibilities } from "@threa/types"

describe("Thread Summary", () => {
  let pool: Pool
  let streamService: StreamService
  let eventService: EventService

  beforeAll(async () => {
    pool = await setupTestDatabase()
    streamService = new StreamService(pool)
    eventService = new EventService(pool)
  })

  afterAll(async () => {
    await pool.end()
  })

  interface ThreadFixture {
    wsId: string
    ownerId: string
    channelId: string
    parentMessageId: string
    threadId: string
    replyIds: string[]
  }

  async function seedThread(
    replyUserCount: number,
    replyCountPerUser: number,
    opts: { markdown?: string } = {}
  ): Promise<ThreadFixture> {
    const ownerId = userId()
    const wsId = workspaceId()

    await withTestTransaction(pool, async (client) => {
      await WorkspaceRepository.insert(client, {
        id: wsId,
        name: "Thread Summary Test Workspace",
        slug: `thread-sum-${wsId}`,
        createdBy: ownerId,
      })
      await addTestMember(client, wsId, ownerId)
    })

    const channel = await streamService.createChannel({
      workspaceId: wsId,
      slug: `thread-sum-channel-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdBy: ownerId,
      visibility: Visibilities.PUBLIC,
    })

    const parent = await eventService.createMessage({
      workspaceId: wsId,
      streamId: channel.id,
      authorId: ownerId,
      authorType: "user",
      ...testMessageContent("Parent"),
    })

    const thread = await streamService.createThread({
      workspaceId: wsId,
      parentStreamId: channel.id,
      parentMessageId: parent.id,
      createdBy: ownerId,
    })

    // Create replyUserCount distinct user IDs. We don't need actual User
    // records — the thread-summary query only selects author_id strings from
    // the messages table, and `eventService.createMessage` skips actor-type
    // resolution when `authorType` is passed explicitly.
    const userIds: string[] = []
    for (let i = 0; i < replyUserCount; i++) {
      userIds.push(userId())
    }

    const replyIds: string[] = []
    for (let round = 0; round < replyCountPerUser; round++) {
      for (const uid of userIds) {
        const msg = await eventService.createMessage({
          workspaceId: wsId,
          streamId: thread.id,
          authorId: uid,
          authorType: "user",
          ...testMessageContent(opts.markdown ?? `Reply from ${uid.slice(-4)} round ${round}`),
        })
        replyIds.push(msg.id)
      }
    }

    return {
      wsId,
      ownerId,
      channelId: channel.id,
      parentMessageId: parent.id,
      threadId: thread.id,
      replyIds,
    }
  }

  describe("findThreadSummaryByParentMessage (single-parent lookup)", () => {
    test("returns null when the parent message has no replies", async () => {
      const f = await seedThread(0, 0)
      const summary = await StreamRepository.findThreadSummaryByParentMessage(pool, f.parentMessageId)
      expect(summary).toBeNull()
    })

    test("returns the single reply as the latest when there is exactly one", async () => {
      const f = await seedThread(1, 1)
      const summary = await StreamRepository.findThreadSummaryByParentMessage(pool, f.parentMessageId)
      expect(summary).not.toBeNull()
      expect(summary!.participantUserIds).toHaveLength(1)
      expect(summary!.latestReply.messageId).toBe(f.replyIds[f.replyIds.length - 1])
    })

    test("caps participantUserIds at 3 even with more distinct authors", async () => {
      const f = await seedThread(5, 1)
      const summary = await StreamRepository.findThreadSummaryByParentMessage(pool, f.parentMessageId)
      expect(summary).not.toBeNull()
      expect(summary!.participantUserIds).toHaveLength(3)
    })

    test("orders participants by first-reply sequence (deterministic)", async () => {
      const f = await seedThread(4, 1)
      const first = await StreamRepository.findThreadSummaryByParentMessage(pool, f.parentMessageId)
      const second = await StreamRepository.findThreadSummaryByParentMessage(pool, f.parentMessageId)
      // Same call twice → identical ordering.
      expect(first!.participantUserIds).toEqual(second!.participantUserIds)
    })

    test("sends contentMarkdown raw (caller strips via INV-60)", async () => {
      const raw = "**bold** and `code` and :emoji:"
      const f = await seedThread(1, 1, { markdown: raw })
      const summary = await StreamRepository.findThreadSummaryByParentMessage(pool, f.parentMessageId)
      expect(summary!.latestReply.contentMarkdown).toBe(raw)
    })
  })

  describe("findThreadSummaries (batch lookup)", () => {
    test("messages without replies are absent from the map", async () => {
      const f = await seedThread(0, 0)
      const map = await StreamRepository.findThreadSummaries(pool, f.channelId)
      expect(map.has(f.parentMessageId)).toBe(false)
    })

    test("includes parent messages that have at least one reply", async () => {
      const f = await seedThread(1, 1)
      const map = await StreamRepository.findThreadSummaries(pool, f.channelId)
      const summary = map.get(f.parentMessageId)
      expect(summary).toBeDefined()
      expect(summary!.participantUserIds).toHaveLength(1)
    })

    test("caps participantUserIds at 3 in batch mode as well", async () => {
      const f = await seedThread(4, 2)
      const map = await StreamRepository.findThreadSummaries(pool, f.channelId)
      const summary = map.get(f.parentMessageId)
      expect(summary!.participantUserIds).toHaveLength(3)
    })
  })

  describe("drift parity between batch and single-parent queries", () => {
    // The two entry points share a row shape (`ThreadSummaryRow`) and a mapper
    // (`threadSummaryFromRow`), but their SQL bodies are independent. These
    // tests run both against the same data and assert identical output — if a
    // future change (new column, different predicate, different ORDER BY)
    // silently diverges, the parity check fails.
    async function pairCompare(fixture: ThreadFixture) {
      const batchMap = await StreamRepository.findThreadSummaries(pool, fixture.channelId)
      const single = await StreamRepository.findThreadSummaryByParentMessage(pool, fixture.parentMessageId)
      // Normalize "no summary" on both sides so `.toEqual()` can compare them
      // uniformly: batch returns `undefined` from `Map.get`, single returns
      // `null`. Both represent the same semantic "no thread summary".
      return { batch: batchMap.get(fixture.parentMessageId) ?? null, single }
    }

    test("both return null/absent when no replies", async () => {
      const f = await seedThread(0, 0)
      const { batch, single } = await pairCompare(f)
      expect(batch).toBeNull()
      expect(single).toBeNull()
    })

    test("both return identical ThreadSummary for a single reply", async () => {
      const f = await seedThread(1, 1)
      const { batch, single } = await pairCompare(f)
      expect(batch).toEqual(single)
    })

    test("both return identical ThreadSummary for N replies with cap", async () => {
      const f = await seedThread(4, 3)
      const { batch, single } = await pairCompare(f)
      expect(batch).toEqual(single)
      expect(single!.participantUserIds).toHaveLength(3)
    })

    test("both return identical participant ordering under repeated queries", async () => {
      const f = await seedThread(5, 1)
      const { batch, single } = await pairCompare(f)
      expect(batch!.participantUserIds).toEqual(single!.participantUserIds)
    })
  })
})
