import type { Pool } from "pg"
import { withTransaction } from "../../db"
import { StreamRepository, StreamMemberRepository, type Stream } from "../streams"
import { OutboxRepository } from "../../lib/outbox"
import { MemberRepository } from "../workspaces"
import { streamId } from "../../lib/id"
import { StreamTypes, Visibilities, CompanionModes, AuthorTypes } from "@threa/types"
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

  async provisionSystemStream(workspaceId: string, memberId: string): Promise<Stream> {
    // Check first to make it idempotent
    const existing = await this.findSystemStream(workspaceId, memberId)
    if (existing) return existing

    return withTransaction(this.pool, async (client) => {
      // Re-check inside transaction to handle concurrent provisioning
      const existingInTx = await StreamRepository.findByTypeAndOwner(client, workspaceId, StreamTypes.SYSTEM, memberId)
      if (existingInTx) return existingInTx

      const id = streamId()

      const stream = await StreamRepository.insert(client, {
        id,
        workspaceId,
        type: StreamTypes.SYSTEM,
        displayName: "System",
        visibility: Visibilities.PRIVATE,
        companionMode: CompanionModes.OFF,
        createdBy: memberId,
      })

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

  async notifyWorkspace(workspaceId: string, contentMarkdown: string): Promise<void> {
    const members = await MemberRepository.listByWorkspace(this.pool, workspaceId)

    for (const member of members) {
      try {
        await this.notifyMember(workspaceId, member.id, contentMarkdown)
      } catch (err) {
        logger.error({ err, workspaceId, memberId: member.id }, "Failed to notify member")
      }
    }
  }
}
