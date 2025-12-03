import type { RequestHandler } from "express"
import { Pool } from "pg"
import { PersonaService, type CreatePersonaInput, type UpdatePersonaInput } from "../services/persona-service"
import { logger } from "../lib/logger"
import { publishOutboxEvent, OutboxEventType } from "../lib/outbox-events"

export interface PersonaDeps {
  pool: Pool
}

export function createPersonaHandlers({ pool }: PersonaDeps) {
  const personaService = new PersonaService(pool)

  const listPersonas: RequestHandler = async (req, res, next) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const personas = await personaService.listPersonas(workspaceId)
      res.json({ personas })
    } catch (error) {
      next(error)
    }
  }

  const getPersona: RequestHandler = async (req, res, next) => {
    try {
      const { workspaceId, personaId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const persona = await personaService.getPersona(personaId)

      if (!persona) {
        res.status(404).json({ error: "Persona not found" })
        return
      }

      if (persona.workspaceId !== workspaceId) {
        res.status(403).json({ error: "Access denied" })
        return
      }

      res.json({ persona })
    } catch (error) {
      next(error)
    }
  }

  const createPersona: RequestHandler = async (req, res, next) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
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
        res.status(400).json({ error: "name is required" })
        return
      }

      if (!slug || typeof slug !== "string") {
        res.status(400).json({ error: "slug is required" })
        return
      }

      if (!description || typeof description !== "string") {
        res.status(400).json({ error: "description is required" })
        return
      }

      if (!systemPrompt || typeof systemPrompt !== "string") {
        res.status(400).json({ error: "systemPrompt is required" })
        return
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

      res.status(201).json({ persona })
    } catch (error: any) {
      if (error.code === "23505") {
        res.status(409).json({ error: "A persona with this slug already exists" })
        return
      }
      next(error)
    }
  }

  const updatePersona: RequestHandler = async (req, res, next) => {
    try {
      const { workspaceId, personaId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const existing = await personaService.getPersona(personaId)
      if (!existing) {
        res.status(404).json({ error: "Persona not found" })
        return
      }
      if (existing.workspaceId !== workspaceId) {
        res.status(403).json({ error: "Access denied" })
        return
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
        res.status(404).json({ error: "Persona not found" })
        return
      }

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

      res.json({ persona })
    } catch (error: any) {
      if (error.code === "23505") {
        res.status(409).json({ error: "A persona with this slug already exists" })
        return
      }
      next(error)
    }
  }

  const deletePersona: RequestHandler = async (req, res, next) => {
    try {
      const { workspaceId, personaId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const existing = await personaService.getPersona(personaId)
      if (!existing) {
        res.status(404).json({ error: "Persona not found" })
        return
      }
      if (existing.workspaceId !== workspaceId) {
        res.status(403).json({ error: "Access denied" })
        return
      }

      const deleted = await personaService.deletePersona(personaId)

      if (!deleted) {
        res.status(400).json({ error: "Cannot delete the default persona" })
        return
      }

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

      res.status(204).send()
    } catch (error) {
      next(error)
    }
  }

  return { listPersonas, getPersona, createPersona, updatePersona, deletePersona }
}
