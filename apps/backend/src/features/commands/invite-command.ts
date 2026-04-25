import type { Pool } from "pg"
import type { Command, CommandContext, CommandResult } from "./registry"
import { StreamRepository, type Stream, type StreamService } from "../streams"
import { UserRepository } from "../workspaces"
import { BotRepository } from "../public-api"
import { resolveWorkspaceAuthorization } from "../../middleware/workspace-authz-resolver"
import { StreamTypes } from "@threa/types"

interface InviteCommandDeps {
  pool: Pool
  streamService: StreamService
}

type Entity =
  | { type: "user"; id: string; slug: string; name: string }
  | { type: "bot"; id: string; slug: string; name: string }

interface InvitedWire {
  name: string
  slug: string
  type: "user" | "bot"
}

interface InviteResult {
  invited: InvitedWire[]
  unknown?: string[]
  errors?: string[]
}

/**
 * /invite @slug1 @slug2 ... — invite users or bots to a channel or a thread
 * rooted in a channel. Bots may only be invited by users with workspace admin
 * permission.
 */
export class InviteCommand implements Command {
  name = "invite"
  description = "Invite users or bots to this channel"

  constructor(private readonly deps: InviteCommandDeps) {}

  async execute(ctx: CommandContext): Promise<CommandResult> {
    const slugs = parseSlugs(ctx.args)
    if (slugs.length === 0) {
      return { success: false, error: "Usage: /invite @user1 @user2 ..." }
    }

    const stream = await StreamRepository.findById(this.deps.pool, ctx.streamId)
    if (!stream || stream.workspaceId !== ctx.workspaceId) {
      return { success: false, error: "Stream not found" }
    }
    if (!(await this.isInviteableStream(stream))) {
      return { success: false, error: "/invite is only available in channels and threads whose root is a channel" }
    }

    const [users, bots, actor] = await Promise.all([
      UserRepository.findBySlugs(this.deps.pool, ctx.workspaceId, slugs),
      BotRepository.findBySlugs(this.deps.pool, ctx.workspaceId, slugs),
      UserRepository.findById(this.deps.pool, ctx.workspaceId, ctx.userId),
    ])

    const actorAuthz =
      actor &&
      (await resolveWorkspaceAuthorization({
        pool: this.deps.pool,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        source: ctx.source,
        workosUserId: actor.workosUserId,
      }))

    const canInviteBots = actorAuthz?.status === "ok" && actorAuthz.value.permissions.has("workspace:admin")
    if (bots.length > 0 && !canInviteBots) {
      return { success: false, error: "Missing required permission: workspace:admin" }
    }

    const entities: Entity[] = [
      ...users.map<Entity>((u) => ({ type: "user", id: u.id, slug: u.slug, name: u.name })),
      // findBySlugs matches on slug = ANY(...), so b.slug is guaranteed non-null here.
      ...bots.map<Entity>((b) => ({ type: "bot", id: b.id, slug: b.slug!, name: b.name })),
    ]
    if (entities.length === 0) {
      return { success: false, error: `Unknown users or bots: ${slugs.map((s) => `@${s}`).join(" ")}` }
    }

    const found = new Set(entities.map((e) => e.slug))
    const unknown = slugs.filter((s) => !found.has(s))

    const invited: InvitedWire[] = []
    const errors: string[] = []
    for (const entity of entities) {
      try {
        if (entity.type === "user") {
          await this.deps.streamService.addMember(ctx.streamId, entity.id, ctx.workspaceId, ctx.userId)
        } else {
          await this.deps.streamService.addBotToStream(ctx.streamId, entity.id, ctx.workspaceId, ctx.userId)
        }
        invited.push({ name: entity.name, slug: entity.slug, type: entity.type })
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to invite"
        errors.push(`@${entity.slug}: ${message}`)
      }
    }

    if (invited.length === 0) {
      return { success: false, error: errors.join("; ") }
    }

    const result: InviteResult = { invited }
    if (unknown.length > 0) result.unknown = unknown.map((s) => `@${s}`)
    if (errors.length > 0) result.errors = errors
    return { success: true, result }
  }

  private async isInviteableStream(stream: Stream): Promise<boolean> {
    if (stream.type === StreamTypes.CHANNEL) return true
    if (stream.type !== StreamTypes.THREAD || !stream.rootStreamId) return false
    const root = await StreamRepository.findById(this.deps.pool, stream.rootStreamId)
    return root?.type === StreamTypes.CHANNEL
  }
}

function parseSlugs(args: string): string[] {
  return args
    .trim()
    .split(/\s+/)
    .filter((t) => t.startsWith("@"))
    .map((t) => t.slice(1))
    .filter(Boolean)
}
