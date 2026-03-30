import { z } from "zod"
import type { Request, Response } from "express"
import type { Pool } from "pg"
import { BotRepository } from "./bot-repository"
import { BotApiKeyRepository, type BotApiKeyRow } from "./bot-api-key-repository"
import type { BotApiKeyService } from "./bot-api-key-service"
import { serializeBot } from "./handlers"
import { botId } from "../../lib/id"
import { withTransaction } from "../../db"
import { OutboxRepository } from "../../lib/outbox"
import { HttpError } from "@threa/backend-common"
import { API_KEY_SCOPES, type ApiKeyScope, type BotApiKey } from "@threa/types"

const ALL_SCOPES = Object.values(API_KEY_SCOPES)

const createBotSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/, "Slug must be lowercase alphanumeric with optional hyphens"),
  description: z.string().max(500).nullable().optional(),
  avatarEmoji: z.string().nullable().optional(),
})

const updateBotSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/, "Slug must be lowercase alphanumeric with optional hyphens")
    .optional(),
  description: z.string().max(500).nullable().optional(),
  avatarEmoji: z.string().nullable().optional(),
})

const createBotKeySchema = z.object({
  name: z.string().min(1, "name is required").max(100),
  scopes: z.array(z.enum(ALL_SCOPES as [string, ...string[]])).min(1, "at least one scope is required"),
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
    scopes: row.scopes as ApiKeyScope[],
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

interface BotHandlerDeps {
  botApiKeyService: BotApiKeyService
  pool: Pool
}

export function createBotHandlers({ botApiKeyService, pool }: BotHandlerDeps) {
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

      const { name, slug, description, avatarEmoji } = result.data

      const bot = await withTransaction(pool, async (client) => {
        const created = await BotRepository.create(client, {
          id: botId(),
          workspaceId,
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

      res.status(201).json({ data: serializeBot(bot) })
    },

    /** PATCH /api/workspaces/:workspaceId/bots/:botId */
    async update(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const { botId: id } = req.params

      const result = updateBotSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const bot = await withTransaction(pool, async (client) => {
        const updated = await BotRepository.update(client, id, workspaceId, result.data)
        if (!updated) {
          throw new HttpError("Bot not found", { status: 404, code: "NOT_FOUND" })
        }

        await OutboxRepository.insert(client, "bot:updated", {
          workspaceId,
          bot: serializeBot(updated),
        })

        return updated
      })

      res.json({ data: serializeBot(bot) })
    },

    /** GET /api/workspaces/:workspaceId/bots */
    async list(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const bots = await BotRepository.listByWorkspace(pool, workspaceId)
      res.json({ data: bots.map(serializeBot) })
    },

    /** GET /api/workspaces/:workspaceId/bots/:botId */
    async get(req: Request, res: Response) {
      const { botId: id } = req.params
      const bot = await BotRepository.findById(pool, id)
      if (!bot || bot.workspaceId !== req.workspaceId!) {
        throw new HttpError("Bot not found", { status: 404, code: "NOT_FOUND" })
      }
      res.json({ data: serializeBot(bot) })
    },

    /** POST /api/workspaces/:workspaceId/bots/:botId/archive */
    async archive(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const { botId: id } = req.params

      const bot = await withTransaction(pool, async (client) => {
        const archived = await BotRepository.archive(client, id, workspaceId)
        if (!archived) {
          throw new HttpError("Bot not found or already archived", { status: 404, code: "NOT_FOUND" })
        }

        // Revoke all active keys on archive
        await BotApiKeyRepository.revokeAllByBot(client, workspaceId, id)

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

      const bot = await withTransaction(pool, async (client) => {
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

      res.json({ data: serializeBot(bot) })
    },

    // --- Bot API key management ---

    /** GET /api/workspaces/:workspaceId/bots/:botId/keys */
    async listKeys(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const { botId: id } = req.params
      const keys = await botApiKeyService.listKeys(workspaceId, id)
      res.json({ data: keys.map(serializeBotKey) })
    },

    /** POST /api/workspaces/:workspaceId/bots/:botId/keys */
    async createKey(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const { botId: id } = req.params

      // Verify bot exists and is active
      const bot = await BotRepository.findById(pool, id)
      if (!bot || bot.workspaceId !== workspaceId || bot.archivedAt) {
        throw new HttpError("Bot not found or archived", { status: 404, code: "NOT_FOUND" })
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
        scopes: result.data.scopes as ApiKeyScope[],
        expiresAt: result.data.expiresAt ? new Date(result.data.expiresAt) : null,
      })

      res.status(201).json({ key: serializeBotKey(row), value })
    },

    /** POST /api/workspaces/:workspaceId/bots/:botId/keys/:keyId/revoke */
    async revokeKey(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const { botId: id, keyId } = req.params
      await botApiKeyService.revokeKey(workspaceId, id, keyId)
      res.status(204).send()
    },
  }
}
