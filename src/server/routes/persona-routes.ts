import { Router } from "express"
import { Pool } from "pg"
import { PersonaService, type CreatePersonaInput, type UpdatePersonaInput } from "../services/persona-service"
import { logger } from "../lib/logger"
import { publishOutboxEvent, OutboxEventType } from "../lib/outbox-events"

export function createPersonaRoutes(pool: Pool): Router {
  const router = Router()
  const personaService = new PersonaService(pool)

  /**
   * GET /api/workspace/:workspaceId/personas
   *
   * List all active personas in the workspace.
   */
  router.get("/:workspaceId/personas", async (req, res, next) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" })
      }

      const personas = await personaService.listPersonas(workspaceId)

      return res.json({ personas })
    } catch (error) {
      next(error)
    }
  })

  /**
   * GET /api/workspace/:workspaceId/personas/:personaId
   *
   * Get a single persona by ID (full details).
   */
  router.get("/:workspaceId/personas/:personaId", async (req, res, next) => {
    try {
      const { workspaceId, personaId } = req.params
      const userId = req.user?.id

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" })
      }

      const persona = await personaService.getPersona(personaId)

      if (!persona) {
        return res.status(404).json({ error: "Persona not found" })
      }

      if (persona.workspaceId !== workspaceId) {
        return res.status(403).json({ error: "Access denied" })
      }

      return res.json({ persona })
    } catch (error) {
      next(error)
    }
  })

  /**
   * POST /api/workspace/:workspaceId/personas
   *
   * Create a new persona.
   * Body:
   * - name: string - Display name
   * - slug: string - @mention identifier
   * - description: string - Short description
   * - avatarEmoji?: string - Avatar emoji
   * - systemPrompt: string - System prompt for the persona
   * - enabledTools?: string[] - Tools to enable (null = all)
   * - model?: string - Model string (e.g., "anthropic:claude-haiku-4-5-20251001")
   * - temperature?: number - Temperature (0-1)
   * - maxTokens?: number - Max tokens
   * - allowedStreamIds?: string[] - Streams where this persona can be used (null = all)
   * - isDefault?: boolean - Whether this is the default persona
   */
  router.post("/:workspaceId/personas", async (req, res, next) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" })
      }

      const {
        name,
        slug,
        description,
        avatarEmoji,
        systemPrompt,
        enabledTools,
        model,
        temperature,
        maxTokens,
        allowedStreamIds,
        isDefault,
      } = req.body

      if (!name || typeof name !== "string") {
        return res.status(400).json({ error: "name is required" })
      }

      if (!slug || typeof slug !== "string") {
        return res.status(400).json({ error: "slug is required" })
      }

      if (!description || typeof description !== "string") {
        return res.status(400).json({ error: "description is required" })
      }

      if (!systemPrompt || typeof systemPrompt !== "string") {
        return res.status(400).json({ error: "systemPrompt is required" })
      }

      const input: CreatePersonaInput = {
        name: name.trim(),
        slug: slug.trim().toLowerCase(),
        description: description.trim(),
        avatarEmoji: avatarEmoji || undefined,
        systemPrompt,
        enabledTools,
        model,
        temperature,
        maxTokens,
        allowedStreamIds,
        isDefault,
      }

      const persona = await personaService.createPersona(workspaceId, userId, input)

      // Publish outbox event for real-time update
      const client = await pool.connect()
      try {
        await client.query("BEGIN")
        await publishOutboxEvent(client, OutboxEventType.PERSONA_CREATED, {
          persona_id: persona.id,
          workspace_id: workspaceId,
          name: persona.name,
          slug: persona.slug,
          is_default: persona.isDefault,
          created_by: userId,
        })
        await client.query("COMMIT")
      } catch (err) {
        await client.query("ROLLBACK")
        logger.error({ err, personaId: persona.id }, "Failed to publish persona created event")
      } finally {
        client.release()
      }

      logger.info({ personaId: persona.id, workspaceId, name: persona.name }, "Persona created")

      return res.status(201).json({ persona })
    } catch (error: any) {
      if (error.code === "23505") {
        return res.status(409).json({ error: "A persona with this slug already exists" })
      }
      next(error)
    }
  })

  /**
   * PATCH /api/workspace/:workspaceId/personas/:personaId
   *
   * Update an existing persona.
   */
  router.patch("/:workspaceId/personas/:personaId", async (req, res, next) => {
    try {
      const { workspaceId, personaId } = req.params
      const userId = req.user?.id

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" })
      }

      // Verify the persona belongs to this workspace
      const existing = await personaService.getPersona(personaId)
      if (!existing) {
        return res.status(404).json({ error: "Persona not found" })
      }
      if (existing.workspaceId !== workspaceId) {
        return res.status(403).json({ error: "Access denied" })
      }

      const {
        name,
        slug,
        description,
        avatarEmoji,
        systemPrompt,
        enabledTools,
        model,
        temperature,
        maxTokens,
        allowedStreamIds,
        isDefault,
        isActive,
      } = req.body

      const input: UpdatePersonaInput = {}

      if (name !== undefined) input.name = name.trim()
      if (slug !== undefined) input.slug = slug.trim().toLowerCase()
      if (description !== undefined) input.description = description.trim()
      if (avatarEmoji !== undefined) input.avatarEmoji = avatarEmoji
      if (systemPrompt !== undefined) input.systemPrompt = systemPrompt
      if (enabledTools !== undefined) input.enabledTools = enabledTools
      if (model !== undefined) input.model = model
      if (temperature !== undefined) input.temperature = temperature
      if (maxTokens !== undefined) input.maxTokens = maxTokens
      if (allowedStreamIds !== undefined) input.allowedStreamIds = allowedStreamIds
      if (isDefault !== undefined) input.isDefault = isDefault
      if (isActive !== undefined) input.isActive = isActive

      const persona = await personaService.updatePersona(personaId, input)

      if (!persona) {
        return res.status(404).json({ error: "Persona not found" })
      }

      // Publish outbox event for real-time update
      const client = await pool.connect()
      try {
        await client.query("BEGIN")
        await publishOutboxEvent(client, OutboxEventType.PERSONA_UPDATED, {
          persona_id: personaId,
          workspace_id: workspaceId,
          name: persona.name,
          slug: persona.slug,
          is_active: persona.isActive,
          is_default: persona.isDefault,
          updated_by: userId,
        })
        await client.query("COMMIT")
      } catch (err) {
        await client.query("ROLLBACK")
        logger.error({ err, personaId }, "Failed to publish persona updated event")
      } finally {
        client.release()
      }

      logger.info({ personaId, workspaceId, updates: Object.keys(input) }, "Persona updated")

      return res.json({ persona })
    } catch (error: any) {
      if (error.code === "23505") {
        return res.status(409).json({ error: "A persona with this slug already exists" })
      }
      next(error)
    }
  })

  /**
   * DELETE /api/workspace/:workspaceId/personas/:personaId
   *
   * Soft-delete a persona (sets is_active = false).
   * Cannot delete the default persona.
   */
  router.delete("/:workspaceId/personas/:personaId", async (req, res, next) => {
    try {
      const { workspaceId, personaId } = req.params
      const userId = req.user?.id

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" })
      }

      // Verify the persona belongs to this workspace
      const existing = await personaService.getPersona(personaId)
      if (!existing) {
        return res.status(404).json({ error: "Persona not found" })
      }
      if (existing.workspaceId !== workspaceId) {
        return res.status(403).json({ error: "Access denied" })
      }

      const deleted = await personaService.deletePersona(personaId)

      if (!deleted) {
        return res.status(400).json({ error: "Cannot delete the default persona" })
      }

      // Publish outbox event for real-time update
      const client = await pool.connect()
      try {
        await client.query("BEGIN")
        await publishOutboxEvent(client, OutboxEventType.PERSONA_DELETED, {
          persona_id: personaId,
          workspace_id: workspaceId,
          deleted_by: userId,
        })
        await client.query("COMMIT")
      } catch (err) {
        await client.query("ROLLBACK")
        logger.error({ err, personaId }, "Failed to publish persona deleted event")
      } finally {
        client.release()
      }

      logger.info({ personaId, workspaceId }, "Persona deleted")

      return res.status(204).send()
    } catch (error) {
      next(error)
    }
  })

  return router
}
