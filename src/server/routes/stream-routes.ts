import { Router, Request, Response, NextFunction } from "express"
import { StreamService, CreateStreamParams, CreateEventParams } from "../services/stream-service"
import { logger } from "../lib/logger"
import { createValidSlug } from "../../shared/slug"

// Extend Express Request to include user
declare module "express-serve-static-core" {
  interface Request {
    user?: { id: string; email: string }
  }
}

export function createStreamRoutes(streamService: StreamService): Router {
  const router = Router()

  // ==========================================================================
  // Bootstrap
  // ==========================================================================

  router.get("/:workspaceId/bootstrap", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const data = await streamService.bootstrap(workspaceId, userId)
      res.json(data)
    } catch (error: any) {
      if (error.message?.includes("not found") || error.message?.includes("not a member")) {
        res.status(403).json({ error: "Access denied" })
        return
      }
      logger.error({ err: error }, "Bootstrap failed")
      next(error)
    }
  })

  // ==========================================================================
  // Stream CRUD
  // ==========================================================================

  // Get a single stream
  router.get("/:workspaceId/streams/:streamId", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { streamId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const stream = await streamService.getStream(streamId)
      if (!stream) {
        res.status(404).json({ error: "Stream not found" })
        return
      }

      res.json(stream)
    } catch (error) {
      logger.error({ err: error }, "Failed to get stream")
      next(error)
    }
  })

  // Create a new stream (channel or DM)
  router.post("/:workspaceId/streams", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const { name, description, visibility, streamType } = req.body

      if (!name || typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({ error: "Name is required" })
        return
      }

      const type = streamType || "channel"
      if (!["channel", "dm"].includes(type)) {
        res.status(400).json({ error: "Invalid stream type" })
        return
      }

      const params: CreateStreamParams = {
        workspaceId,
        streamType: type,
        creatorId: userId,
        name: name.trim(),
        description: description?.trim() || undefined,
        visibility: visibility === "private" ? "private" : "public",
      }

      const stream = await streamService.createStream(params)

      res.status(201).json({
        ...stream,
        isMember: true,
        unreadCount: 0,
        lastReadAt: new Date().toISOString(),
        notifyLevel: "all",
      })
    } catch (error: any) {
      if (error.message?.includes("already exists")) {
        res.status(400).json({ error: error.message })
        return
      }
      logger.error({ err: error }, "Failed to create stream")
      next(error)
    }
  })

  // Update a stream
  router.patch("/:workspaceId/streams/:streamId", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { streamId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      // TODO: Implement update logic
      res.status(501).json({ error: "Not implemented" })
    } catch (error) {
      logger.error({ err: error }, "Failed to update stream")
      next(error)
    }
  })

  // Archive a stream
  router.delete("/:workspaceId/streams/:streamId", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { streamId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      await streamService.archiveStream(streamId)
      res.status(204).send()
    } catch (error) {
      logger.error({ err: error }, "Failed to archive stream")
      next(error)
    }
  })

  // Check if slug is available
  router.get("/:workspaceId/streams/check-slug", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId } = req.params
      const { slug, name, excludeId } = req.query

      if (!slug && !name) {
        res.status(400).json({ error: "Either slug or name is required" })
        return
      }

      const slugToCheck = slug as string || await createValidSlug(name as string)
      const exists = await streamService.checkSlugExists(workspaceId, slugToCheck, excludeId as string)

      res.json({
        slug: slugToCheck,
        available: !exists,
      })
    } catch (error) {
      logger.error({ err: error }, "Failed to check slug")
      next(error)
    }
  })

  // ==========================================================================
  // Events
  // ==========================================================================

  // Get events for a stream
  router.get("/:workspaceId/streams/:streamId/events", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { streamId } = req.params
      const userId = req.user?.id
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100)
      const offset = parseInt(req.query.offset as string) || 0

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const events = await streamService.getStreamEvents(streamId, limit, offset)
      const lastReadEventId = await streamService.getReadCursor(streamId, userId)

      res.json({
        events: events.map((e) => mapEventToResponse(e)),
        lastReadEventId,
        hasMore: events.length === limit,
      })
    } catch (error) {
      logger.error({ err: error }, "Failed to get events")
      next(error)
    }
  })

  // Create an event (post a message)
  router.post("/:workspaceId/streams/:streamId/events", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId, streamId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const { content, mentions } = req.body

      if (!content || typeof content !== "string" || content.trim().length === 0) {
        res.status(400).json({ error: "Content is required" })
        return
      }

      const params: CreateEventParams = {
        streamId,
        actorId: userId,
        eventType: "message",
        content: content.trim(),
        mentions,
      }

      const event = await streamService.createEvent(params)

      res.status(201).json(mapEventToResponse(event))
    } catch (error) {
      logger.error({ err: error }, "Failed to create event")
      next(error)
    }
  })

  // Edit an event
  router.patch(
    "/:workspaceId/streams/:streamId/events/:eventId",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { eventId } = req.params
        const userId = req.user?.id

        if (!userId) {
          res.status(401).json({ error: "Unauthorized" })
          return
        }

        const { content } = req.body

        if (!content || typeof content !== "string" || content.trim().length === 0) {
          res.status(400).json({ error: "Content is required" })
          return
        }

        const event = await streamService.editEvent(eventId, userId, content.trim())
        res.json(mapEventToResponse(event))
      } catch (error: any) {
        if (error.message === "Event not found") {
          res.status(404).json({ error: error.message })
          return
        }
        if (error.message?.includes("your own")) {
          res.status(403).json({ error: error.message })
          return
        }
        logger.error({ err: error }, "Failed to edit event")
        next(error)
      }
    },
  )

  // Delete an event
  router.delete(
    "/:workspaceId/streams/:streamId/events/:eventId",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { eventId } = req.params
        const userId = req.user?.id

        if (!userId) {
          res.status(401).json({ error: "Unauthorized" })
          return
        }

        await streamService.deleteEvent(eventId, userId)
        res.status(204).send()
      } catch (error: any) {
        if (error.message === "Event not found") {
          res.status(404).json({ error: error.message })
          return
        }
        if (error.message?.includes("your own")) {
          res.status(403).json({ error: error.message })
          return
        }
        logger.error({ err: error }, "Failed to delete event")
        next(error)
      }
    },
  )

  // Get event revisions
  router.get(
    "/:workspaceId/streams/:streamId/events/:eventId/revisions",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { eventId } = req.params
        const userId = req.user?.id

        if (!userId) {
          res.status(401).json({ error: "Unauthorized" })
          return
        }

        // TODO: Implement revisions
        res.json({ revisions: [] })
      } catch (error) {
        logger.error({ err: error }, "Failed to get revisions")
        next(error)
      }
    },
  )

  // ==========================================================================
  // Threads & Sharing
  // ==========================================================================

  // Create a thread from an event
  router.post(
    "/:workspaceId/streams/:streamId/thread",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = req.user?.id

        if (!userId) {
          res.status(401).json({ error: "Unauthorized" })
          return
        }

        const { eventId } = req.body

        if (!eventId) {
          res.status(400).json({ error: "eventId is required" })
          return
        }

        const { stream, event } = await streamService.createThreadFromEvent(eventId, userId)
        res.status(201).json({ stream, event: mapEventToResponse(event) })
      } catch (error: any) {
        if (error.message === "Event not found") {
          res.status(404).json({ error: error.message })
          return
        }
        if (error.message?.includes("already exists")) {
          res.status(400).json({ error: error.message })
          return
        }
        logger.error({ err: error }, "Failed to create thread")
        next(error)
      }
    },
  )

  // Promote a stream (thread → channel/incident)
  router.post(
    "/:workspaceId/streams/:streamId/promote",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { streamId } = req.params
        const userId = req.user?.id

        if (!userId) {
          res.status(401).json({ error: "Unauthorized" })
          return
        }

        const { name, slug, visibility, newType } = req.body

        if (!name || typeof name !== "string") {
          res.status(400).json({ error: "Name is required" })
          return
        }

        if (!newType || !["channel", "incident"].includes(newType)) {
          res.status(400).json({ error: "newType must be 'channel' or 'incident'" })
          return
        }

        const stream = await streamService.promoteStream({
          streamId,
          userId,
          newType,
          name: name.trim(),
          slug: slug?.trim(),
          visibility,
        })

        res.json(stream)
      } catch (error: any) {
        if (error.message?.includes("not found")) {
          res.status(404).json({ error: error.message })
          return
        }
        if (error.message?.includes("Only threads") || error.message?.includes("already exists")) {
          res.status(400).json({ error: error.message })
          return
        }
        logger.error({ err: error }, "Failed to promote stream")
        next(error)
      }
    },
  )

  // Share an event to this stream
  router.post(
    "/:workspaceId/streams/:streamId/share",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { streamId } = req.params
        const userId = req.user?.id

        if (!userId) {
          res.status(401).json({ error: "Unauthorized" })
          return
        }

        const { eventId, context } = req.body

        if (!eventId) {
          res.status(400).json({ error: "eventId is required" })
          return
        }

        const params: CreateEventParams = {
          streamId,
          actorId: userId,
          eventType: "shared",
          originalEventId: eventId,
          shareContext: context,
        }

        const event = await streamService.createEvent(params)
        res.status(201).json(mapEventToResponse(event))
      } catch (error) {
        logger.error({ err: error }, "Failed to share event")
        next(error)
      }
    },
  )

  // ==========================================================================
  // Membership
  // ==========================================================================

  // Join a stream
  router.post("/:workspaceId/streams/:streamId/join", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { streamId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      await streamService.joinStream(streamId, userId)
      res.json({ success: true })
    } catch (error) {
      logger.error({ err: error }, "Failed to join stream")
      next(error)
    }
  })

  // Leave a stream
  router.post("/:workspaceId/streams/:streamId/leave", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { streamId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      await streamService.leaveStream(streamId, userId)
      res.json({ success: true })
    } catch (error) {
      logger.error({ err: error }, "Failed to leave stream")
      next(error)
    }
  })

  // Get stream members
  router.get("/:workspaceId/streams/:streamId/members", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { streamId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const members = await streamService.getStreamMembers(streamId)
      res.json({ members })
    } catch (error) {
      logger.error({ err: error }, "Failed to get members")
      next(error)
    }
  })

  // Add a member
  router.post("/:workspaceId/streams/:streamId/members", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { streamId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const { userId: targetUserId, role } = req.body

      if (!targetUserId) {
        res.status(400).json({ error: "userId is required" })
        return
      }

      await streamService.addMember(streamId, targetUserId, userId, role || "member")
      res.json({ success: true })
    } catch (error) {
      logger.error({ err: error }, "Failed to add member")
      next(error)
    }
  })

  // Remove a member
  router.delete(
    "/:workspaceId/streams/:streamId/members/:memberId",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { streamId, memberId } = req.params
        const userId = req.user?.id

        if (!userId) {
          res.status(401).json({ error: "Unauthorized" })
          return
        }

        await streamService.removeMember(streamId, memberId, userId)
        res.status(204).send()
      } catch (error) {
        logger.error({ err: error }, "Failed to remove member")
        next(error)
      }
    },
  )

  // ==========================================================================
  // Read State
  // ==========================================================================

  // Mark stream as read
  router.post("/:workspaceId/streams/:streamId/read", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId, streamId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const { eventId } = req.body

      if (!eventId) {
        res.status(400).json({ error: "eventId is required" })
        return
      }

      await streamService.updateReadCursor(streamId, userId, eventId, workspaceId)
      res.json({ success: true })
    } catch (error) {
      logger.error({ err: error }, "Failed to update read cursor")
      next(error)
    }
  })

  // Mark as unread (set cursor to event before the given one)
  router.post("/:workspaceId/streams/:streamId/unread", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId, streamId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const { eventId } = req.body

      if (!eventId) {
        res.status(400).json({ error: "eventId is required" })
        return
      }

      // TODO: Find the event before this one and set cursor there
      // For now, just set to the provided event
      await streamService.updateReadCursor(streamId, userId, eventId, workspaceId)
      res.json({ success: true })
    } catch (error) {
      logger.error({ err: error }, "Failed to mark as unread")
      next(error)
    }
  })

  return router
}

// ==========================================================================
// Response Mapping
// ==========================================================================

function mapEventToResponse(event: any) {
  return {
    id: event.id,
    streamId: event.streamId,
    eventType: event.eventType,
    actorId: event.actorId,
    actorEmail: event.actorEmail,
    actorName: event.actorName,
    content: event.content,
    mentions: event.mentions,
    originalEventId: event.originalEventId,
    shareContext: event.shareContext,
    originalEvent: event.originalEvent ? mapEventToResponse(event.originalEvent) : undefined,
    replyCount: event.replyCount,
    isEdited: event.isEdited,
    createdAt: event.createdAt?.toISOString?.() || event.createdAt,
    editedAt: event.editedAt?.toISOString?.() || event.editedAt,
    payload: event.payload,
  }
}

