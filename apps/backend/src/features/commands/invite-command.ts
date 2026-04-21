import type { Pool } from "pg"
import type { Command, CommandContext, CommandResult } from "./registry"
import { StreamRepository } from "../streams"
import { UserRepository } from "../workspaces"
import { BotRepository } from "../public-api"
import type { StreamService } from "../streams"
import { StreamTypes } from "@threa/types"

interface InviteCommandDeps {
  pool: Pool
  streamService: StreamService
}

interface InvitedEntity {
  id: string
  name: string
  slug: string
  type: "user" | "bot"
}

/**
 * /invite command — invites one or more users or bots to a channel or thread.
 *
 * Usage: /invite @slug1 @slug2 ...
 *
 * Valid in:
 * - channels
 * - threads whose root stream is a channel
 *
 * Bots can only be invited by workspace owners and admins.
 */
export class InviteCommand implements Command {
  name = "invite"
  description = "Invite users or bots to this channel"

  private readonly pool: Pool
  private readonly streamService: StreamService

  constructor(deps: InviteCommandDeps) {
    this.pool = deps.pool
    this.streamService = deps.streamService
  }

  async execute(ctx: CommandContext): Promise<CommandResult> {
    const slugs = this.parseSlugs(ctx.args)
    if (slugs.length === 0) {
      return {
        success: false,
        error: "Usage: /invite @user1 @user2 ...",
      }
    }

    const stream = await StreamRepository.findById(this.pool, ctx.streamId)
    if (!stream || stream.workspaceId !== ctx.workspaceId) {
      return {
        success: false,
        error: "Stream not found",
      }
    }

    // Validate stream type supports invites
    const isValid = await this.isValidStreamForInvite(stream)
    if (!isValid) {
      return {
        success: false,
        error: "/invite is only available in channels and threads whose root is a channel",
      }
    }

    // Resolve slugs to both users and bots in parallel
    const [users, bots] = await Promise.all([
      UserRepository.findBySlugs(this.pool, ctx.workspaceId, slugs),
      BotRepository.findBySlugs(this.pool, ctx.workspaceId, slugs),
    ])

    const foundSlugs = new Set([...users.map((u) => u.slug), ...bots.map((b) => b.slug)].filter(Boolean))
    const unknownSlugs = slugs.filter((s) => !foundSlugs.has(s))

    if (users.length === 0 && bots.length === 0) {
      return {
        success: false,
        error: `Unknown users or bots: ${unknownSlugs.map((s) => `@${s}`).join(" ")}`,
      }
    }

    // Only admins and owners can invite bots
    const actor = await UserRepository.findById(this.pool, ctx.workspaceId, ctx.userId)
    const canInviteBots = actor?.role === "admin" || actor?.role === "owner"

    const invited: InvitedEntity[] = []
    const errors: string[] = []

    // Invite users
    for (const user of users) {
      try {
        await this.streamService.addMember(ctx.streamId, user.id, ctx.workspaceId, ctx.userId)
        invited.push({ id: user.id, name: user.name, slug: user.slug, type: "user" })
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to add member"
        errors.push(`@${user.slug}: ${message}`)
      }
    }

    // Invite bots (admin/owner only)
    for (const bot of bots) {
      if (!canInviteBots) {
        errors.push(`@${bot.slug}: Only admins and owners can invite bots`)
        continue
      }
      try {
        await this.streamService.addBotToStream(ctx.streamId, bot.id, ctx.workspaceId, ctx.userId)
        invited.push({ id: bot.id, name: bot.name, slug: bot.slug ?? bot.id, type: "bot" })
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to add bot"
        errors.push(`@${bot.slug}: ${message}`)
      }
    }

    if (invited.length === 0) {
      return {
        success: false,
        error: errors.join("; "),
      }
    }

    const result: Record<string, unknown> = {
      invited: invited.map((e) => ({ name: e.name, slug: e.slug, type: e.type })),
    }

    if (unknownSlugs.length > 0) {
      result.unknown = unknownSlugs.map((s) => `@${s}`)
    }

    if (errors.length > 0) {
      result.errors = errors
    }

    return {
      success: true,
      result,
    }
  }

  private parseSlugs(args: string): string[] {
    const tokens = args.trim().split(/\s+/)
    const slugs: string[] = []
    for (const token of tokens) {
      if (token.startsWith("@")) {
        slugs.push(token.slice(1))
      }
    }
    return slugs
  }

  private async isValidStreamForInvite(
    stream: Awaited<ReturnType<typeof StreamRepository.findById>>
  ): Promise<boolean> {
    if (!stream) return false

    if (stream.type === StreamTypes.CHANNEL) {
      return true
    }

    if (stream.type === StreamTypes.THREAD && stream.rootStreamId) {
      const rootStream = await StreamRepository.findById(this.pool, stream.rootStreamId)
      return rootStream?.type === StreamTypes.CHANNEL
    }

    return false
  }
}
