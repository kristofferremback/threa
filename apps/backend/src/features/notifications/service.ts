import type { Pool } from "pg"
import { sql, withTransaction } from "../../db"
import { StreamRepository, StreamMemberRepository, type Stream } from "../streams"
import { OutboxRepository } from "../../lib/outbox"
import type { BudgetAlertOutboxPayload } from "../../lib/outbox"
import { MemberRepository } from "../workspaces"
import { streamId } from "../../lib/id"
import { StreamTypes, Visibilities, CompanionModes, AuthorTypes } from "@threa/types"
import type { AuthorType } from "@threa/types"
import type { Message } from "../messaging"
import { logger } from "../../lib/logger"

const BACKFILL_BATCH_SIZE = 100

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
   * Uses INSERT ... ON CONFLICT for each member to handle concurrent provisioning.
   */
  private async bulkProvisionSystemStreams(workspaceId: string, memberIds: string[]): Promise<Stream[]> {
    return withTransaction(this.pool, async (client) => {
      const streams: Stream[] = []

      for (const memberId of memberIds) {
        const id = streamId()
        const { stream, created } = await StreamRepository.insertSystemStream(client, {
          id,
          workspaceId,
          createdBy: memberId,
        })

        if (created) {
          await StreamMemberRepository.insert(client, id, memberId)
          await OutboxRepository.insert(client, "stream:created", {
            workspaceId,
            streamId: stream.id,
            stream,
          })
        }

        streams.push(stream)
      }

      return streams
    })
  }

  /**
   * Backfill system streams for all workspace members who don't have one yet.
   * Safe to call on every startup — uses INSERT ... ON CONFLICT for idempotency.
   * Processes in batches grouped by workspace to minimize transaction count.
   */
  async backfillSystemStreams(): Promise<void> {
    let totalProvisioned = 0

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result = await this.pool.query<{ workspace_id: string; member_id: string }>(sql`
        SELECT wm.workspace_id, wm.id AS member_id
        FROM workspace_members wm
        WHERE NOT EXISTS (
          SELECT 1 FROM streams s
          WHERE s.workspace_id = wm.workspace_id
            AND s.type = ${StreamTypes.SYSTEM}
            AND s.created_by = wm.id
        )
        LIMIT ${BACKFILL_BATCH_SIZE}
      `)

      if (result.rows.length === 0) break

      logger.info({ batchSize: result.rows.length }, "Backfilling system streams batch")

      // Group by workspace for batched provisioning (one transaction per workspace)
      const byWorkspace = new Map<string, string[]>()
      for (const row of result.rows) {
        const members = byWorkspace.get(row.workspace_id) ?? []
        members.push(row.member_id)
        byWorkspace.set(row.workspace_id, members)
      }

      for (const [wsId, memberIds] of byWorkspace) {
        try {
          await this.bulkProvisionSystemStreams(wsId, memberIds)
          totalProvisioned += memberIds.length
        } catch (err) {
          logger.error({ err, workspaceId: wsId }, "Failed to backfill system streams for workspace")
        }
      }
    }

    if (totalProvisioned > 0) {
      logger.info({ count: totalProvisioned }, "System stream backfill complete")
    }
  }
}
