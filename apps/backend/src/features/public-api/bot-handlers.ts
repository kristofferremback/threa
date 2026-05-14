import { z } from "zod"
import type { Request, Response } from "express"
import type { Pool } from "pg"
import { BotRepository, type Bot } from "./bot-repository"
import { BotApiKeyRepository, type BotApiKeyRow } from "./bot-api-key-repository"
import { BotChannelAccessRepository } from "../api-keys"
import { StreamRepository } from "../streams"
import type { StreamService } from "../streams"
import type { AvatarService } from "../workspaces"
import type { BotApiKeyService } from "./bot-api-key-service"
import { serializeBot } from "./handlers"
import { botId, botChannelAccessId } from "../../lib/id"
import { generateSlug } from "@threa/backend-common"
import { sql, withTransaction } from "../../db"
import { OutboxRepository } from "../../lib/outbox"
import { HttpError } from "@threa/backend-common"
import { isUniqueViolation } from "../../lib/errors"
import {
  API_KEY_ELIGIBLE_SCOPES,
  BOT_TRAITS,
  BOT_TYPES,
  BotTypes,
  permissionsForRole,
  WORKSPACE_PERMISSION_SCOPES,
  type BotApiKey,
  type BotTrait,
  type WorkspacePermissionSlug,
} from "@threa/types"

const ALL_BOT_TRAITS = BOT_TRAITS as readonly BotTrait[]

const createBotSchema = z.object({
  type: z.enum(BOT_TYPES).optional().default("shared"),
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50),
  description: z.string().max(500).nullable().optional(),
  avatarEmoji: z.string().nullable().optional(),
  traits: z.array(z.enum(ALL_BOT_TRAITS)).optional(),
})

const updateBotSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(50).optional(),
  description: z.string().max(500).nullable().optional(),
  avatarEmoji: z.string().nullable().optional(),
  traits: z.array(z.enum(ALL_BOT_TRAITS)).optional(),
})

const createBotKeySchema = z.object({
  name: z.string().min(1, "name is required").max(100),
  scopes: z.array(z.enum(API_KEY_ELIGIBLE_SCOPES)).min(1, "at least one scope is required"),
  expiresAt: z
    .string()
    .datetime()
    .nullable()
    .optional()
    .refine((val) => val == null || new Date(val) > new Date(), {
      message: "expiresAt must be a future date",
    }),
})

