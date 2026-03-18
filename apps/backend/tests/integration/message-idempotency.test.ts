import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Pool } from "pg"
import { setupTestDatabase, withTransaction, addTestMember, testMessageContent } from "./setup"
import { WorkspaceRepository } from "../../src/features/workspaces"
import { StreamRepository } from "../../src/features/streams"
import { MessageRepository } from "../../src/features/messaging"
import { EventService } from "../../src/features/messaging/event-service"
import { userId, workspaceId, streamId } from "../../src/lib/id"

describe("Message idempotency", () => {
  let pool: Pool
  let testUserId: string
  let testWorkspaceId: string
  let testStreamId: string

  beforeAll(async () => {
    pool = await setupTestDatabase()

    testUserId = userId()
    testWorkspaceId = workspaceId()
    testStreamId = streamId()

    await withTransaction(pool, async (client) => {
      await WorkspaceRepository.insert(client, {
        id: testWorkspaceId,
        name: "Test Workspace",
        slug: `test-ws-${testWorkspaceId}`,
        createdBy: testUserId,
      })
      testUserId = (await addTestMember(client, testWorkspaceId, testUserId)).id
      await StreamRepository.insert(client, {
        id: testStreamId,
        workspaceId: testWorkspaceId,
        type: "scratchpad",
        visibility: "private",
        companionMode: "off",
        createdBy: testUserId,
      })
    })
  })

  afterAll(async () => {
    await pool.end()
  })

  test("returns existing message when clientMessageId already exists", async () => {
    const service = new EventService(pool)
    const clientMessageId = `dedup_${Date.now()}`

    const first = await service.createMessage({
      workspaceId: testWorkspaceId,
      streamId: testStreamId,
      authorId: testUserId,
      authorType: "user",
      ...testMessageContent("hello"),
      clientMessageId,
    })

    const second = await service.createMessage({
      workspaceId: testWorkspaceId,
      streamId: testStreamId,
      authorId: testUserId,
      authorType: "user",
      ...testMessageContent("hello"),
      clientMessageId,
    })

    expect(second.id).toBe(first.id)
    expect(second.contentMarkdown).toBe("hello")
  })

  test("creates separate messages when clientMessageId differs", async () => {
    const service = new EventService(pool)

    const first = await service.createMessage({
      workspaceId: testWorkspaceId,
      streamId: testStreamId,
      authorId: testUserId,
      authorType: "user",
      ...testMessageContent("msg A"),
      clientMessageId: `unique_a_${Date.now()}`,
    })

    const second = await service.createMessage({
      workspaceId: testWorkspaceId,
      streamId: testStreamId,
      authorId: testUserId,
      authorType: "user",
      ...testMessageContent("msg B"),
      clientMessageId: `unique_b_${Date.now()}`,
    })

    expect(second.id).not.toBe(first.id)
  })

  test("creates separate messages when clientMessageId is omitted", async () => {
    const service = new EventService(pool)

    const first = await service.createMessage({
      workspaceId: testWorkspaceId,
      streamId: testStreamId,
      authorId: testUserId,
      authorType: "user",
      ...testMessageContent("no dedup 1"),
    })

    const second = await service.createMessage({
      workspaceId: testWorkspaceId,
      streamId: testStreamId,
      authorId: testUserId,
      authorType: "user",
      ...testMessageContent("no dedup 2"),
    })

    expect(second.id).not.toBe(first.id)
  })

  test("concurrent sends with same clientMessageId produce one message", async () => {
    const service = new EventService(pool)
    const clientMessageId = `concurrent_${Date.now()}`

    const params = {
      workspaceId: testWorkspaceId,
      streamId: testStreamId,
      authorId: testUserId,
      authorType: "user" as const,
      ...testMessageContent("concurrent"),
      clientMessageId,
    }

    const [a, b] = await Promise.all([service.createMessage(params), service.createMessage(params)])

    expect(a.id).toBe(b.id)
  })
})
