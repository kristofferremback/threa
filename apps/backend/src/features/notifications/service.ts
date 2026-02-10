import type { Pool } from "pg"
import { withTransaction } from "../../db"
import { StreamRepository, StreamMemberRepository, type Stream } from "../streams"
import { OutboxRepository, OUTBOX_CHANNEL } from "../../lib/outbox"
import type { BudgetAlertOutboxPayload } from "../../lib/outbox"
import { MemberRepository } from "../workspaces"
import { streamId } from "../../lib/id"
import { StreamTypes, AuthorTypes } from "@threa/types"
import type { AuthorType } from "@threa/types"
import type { Message } from "../messaging"
import { logger } from "../../lib/logger"

interface CreateMessageFn {
  (params: {
    workspaceId: string
    streamId: string
    authorId: string
    authorType: AuthorType
    content: string
  }): Promise<Message>
}

export class NotificationService {
  private pool: Pool
  private createMessage: CreateMessageFn

  constructor(deps: { pool: Pool; createMessage: CreateMessageFn }) {
    this.pool = deps.pool
    this.createMessage = deps.createMessage
  }

  async findSystemStream(workspaceId: string, memberId: string): Promise<Stream | null> {
    return StreamRepository.findByTypeAndOwner(this.pool, workspaceId, StreamTypes.SYSTEM, memberId)
  }

  /**
   * Atomically provision a system stream or return the existing one.
   * Uses INSERT ... ON CONFLICT DO NOTHING on idx_streams_system_per_member
   * to handle concurrent provisioning without races (same pattern as thread creation).
   */
  async provisionSystemStream(workspaceId: string, memberId: string): Promise<Stream> {
    const existing = await this.findSystemStream(workspaceId, memberId)
    if (existing) return existing

    return withTransaction(this.pool, async (client) => {
      const id = streamId()

      const { stream, created } = await StreamRepository.insertSystemStream(client, {
        id,
        workspaceId,
        createdBy: memberId,
      })

      if (!created) return stream

      await StreamMemberRepository.insert(client, id, memberId)

      await OutboxRepository.insert(client, "stream:created", {
        workspaceId,
        streamId: stream.id,
        stream,
      })

      return stream
    })
  }

  async notifyMember(workspaceId: string, memberId: string, contentMarkdown: string): Promise<void> {
    const stream = await this.provisionSystemStream(workspaceId, memberId)

    await this.createMessage({
      workspaceId,
      streamId: stream.id,
      authorId: AuthorTypes.SYSTEM,
      authorType: AuthorTypes.SYSTEM,
      content: contentMarkdown,
    })
  }

  /**
   * Format and send a budget alert notification to all workspace members.
   * Owns the message formatting — outbox handler passes structured data (INV-46).
   */
  async sendBudgetAlert(alert: BudgetAlertOutboxPayload): Promise<void> {
    const { workspaceId, percentUsed, budgetUsd, currentUsageUsd } = alert
    const content = `**Budget alert** — AI usage has reached ${percentUsed}% of your $${budgetUsd}/month budget ($${currentUsageUsd.toFixed(2)} spent).`
    await this.notifyWorkspace(workspaceId, content)
  }

  async notifyWorkspace(workspaceId: string, contentMarkdown: string): Promise<void> {
    const members = await MemberRepository.listByWorkspace(this.pool, workspaceId)

    // Batch-fetch existing system streams to avoid N+1 queries
    const existingStreams = await StreamRepository.list(this.pool, workspaceId, {
      types: [StreamTypes.SYSTEM],
    })
    const streamByCreator = new Map(existingStreams.map((s) => [s.createdBy, s]))

    // Provision missing streams in a single transaction
    const membersWithoutStream = members.filter((m) => !streamByCreator.has(m.id))
    if (membersWithoutStream.length > 0) {
      const newStreams = await this.bulkProvisionSystemStreams(
        workspaceId,
        membersWithoutStream.map((m) => m.id)
      )
      for (const stream of newStreams) {
        streamByCreator.set(stream.createdBy, stream)
      }
    }

    for (const member of members) {
      try {
        const stream = streamByCreator.get(member.id)
        if (!stream) continue

        await this.createMessage({
          workspaceId,
          streamId: stream.id,
          authorId: AuthorTypes.SYSTEM,
          authorType: AuthorTypes.SYSTEM,
          content: contentMarkdown,
        })
      } catch (err) {
        logger.error({ err, workspaceId, memberId: member.id }, "Failed to notify member")
      }
    }
  }

  /**
   * Provision system streams for multiple members in a single transaction.
   * Batches all inserts (streams, members, outbox) to avoid N*3 round-trips.
   */
  private async bulkProvisionSystemStreams(workspaceId: string, memberIds: string[]): Promise<Stream[]> {
    if (memberIds.length === 0) return []

    return withTransaction(this.pool, async (client) => {
      const entries = memberIds.map((memberId) => ({
        id: streamId(),
        workspaceId,
        createdBy: memberId,
      }))

      const { streams, createdIds } = await StreamRepository.bulkInsertSystemStreams(client, entries)
      const created = streams.filter((s) => createdIds.has(s.id))

      if (created.length > 0) {
        // Batch insert stream members
        const memberPlaceholders: string[] = []
        const memberValues: unknown[] = []
        let mIdx = 1
        for (const stream of created) {
          memberPlaceholders.push(`($${mIdx++}, $${mIdx++})`)
          memberValues.push(stream.id, stream.createdBy)
        }
        await client.query(
          `INSERT INTO stream_members (stream_id, member_id)
           VALUES ${memberPlaceholders.join(", ")}
           ON CONFLICT (stream_id, member_id) DO NOTHING`,
          memberValues
        )

        // Batch insert outbox events
        const outboxPlaceholders: string[] = []
        const outboxValues: unknown[] = []
        let oIdx = 1
        for (const stream of created) {
          outboxPlaceholders.push(`($${oIdx++}, $${oIdx++}::jsonb)`)
          outboxValues.push("stream:created", JSON.stringify({ workspaceId, streamId: stream.id, stream }))
        }
        await client.query(
          `INSERT INTO outbox (event_type, payload)
           VALUES ${outboxPlaceholders.join(", ")}`,
          outboxValues
        )
        await client.query(`NOTIFY ${OUTBOX_CHANNEL}`)
      }

      return streams
    })
  }
}