function serializeBotKey(row: BotApiKeyRow): BotApiKey {
  return {
    id: row.id,
    botId: row.botId,
    name: row.name,
    keyPrefix: row.keyPrefix,
    scopes: row.scopes as WorkspacePermissionSlug[],
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

interface BotHandlerDeps {
  botApiKeyService: BotApiKeyService
  avatarService: AvatarService
  streamService: StreamService
  pool: Pool
}

function resolveWorkspaceUserActorId(req: Request): string | null {
  return req.user?.id ?? req.userApiKey?.userId ?? null
}

function resolveGrantActorId(req: Request): string | null {
  return resolveWorkspaceUserActorId(req) ?? req.botApiKey?.botId ?? null
}

/**
 * Authorize an actor to manage a bot.
 *
 * - Personal bots: actor must own the bot (ownership-based, not permission-based).
 * - Shared bots:   actor must hold the `bots:manage` permission.
 */
async function authorizeBotManagement(pool: Pool, workspaceId: string, id: string, req: Request): Promise<Bot> {
  const bot = await BotRepository.findById(pool, workspaceId, id)
  if (!bot) {
    throw new HttpError("Bot not found", { status: 404, code: "NOT_FOUND" })
  }
  if (bot.type === BotTypes.PERSONAL) {
    // Use the workspace user ID for ownership checks — req.authUser.id is the
    // WorkOS user ID and must not be compared against bots.owner_user_id.
    const actorId = resolveWorkspaceUserActorId(req)
    if (actorId !== bot.ownerUserId) {
      throw new HttpError("Forbidden", { status: 403, code: "FORBIDDEN" })
    }
  } else if (
    // Shared bots use the standard permission-gate pattern (mirrors the session
    // path of `requireWorkspacePermission` middleware). Inlined because the gate
    // depends on the bot type, which isn't known at route registration time.
    !req.authUser?.permissions?.includes(WORKSPACE_PERMISSION_SCOPES.BOTS_MANAGE) &&
    !(req.user && (permissionsForRole(req.user.role) as readonly string[]).includes(WORKSPACE_PERMISSION_SCOPES.BOTS_MANAGE))
  ) {
    throw new HttpError("Insufficient permissions", { status: 403, code: "FORBIDDEN" })
  }
  return bot
}

export function createBotHandlers({ botApiKeyService, avatarService, streamService, pool }: BotHandlerDeps) {
  return {
    /** POST /api/workspaces/:workspaceId/bots */
    async create(req: Request, res: Response) {
      const workspaceId = req.workspaceId!

      const result = createBotSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const { type, name, description, avatarEmoji, traits } = result.data

      // Authorization branches by bot type. Permission checks are inlined
      // because the required slug depends on the `type` field in the request
      // body, which isn't known at route registration time.
      const hasCreatePerm = (slug: WorkspacePermissionSlug): boolean =>
        req.authUser?.permissions?.includes(slug) ??
        (req.user != null && (permissionsForRole(req.user.role) as readonly string[]).includes(slug)) ??
        false
      if (type === BotTypes.PERSONAL) {
        if (!hasCreatePerm(WORKSPACE_PERMISSION_SCOPES.BOTS_CREATE_PERSONAL)) {
          throw new HttpError("Insufficient permissions to create personal bots", {
            status: 403,
            code: "FORBIDDEN",
          })
        }
      } else if (!hasCreatePerm(WORKSPACE_PERMISSION_SCOPES.BOTS_CREATE_SHARED)) {
        throw new HttpError("Insufficient permissions to create shared bots", {
          status: 403,
          code: "FORBIDDEN",
        })
      }

      // Owner is server-derived from the authenticated actor — never read
      // from the request body — so callers can't spoof ownership.
      // Use req.user.id (workspace user ID) in preference to req.authUser.id
      // (WorkOS user ID) — bot.ownerUserId stores the local DB user ID.
      const actorId = resolveWorkspaceUserActorId(req)
      if (type === BotTypes.PERSONAL && !actorId) {
        throw new HttpError("Not authenticated", { status: 401, code: "UNAUTHORIZED" })
      }
      const ownerUserId = type === BotTypes.PERSONAL ? actorId : null

      const slug = generateSlug(result.data.slug)
      if (!slug) {
        return res.status(400).json({
          error: "Validation failed",
          details: { slug: ["Slug cannot be empty after normalization"] },
        })
      }

      let bot
      try {
        bot = await withTransaction(pool, async (client) => {
          const created = await BotRepository.create(client, {
            id: botId(),
            workspaceId,
            type,
            ownerUserId,
            traits: traits ?? [],
            slug,
            name,
            description: description ?? null,
            avatarEmoji: avatarEmoji ?? null,
          })

          await OutboxRepository.insert(client, "bot:created", {
            workspaceId,
            bot: serializeBot(created),
          })

          return created
        })
      } catch (error) {
        if (isUniqueViolation(error, "idx_bots_workspace_slug")) {
          throw new HttpError(`A bot with slug "${slug}" already exists`, { status: 409, code: "DUPLICATE_SLUG" })
        }
        throw error
      }

      res.status(201).json({ data: serializeBot(bot) })
    },

    /** PATCH /api/workspaces/:workspaceId/bots/:botId */
    async update(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const { botId: id } = req.params

      await authorizeBotManagement(pool, workspaceId, id, req)

      const result = updateBotSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const fields = { ...result.data }
      if (fields.slug) {
        fields.slug = generateSlug(fields.slug)
        if (!fields.slug) {
          return res.status(400).json({
            error: "Validation failed",
            details: { slug: ["Slug cannot be empty after normalization"] },
          })
        }
      }

      let bot
      try {
        bot = await withTransaction(pool, async (client) => {
          const updated = await BotRepository.update(client, id, workspaceId, fields)
          if (!updated) {
            throw new HttpError("Bot not found", { status: 404, code: "NOT_FOUND" })
          }

          await OutboxRepository.insert(client, "bot:updated", {
            workspaceId,
            bot: serializeBot(updated),
          })

          return updated
        })
      } catch (error) {
        if (fields.slug && isUniqueViolation(error, "idx_bots_workspace_slug")) {
          throw new HttpError(`A bot with slug "${fields.slug}" already exists`, {
            status: 409,
            code: "DUPLICATE_SLUG",
          })
        }
        throw error
      }

      res.json({ data: serializeBot(bot) })
    },

    /**
     * GET /api/workspaces/:workspaceId/bots
     *
     * Lists shared (workspace-wide) bots only. Personal bots are private to
     * their owner and listed via `/api/v1/workspaces/:wid/me/bots`.
     */
    async list(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const bots = await BotRepository.listByWorkspace(pool, workspaceId, { type: BotTypes.SHARED })
      res.json({ data: bots.map(serializeBot) })
    },

    /**
     * GET /api/workspaces/:workspaceId/bots/:botId
     *
     * Visibility rules mirror `list()`: shared bots are visible to any
     * workspace member; personal bots are visible only to their owner.
     */
    async get(req: Request, res: Response) {
      const { botId: id } = req.params
      const bot = await BotRepository.findById(pool, req.workspaceId!, id)
      if (!bot) {
        throw new HttpError("Bot not found", { status: 404, code: "NOT_FOUND" })
      }
      if (bot.type === BotTypes.PERSONAL && bot.ownerUserId !== resolveWorkspaceUserActorId(req)) {
        throw new HttpError("Bot not found", { status: 404, code: "NOT_FOUND" })
      }
      res.json({ data: serializeBot(bot) })
    },

    /** POST /api/workspaces/:workspaceId/bots/:botId/archive */
    async archive(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const { botId: id } = req.params

      await authorizeBotManagement(pool, workspaceId, id, req)

      const bot = await withTransaction(pool, async (client) => {
        const archived = await BotRepository.archive(client, id, workspaceId)
        if (!archived) {
          throw new HttpError("Bot not found or already archived", { status: 404, code: "NOT_FOUND" })
        }

        // Revoke all active keys and channel grants on archive
        await BotApiKeyRepository.revokeAllByBot(client, workspaceId, id)
        await BotChannelAccessRepository.revokeAllByBot(client, workspaceId, id)

        await OutboxRepository.insert(client, "bot:updated", {
          workspaceId,
          bot: serializeBot(archived),
        })

        return archived
      })

      res.json({ data: serializeBot(bot) })
    },

    /** POST /api/workspaces/:workspaceId/bots/:botId/restore */
    async restore(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const { botId: id } = req.params

      await authorizeBotManagement(pool, workspaceId, id, req)

      let bot
      try {
        bot = await withTransaction(pool, async (client) => {
          const restored = await BotRepository.restore(client, id, workspaceId)
          if (!restored) {
            throw new HttpError("Bot not found or not archived", { status: 404, code: "NOT_FOUND" })
          }

          await OutboxRepository.insert(client, "bot:updated", {
            workspaceId,
            bot: serializeBot(restored),
          })

          return restored
        })
      } catch (error) {
        if (isUniqueViolation(error, "idx_bots_workspace_slug")) {
          throw new HttpError(
            "Cannot restore bot: another bot with the same slug already exists. Rename the conflicting bot first.",
            { status: 409, code: "DUPLICATE_SLUG" }
          )
        }
        throw error
      }

      res.json({ data: serializeBot(bot) })
    },

    // --- Bot API key management ---

    /** GET /api/workspaces/:workspaceId/bots/:botId/keys */
    async listKeys(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const { botId: id } = req.params

      await authorizeBotManagement(pool, workspaceId, id, req)

      const keys = await botApiKeyService.listKeys(workspaceId, id)
      res.json({ data: keys.map(serializeBotKey) })
    },

    /** POST /api/workspaces/:workspaceId/bots/:botId/keys */
    async createKey(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const { botId: id } = req.params

      const bot = await authorizeBotManagement(pool, workspaceId, id, req)
      if (bot.archivedAt) {
        throw new HttpError("Bot is archived", { status: 409, code: "BOT_ARCHIVED" })
      }

      const result = createBotKeySchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const { row, value } = await botApiKeyService.createKey({
        workspaceId,
        botId: id,
        name: result.data.name,
        scopes: result.data.scopes as WorkspacePermissionSlug[],
        expiresAt: result.data.expiresAt ? new Date(result.data.expiresAt) : null,
      })

      res.status(201).json({ key: serializeBotKey(row), value })
    },

    /** POST /api/workspaces/:workspaceId/bots/:botId/keys/:keyId/revoke */
    async revokeKey(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const { botId: id, keyId } = req.params

      await authorizeBotManagement(pool, workspaceId, id, req)

      await botApiKeyService.revokeKey(workspaceId, id, keyId)
      res.status(204).send()
    },

    // --- Avatar management ---

    /** POST /api/workspaces/:workspaceId/bots/:botId/avatar */
    async uploadAvatar(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const { botId: id } = req.params

      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" })
      }

      const bot = await authorizeBotManagement(pool, workspaceId, id, req)
      if (bot.archivedAt) {
        throw new HttpError("Bot not found or archived", { status: 404, code: "NOT_FOUND" })
      }

      // Process synchronously — bot avatar uploads are infrequent
      const rawS3Key = await avatarService.uploadRawForBot({
        buffer: req.file.buffer,
        workspaceId,
        botId: id,
      })

      const basePath = avatarService.rawKeyToBasePath(rawS3Key)
      const images = await avatarService.processImages(req.file.buffer)
      await avatarService.uploadImages(basePath, images)

      // Clean up raw file (don't need it after inline processing)
      avatarService.deleteRawFile(rawS3Key)

      const oldAvatarUrl = bot.avatarUrl

      // Update bot with new avatar URL. If the transaction fails (e.g. bot
      // was archived concurrently), clean up the orphaned processed images.
      let updated
      try {
        updated = await withTransaction(pool, async (client) => {
          const result = await BotRepository.updateAvatarUrl(client, id, workspaceId, basePath)
          if (!result) {
            throw new HttpError("Bot not found", { status: 404, code: "NOT_FOUND" })
          }

          await OutboxRepository.insert(client, "bot:updated", {
            workspaceId,
            bot: serializeBot(result),
          })

          return result
        })
      } catch (error) {
        avatarService.deleteAvatarFiles(basePath)
        throw error
      }

      // Clean up old S3 files after transaction succeeds
      if (oldAvatarUrl) {
        avatarService.deleteAvatarFiles(oldAvatarUrl)
      }

      res.json({ data: serializeBot(updated) })
    },

    /** DELETE /api/workspaces/:workspaceId/bots/:botId/avatar */
    async removeAvatar(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const { botId: id } = req.params

      const bot = await authorizeBotManagement(pool, workspaceId, id, req)
      if (bot.archivedAt) {
        throw new HttpError("Bot not found or archived", { status: 404, code: "NOT_FOUND" })
      }

      if (!bot.avatarUrl) {
        return res.json({ data: serializeBot(bot) })
      }

      const oldAvatarUrl = bot.avatarUrl

      const updated = await withTransaction(pool, async (client) => {
        const result = await BotRepository.updateAvatarUrl(client, id, workspaceId, null)
        if (!result) {
          throw new HttpError("Bot not found", { status: 404, code: "NOT_FOUND" })
        }

        await OutboxRepository.insert(client, "bot:updated", {
          workspaceId,
          bot: serializeBot(result),
        })

        return result
      })

      // Clean up old S3 files after transaction succeeds
      avatarService.deleteAvatarFiles(oldAvatarUrl)

      res.json({ data: serializeBot(updated) })
    },

    /** GET /api/workspaces/:workspaceId/bots/:botId/avatar/:file */
    async serveAvatarFile(req: Request, res: Response) {
      const { workspaceId, botId: id, file } = req.params
      if (!workspaceId || !id || !file) {
        return res.status(404).end()
      }

      try {
        const stream = await avatarService.streamBotAvatarFile({ workspaceId, botId: id, file })
        if (!stream) return res.status(404).end()

        res.set("Content-Type", "image/webp")
        res.set("Cache-Control", "public, max-age=31536000, immutable")
        stream.on("error", () => {
          if (!res.headersSent) {
            res.status(500).end()
          } else {
            res.end()
          }
        })
        stream.pipe(res)
      } catch {
        return res.status(404).end()
      }
    },

    // --- Channel access grants ---

    /** GET /api/workspaces/:workspaceId/bots/:botId/streams */
    async listStreamGrants(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const { botId: id } = req.params

      await authorizeBotManagement(pool, workspaceId, id, req)

      const grants = await BotChannelAccessRepository.listGrants(pool, workspaceId, id)
      res.json({ data: grants })
    },

    /**
     * POST /api/workspaces/:workspaceId/bots/:botId/streams/:streamId/grant
     *
     * Authorization:
     *   - Shared bot:   actor must have `bots:manage` permission.
     *   - Personal bot: actor must be the owner AND a member of the target stream.
     *
     * The membership requirement on personal bots prevents a user from granting
     * their bot access to a stream they themselves can't reach.
     *
     * Delegates to `streamService.addBotToStreamOn` so the `member_added` event
     * and `stream:member_added` outbox message fire correctly — real-time
     * clients subscribe to these to see bot grants appear.
     */
    async grantStreamAccess(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const { botId: id, streamId } = req.params

      const bot = await authorizeBotManagement(pool, workspaceId, id, req)

      await withTransaction(pool, async (client) => {
        // Lock bot and stream rows to prevent race conditions
        const { rows: botRows } = await client.query<{ archived_at: Date | null }>(sql`
          SELECT archived_at FROM bots
          WHERE id = ${id} AND workspace_id = ${workspaceId}
          FOR UPDATE
        `)
        if (botRows.length === 0 || botRows[0].archived_at !== null) {
          throw new HttpError("Bot not found or archived", { status: 404, code: "NOT_FOUND" })
        }

        const { rows: streamRows } = await client.query<{ archived_at: Date | null }>(sql`
          SELECT archived_at FROM streams
          WHERE id = ${streamId} AND workspace_id = ${workspaceId}
          FOR UPDATE
        `)
        if (streamRows.length === 0 || streamRows[0].archived_at !== null) {
          throw new HttpError("Stream not found", { status: 404, code: "NOT_FOUND" })
        }

        // Personal bot owners must be members of the target stream
        if (bot.type === BotTypes.PERSONAL) {
          const ownerId = resolveWorkspaceUserActorId(req)
          if (!ownerId) {
            throw new HttpError("Not authenticated", { status: 401, code: "UNAUTHORIZED" })
          }
          const ownerIsMember = await streamService.isMemberOnForUpdate(client, streamId, ownerId)
          if (!ownerIsMember) {
            throw new HttpError("Forbidden", { status: 403, code: "FORBIDDEN" })
          }
        }

        // Resolve the actor that performs the grant. authorizeBotManagement has
        // already checked auth, so this is defensive — reject with 401 rather
        // than silently passing a bogus id.
        const grantActorId = resolveGrantActorId(req)
        if (!grantActorId) {
          throw new HttpError("Not authenticated", { status: 401, code: "UNAUTHORIZED" })
        }
        await streamService.addBotToStreamOn(client, streamId, id, workspaceId, grantActorId)
      })

      res.status(204).send()
    },

    /** DELETE /api/workspaces/:workspaceId/bots/:botId/streams/:streamId/grant */
    async revokeStreamAccess(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const { botId: id, streamId } = req.params

      await authorizeBotManagement(pool, workspaceId, id, req)

      await streamService.removeBotFromStream(streamId, id, workspaceId)
      res.status(204).send()
    },

    /** GET /api/workspaces/:workspaceId/streams/:streamId/bots — list bot IDs with access to a stream */
    async listStreamBots(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const { streamId } = req.params
      const botIds = await BotChannelAccessRepository.getGrantedBotIds(pool, workspaceId, streamId)
      res.json({ data: botIds })
    },
  }
}
