import type { Pool } from "pg"
import { StreamRepository, type Stream } from "../streams"
import type { BudgetAlertOutboxPayload } from "../../lib/outbox"
import { MemberRepository } from "../workspaces"
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

export class SystemMessageService {
  private pool: Pool
  private createMessage: CreateMessageFn

  constructor(deps: { pool: Pool; createMessage: CreateMessageFn }) {
    this.pool = deps.pool
    this.createMessage = deps.createMessage
  }

  async findSystemStream(workspaceId: string, memberId: string): Promise<Stream | null> {
    return StreamRepository.findByTypeAndOwner(this.pool, workspaceId, StreamTypes.SYSTEM, memberId)
  }

  async notifyMember(workspaceId: string, memberId: string, contentMarkdown: string): Promise<void> {
    const stream = await this.findSystemStream(workspaceId, memberId)
    if (!stream) {
      logger.error({ workspaceId, memberId }, "System stream missing for member — should have been created on join")
      return
    }

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

    const existingStreams = await StreamRepository.list(this.pool, workspaceId, {
      types: [StreamTypes.SYSTEM],
    })
    const streamByCreator = new Map(existingStreams.map((s) => [s.createdBy, s]))

    for (const member of members) {
      try {
        const stream = streamByCreator.get(member.id)
        if (!stream) {
          logger.error(
            { workspaceId, memberId: member.id },
            "System stream missing for member — should have been created on join"
          )
          continue
        }

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
}
