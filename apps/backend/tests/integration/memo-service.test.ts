import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Pool } from "pg"
import { KnowledgeTypes, MemoTypes } from "@threa/types"
import { MessageFormatter } from "../../src/lib/ai/message-formatter"
import { messageId, pendingItemId, streamId, userId, workspaceId } from "../../src/lib/id"
import { MessageRepository, type Message } from "../../src/features/messaging"
import { MemoRepository, MemoService, PendingItemRepository } from "../../src/features/memos"
import type { MemoClassifier } from "../../src/features/memos/classifier"
import type { EmbeddingServiceLike, Memorizer } from "../../src/features/memos"
import { StreamRepository } from "../../src/features/streams"
import { WorkspaceRepository } from "../../src/features/workspaces"
import { addTestMember, setupTestDatabase, testMessageContent, withTransaction } from "./setup"

describe("MemoService", () => {
  let pool: Pool

  beforeAll(async () => {
    pool = await setupTestDatabase()
  })

  afterAll(async () => {
    await pool.end()
  })

  test("creates a message memo even when classifier marks the message as not a gem", async () => {
    const testWorkspaceId = workspaceId()
    const workosUserId = userId()
    const testStreamId = streamId()
    const testMessageId = messageId()
    let creatorId = ""

    await withTransaction(pool, async (client) => {
      await WorkspaceRepository.insert(client, {
        id: testWorkspaceId,
        name: "Memo Service Workspace",
        slug: `memo-service-${testWorkspaceId}`,
        createdBy: workosUserId,
      })
      creatorId = (await addTestMember(client, testWorkspaceId, workosUserId)).id

      await StreamRepository.insert(client, {
        id: testStreamId,
        workspaceId: testWorkspaceId,
        type: "scratchpad",
        visibility: "private",
        companionMode: "off",
        createdBy: creatorId,
      })

      await MessageRepository.insert(client, {
        id: testMessageId,
        streamId: testStreamId,
        sequence: BigInt(1),
        authorId: "persona_test",
        authorType: "persona",
        ...testMessageContent("Sounds good, I will keep an eye on this."),
      })

      await PendingItemRepository.queue(client, [
        {
          id: pendingItemId(),
          workspaceId: testWorkspaceId,
          streamId: testStreamId,
          itemType: "message",
          itemId: testMessageId,
        },
      ])
    })

    let classifiedMessage: Message | null = null
    const classifier = {
      classifyMessage: async (message: Message) => {
        classifiedMessage = message
        return {
          isGem: false,
          knowledgeType: null,
          confidence: 0.1,
          reasoning: "Acknowledgment only",
        }
      },
    } as unknown as MemoClassifier

    const memorizer = {
      memorizeMessage: async ({ content }: { content: Message }) => ({
        title: "Acknowledgment",
        abstract: content.contentMarkdown,
        keyPoints: [content.contentMarkdown],
        tags: ["acknowledgment"],
        sourceMessageIds: [content.id],
      }),
    } as unknown as Memorizer

    const embeddingService: EmbeddingServiceLike = {
      embed: async () => Array(1536).fill(0.001),
    }

    const service = new MemoService({
      pool,
      classifier,
      memorizer,
      embeddingService,
      messageFormatter: new MessageFormatter(),
    })

    const result = await service.processBatch(testWorkspaceId, testStreamId)

    expect(classifiedMessage?.id).toBe(testMessageId)
    expect(result).toEqual({ processed: 1, memosCreated: 1, memosRevised: 0 })

    const memos = await withTransaction(pool, async (client) => {
      return MemoRepository.findByStream(client, testStreamId, { status: "active" })
    })

    expect(memos).toHaveLength(1)
    expect(memos[0]?.memoType).toBe(MemoTypes.MESSAGE)
    expect(memos[0]?.sourceMessageId).toBe(testMessageId)
    expect(memos[0]?.knowledgeType).toBe(KnowledgeTypes.CONTEXT)
    expect(memos[0]?.participantIds).toEqual(["persona_test"])
  })
})
