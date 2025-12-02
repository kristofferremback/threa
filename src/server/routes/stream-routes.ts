import { Router, Request, Response, NextFunction } from "express"
import { StreamService, CreateStreamParams, CreateEventParams } from "../services/stream-service"
import { WorkspaceService } from "../services/workspace-service"
import { UserService } from "../services/user-service"
import { SearchService } from "../services/search-service"
import { AgentSessionService } from "../services/agent-session-service"
import { logger } from "../lib/logger"
import { createValidSlug } from "../../shared/slug"
import { Pool } from "pg"

// Extend Express Request to include user
declare module "express-serve-static-core" {
  interface Request {
    user?: { id: string; email: string; firstName?: string; lastName?: string }
  }
}

export function createStreamRoutes(
  streamService: StreamService,
  workspaceService: WorkspaceService,
  pool: Pool,
): Router {
  const router = Router()
  const userService = new UserService(pool)
  const searchService = new SearchService(pool)
  const sessionService = new AgentSessionService(pool)

  // Helper to ensure user exists in database
  async function ensureUserExists(req: Request): Promise<void> {
    if (!req.user) return
    await userService.ensureUser({
      id: req.user.id,
      email: req.user.email,
      firstName: req.user.firstName || null,
      lastName: req.user.lastName || null,
    })
  }

  // ==========================================================================
  // Workspace Creation
  // ==========================================================================

  router.post("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      // Ensure user exists in database
      await ensureUserExists(req)

      const { name } = req.body

      if (!name || typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({ error: "Workspace name is required" })
        return
      }

      // Create workspace
      const workspace = await workspaceService.createWorkspace(name.trim(), userId)

      // Add creator as owner
      await workspaceService.ensureWorkspaceMember(workspace.id, userId, "owner")

      // Create default #general stream (channel)
      const generalSlug = "general"
      await streamService.createStream({
        workspaceId: workspace.id,
        streamType: "channel",
        creatorId: userId,
        name: "General",
        slug: generalSlug,
        description: "General discussion",
        visibility: "public",
      })

      res.status(201).json(workspace)
    } catch (error) {
      logger.error({ err: error }, "Failed to create workspace")
      next(error)
    }
  })

  // ==========================================================================
  // Bootstrap
  // ==========================================================================

  // Special route: Get default workspace for user
  router.get("/default/bootstrap", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      // Ensure user exists in database
      await ensureUserExists(req)

      // Get user's first workspace
      const memberResult = await pool.query(
        "SELECT workspace_id FROM workspace_members WHERE user_id = $1 AND status = 'active' LIMIT 1",
        [userId],
      )

      if (memberResult.rows.length === 0) {
        res.status(404).json({ error: "No workspace found" })
        return
      }

      const workspaceId = memberResult.rows[0].workspace_id
      const data = await streamService.bootstrap(workspaceId, userId)
      res.json(data)
    } catch (error) {
      logger.error({ err: error }, "Default bootstrap failed")
      next(error)
    }
  })

  router.get("/:workspaceId/bootstrap", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      // Ensure user exists in database
      await ensureUserExists(req)

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

  // Check if slug is available - MUST be before /:streamId route
  router.get("/:workspaceId/streams/check-slug", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId } = req.params
      const { slug, name, excludeId } = req.query

      if (!slug && !name) {
        res.status(400).json({ error: "Either slug or name is required" })
        return
      }

      // createValidSlug returns {slug, valid, error} - extract just the slug
      const slugToCheck = (slug as string) || createValidSlug(name as string).slug
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
  // Search
  // ==========================================================================

  router.get("/:workspaceId/search", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const query = (req.query.query as string) || ""
      const limit = parseInt(req.query.limit as string, 10) || 20
      const offset = parseInt(req.query.offset as string, 10) || 0

      if (!query.trim()) {
        res.json({ results: [], total: 0, parsedQuery: { filters: {}, freeText: "" } })
        return
      }

      const results = await searchService.search(workspaceId, query, {
        limit,
        offset,
        searchMessages: true,
        searchKnowledge: true,
      })

      res.json(results)
    } catch (error) {
      logger.error({ err: error }, "Failed to search")
      next(error)
    }
  })

  // Get discoverable streams (public channels user can join)
  router.get("/:workspaceId/streams/browse", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const streams = await streamService.getDiscoverableStreams(workspaceId, userId)
      res.json({ streams })
    } catch (error) {
      logger.error({ err: error }, "Failed to get discoverable streams")
      next(error)
    }
  })

  // Get a single stream (by ID or slug)
  // Returns stream with thread context (parentStream, rootEvent, ancestors) for threads
  router.get("/:workspaceId/streams/:streamId", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId, streamId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      // Try to get stream by ID first, then by slug
      let stream = await streamService.getStream(streamId)
      if (!stream) {
        stream = await streamService.getStreamBySlug(workspaceId, streamId)
      }

      if (!stream) {
        res.status(404).json({ error: "Stream not found" })
        return
      }

      // Check access using the resolved stream ID
      const access = await streamService.checkStreamAccess(stream.id, userId)
      if (!access.hasAccess) {
        res.status(403).json({ error: access.reason || "Access denied" })
        return
      }

      // Build response with thread context
      const response: {
        stream: typeof stream
        parentStream?: typeof stream
        rootEvent?: ReturnType<typeof mapEventToResponse>
        ancestors?: ReturnType<typeof mapEventToResponse>[]
      } = { stream }

      // For threads, include parent stream and root event
      if (stream.streamType === "thread") {
        // Get parent stream
        if (stream.parentStreamId) {
          const parent = await streamService.getStream(stream.parentStreamId)
          if (parent) {
            response.parentStream = parent
          }
        }

        // Get root event (the message this thread branched from)
        if (stream.branchedFromEventId) {
          const rootEvent = await streamService.getEventWithDetails(stream.branchedFromEventId)
          if (rootEvent) {
            response.rootEvent = mapEventToResponse(rootEvent)
          }
        }

        // Get ancestor events (for deep thread navigation)
        const { ancestors } = await streamService.getAncestorChain(stream.id)
        if (ancestors.length > 0) {
          response.ancestors = ancestors.map(mapEventToResponse)
        }
      }

      res.json(response)
    } catch (error) {
      logger.error({ err: error }, "Failed to get stream")
      next(error)
    }
  })

  // Get ancestor chain for a thread
  router.get("/:workspaceId/streams/:streamId/ancestors", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId, streamId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      // Try to get stream by ID first, then by slug
      let stream = await streamService.getStream(streamId)
      if (!stream) {
        stream = await streamService.getStreamBySlug(workspaceId, streamId)
      }

      if (!stream) {
        res.status(404).json({ error: "Stream not found" })
        return
      }

      // Check access using the resolved stream ID
      const access = await streamService.checkStreamAccess(stream.id, userId)
      if (!access.hasAccess) {
        res.status(403).json({ error: access.reason || "Access denied" })
        return
      }

      const { ancestors, rootStream } = await streamService.getAncestorChain(stream.id)

      res.json({
        ancestors: ancestors.map((e) => mapEventToResponse(e)),
        rootStream,
      })
    } catch (error) {
      logger.error({ err: error }, "Failed to get ancestor chain")
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

      // Ensure user exists in database
      await ensureUserExists(req)

      const { name, description, visibility, streamType, participantIds } = req.body

      const type = streamType || "channel"
      if (!["channel", "dm"].includes(type)) {
        res.status(400).json({ error: "Invalid stream type" })
        return
      }

      // Handle DM creation differently
      if (type === "dm") {
        if (!participantIds || !Array.isArray(participantIds) || participantIds.length === 0) {
          res.status(400).json({ error: "participantIds is required for DMs" })
          return
        }

        const { stream, created } = await streamService.createDM(workspaceId, userId, participantIds)

        res.status(created ? 201 : 200).json({
          ...stream,
          isMember: true,
          unreadCount: 0,
          lastReadAt: new Date().toISOString(),
          notifyLevel: "all",
          created, // Let frontend know if it was newly created
        })
        return
      }

      // Channel creation requires name
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({ error: "Name is required for channels" })
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

  // Create a thinking space
  router.post("/:workspaceId/thinking-spaces", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      await ensureUserExists(req)

      const { name } = req.body

      // Generate a unique slug suffix for thinking spaces
      const uniqueSuffix = Date.now().toString(36)
      const spaceName = name?.trim() || "New thinking space"

      const stream = await streamService.createStream({
        workspaceId,
        streamType: "thinking_space",
        creatorId: userId,
        name: spaceName,
        slug: createValidSlug(spaceName).slug + "-" + uniqueSuffix,
        visibility: "private",
      })

      res.status(201).json({
        ...stream,
        isMember: true,
        unreadCount: 0,
        lastReadAt: new Date().toISOString(),
        notifyLevel: "all",
      })
    } catch (error: any) {
      logger.error({ err: error }, "Failed to create thinking space")
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

  // ==========================================================================
  // Events
  // ==========================================================================

  // Get events for a stream
  router.get("/:workspaceId/streams/:streamId/events", async (req: Request, res: Response, next: NextFunction) => {
    try {
      let { streamId } = req.params
      const userId = req.user?.id
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100)
      const offset = parseInt(req.query.offset as string) || 0

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      // Handle pending thread requests where streamId is actually an event ID
      // The frontend uses event_xxx as the streamId for threads that may not exist yet
      if (streamId.startsWith("event_")) {
        const eventId = streamId
        const existingThread = await streamService.getThreadForEvent(eventId)

        if (existingThread) {
          // Thread exists - use the actual thread's stream ID
          streamId = existingThread.id
        } else {
          // No thread yet - check access to the parent stream and return empty events
          const parentEvent = await streamService.getEventWithDetails(eventId)
          if (!parentEvent) {
            res.status(404).json({ error: "Event not found" })
            return
          }

          const access = await streamService.checkStreamAccess(parentEvent.streamId, userId)
          if (!access.hasAccess) {
            res.status(403).json({ error: access.reason || "Access denied" })
            return
          }

          // Return empty result for the pending thread
          res.json({
            events: [],
            sessions: [],
            lastReadEventId: null,
            hasMore: false,
          })
          return
        }
      }

      // Check access
      const access = await streamService.checkStreamAccess(streamId, userId)
      if (!access.hasAccess) {
        res.status(403).json({ error: access.reason || "Access denied" })
        return
      }

      const events = await streamService.getStreamEvents(streamId, limit, offset)
      const lastReadEventId = await streamService.getReadCursor(streamId, userId)

      // Include agent sessions for this stream
      const sessions = await sessionService.getSessionsForStream(streamId)

      res.json({
        events: events.map((e) => mapEventToResponse(e)),
        sessions: sessions.map((s) => ({
          id: s.id,
          streamId: s.streamId,
          triggeringEventId: s.triggeringEventId,
          responseEventId: s.responseEventId,
          status: s.status,
          steps: s.steps,
          summary: s.summary,
          errorMessage: s.errorMessage,
          startedAt: s.startedAt,
          completedAt: s.completedAt,
        })),
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

      // Ensure user exists in database
      await ensureUserExists(req)

      const { content, mentions, clientMessageId, parentEventId, parentStreamId } = req.body

      // Handle "pending" streamId - this is for creating a thread on a message
      if (streamId === "pending") {
        if (!parentEventId) {
          res.status(400).json({ error: "parentEventId is required for pending threads" })
          return
        }

        // Get the parent event to find its stream
        const parentEvent = await streamService.getEventWithDetails(parentEventId)
        if (!parentEvent) {
          res.status(404).json({ error: "Parent event not found" })
          return
        }

        // Check access to the parent stream
        const access = await streamService.checkStreamAccess(parentEvent.streamId, userId)
        if (!access.canPost) {
          res.status(403).json({ error: access.reason || "You must be a member to reply" })
          return
        }

        // Create the thread and message
        if (!content || typeof content !== "string" || content.trim().length === 0) {
          res.status(400).json({ error: "Content is required" })
          return
        }

        const result = await streamService.replyToEvent({
          workspaceId,
          eventId: parentEventId,
          parentStreamId: parentStreamId || parentEvent.streamId,
          actorId: userId,
          content: content.trim(),
          mentions,
          clientMessageId,
        })

        res.status(201).json({
          event: mapEventToResponse(result.event),
          stream: result.stream,
        })
        return
      }

      // Regular stream - check access
      const access = await streamService.checkStreamAccess(streamId, userId)
      if (!access.canPost) {
        res.status(403).json({ error: access.reason || "You must be a member to post messages" })
        return
      }

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
        clientMessageId,
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

  // Reply to an event (creates thread if needed, then posts message)
  // This is the primary way to start/continue a thread
  router.post(
    "/:workspaceId/streams/:streamId/events/:eventId/reply",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId, streamId, eventId } = req.params
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

        const result = await streamService.replyToEvent({
          workspaceId,
          parentStreamId: streamId,
          eventId,
          actorId: userId,
          content: content.trim(),
          mentions,
        })

        res.status(201).json({
          stream: result.stream,
          event: mapEventToResponse(result.event),
          threadCreated: result.threadCreated,
        })
      } catch (error: any) {
        if (error.message === "Event not found") {
          res.status(404).json({ error: error.message })
          return
        }
        logger.error({ err: error }, "Failed to reply to event")
        next(error)
      }
    },
  )

  // Get thread for an event by eventId only (simpler route for pending thread checks)
  // Returns full thread context including parentStream and ancestors for navigation
  router.get(
    "/:workspaceId/streams/by-event/:eventId/thread",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { workspaceId, eventId } = req.params
        const userId = req.user?.id

        if (!userId) {
          res.status(401).json({ error: "Unauthorized" })
          return
        }

        const thread = await streamService.getThreadForEvent(eventId)

        if (!thread) {
          res.json({ thread: null, rootEvent: null, parentStream: null, ancestors: [] })
          return
        }

        // Build full response with thread context
        const response: {
          thread: typeof thread
          rootEvent: ReturnType<typeof mapEventToResponse> | null
          parentStream: typeof thread | null
          ancestors: ReturnType<typeof mapEventToResponse>[]
        } = { thread, rootEvent: null, parentStream: null, ancestors: [] }

        // Get root event (the message this thread branched from)
        if (thread.branchedFromEventId) {
          const rootEvent = await streamService.getEventWithDetails(thread.branchedFromEventId)
          if (rootEvent) {
            response.rootEvent = mapEventToResponse(rootEvent)
          }
        }

        // Get parent stream
        if (thread.parentStreamId) {
          const parent = await streamService.getStream(thread.parentStreamId)
          if (parent) {
            response.parentStream = parent
          }
        }

        // Get ancestor events (for deep thread navigation breadcrumbs)
        const { ancestors } = await streamService.getAncestorChain(thread.id)
        if (ancestors.length > 0) {
          response.ancestors = ancestors.map(mapEventToResponse)
        }

        res.json(response)
      } catch (error) {
        logger.error({ err: error }, "Failed to get thread by event")
        next(error)
      }
    },
  )

  // Get event details (for pending thread UI)
  router.get("/:workspaceId/events/:eventId", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId, eventId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const event = await streamService.getEventWithDetails(eventId)
      if (!event) {
        res.status(404).json({ error: "Event not found" })
        return
      }

      // Get the stream this event belongs to
      const stream = await streamService.getStream(event.streamId)

      res.json({
        event: mapEventToResponse(event),
        stream,
      })
    } catch (error) {
      logger.error({ err: error }, "Failed to get event")
      next(error)
    }
  })

  // Get thread for an event (returns null if no thread exists yet)
  router.get(
    "/:workspaceId/streams/:streamId/events/:eventId/thread",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { eventId } = req.params
        const userId = req.user?.id

        if (!userId) {
          res.status(401).json({ error: "Unauthorized" })
          return
        }

        const thread = await streamService.getThreadForEvent(eventId)
        res.json({ thread })
      } catch (error) {
        logger.error({ err: error }, "Failed to get thread")
        next(error)
      }
    },
  )

  // Legacy: Create a thread from an event (kept for backwards compatibility)
  // Prefer using POST /events/:eventId/reply instead
  router.post("/:workspaceId/streams/:streamId/thread", async (req: Request, res: Response, next: NextFunction) => {
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

      // Check if thread already exists
      const existingThread = await streamService.getThreadForEvent(eventId)
      if (existingThread) {
        res.status(200).json({ stream: existingThread, event: null })
        return
      }

      // For backwards compat, create thread without a message
      // But this is not the recommended flow
      const { stream, event } = await streamService.createThreadFromEvent(eventId, userId)
      res.status(201).json({ stream, event: event ? mapEventToResponse(event) : null })
    } catch (error: any) {
      if (error.message === "Event not found") {
        res.status(404).json({ error: error.message })
        return
      }
      logger.error({ err: error }, "Failed to create thread")
      next(error)
    }
  })

  // Promote a stream (thread → channel/incident)
  router.post("/:workspaceId/streams/:streamId/promote", async (req: Request, res: Response, next: NextFunction) => {
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
  })

  // Share an event to this stream
  router.post("/:workspaceId/streams/:streamId/share", async (req: Request, res: Response, next: NextFunction) => {
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
  })

  // ==========================================================================
  // Membership
  // ==========================================================================

  // Join a stream (only public channels can be self-joined)
  router.post("/:workspaceId/streams/:streamId/join", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { streamId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      // Check if stream is public (only public channels can be self-joined)
      const existingStream = await streamService.getStream(streamId)
      if (!existingStream) {
        res.status(404).json({ error: "Stream not found" })
        return
      }

      if (existingStream.visibility !== "public") {
        res.status(403).json({ error: "You cannot join private channels without an invite" })
        return
      }

      const { stream, event } = await streamService.joinStream(streamId, userId)

      // Return full stream info so frontend can use it immediately
      res.json({
        success: true,
        stream: {
          ...stream,
          isMember: true,
          unreadCount: 0,
          lastReadAt: new Date().toISOString(),
          notifyLevel: "default",
          pinnedAt: null,
        },
        event: mapEventToResponse(event),
      })
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

  // Pin a stream
  router.post("/:workspaceId/streams/:streamId/pin", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { streamId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      await streamService.pinStream(streamId, userId)
      res.json({ success: true })
    } catch (error) {
      logger.error({ err: error }, "Failed to pin stream")
      next(error)
    }
  })

  // Unpin a stream
  router.post("/:workspaceId/streams/:streamId/unpin", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { streamId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      await streamService.unpinStream(streamId, userId)
      res.json({ success: true })
    } catch (error) {
      logger.error({ err: error }, "Failed to unpin stream")
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

  // ==========================================================================
  // Notifications
  // ==========================================================================

  // Get notification count
  router.get("/:workspaceId/notifications/count", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const count = await streamService.getNotificationCount(workspaceId, userId)
      res.json({ count })
    } catch (error) {
      logger.error({ err: error }, "Failed to get notification count")
      next(error)
    }
  })

  // Get notifications
  router.get("/:workspaceId/notifications", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100)

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const notifications = await streamService.getNotifications(workspaceId, userId, limit)
      res.json({ notifications })
    } catch (error) {
      logger.error({ err: error }, "Failed to get notifications")
      next(error)
    }
  })

  // Mark notification as read
  router.post(
    "/:workspaceId/notifications/:notificationId/read",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { notificationId } = req.params
        const userId = req.user?.id

        if (!userId) {
          res.status(401).json({ error: "Unauthorized" })
          return
        }

        await streamService.markNotificationAsRead(notificationId, userId)
        res.json({ success: true })
      } catch (error) {
        logger.error({ err: error }, "Failed to mark notification as read")
        next(error)
      }
    },
  )

  // Mark all notifications as read
  router.post("/:workspaceId/notifications/read-all", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      await streamService.markAllNotificationsAsRead(workspaceId, userId)
      res.json({ success: true })
    } catch (error) {
      logger.error({ err: error }, "Failed to mark all notifications as read")
      next(error)
    }
  })

  // ==========================================================================
  // Profile Routes
  // ==========================================================================

  // Get current user's profile for this workspace
  router.get("/:workspaceId/profile", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const profile = await workspaceService.getWorkspaceProfile(workspaceId, userId)

      if (!profile) {
        res.status(404).json({ error: "Profile not found" })
        return
      }

      res.json(profile)
    } catch (error) {
      logger.error({ err: error }, "Failed to get profile")
      next(error)
    }
  })

  // Update current user's profile for this workspace
  router.patch("/:workspaceId/profile", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const { displayName, title, avatarUrl } = req.body

      await workspaceService.updateWorkspaceProfile(workspaceId, userId, {
        displayName,
        title,
        avatarUrl,
      })

      const profile = await workspaceService.getWorkspaceProfile(workspaceId, userId)
      res.json(profile)
    } catch (error: any) {
      if (error.message?.includes("managed by SSO")) {
        res.status(403).json({ error: error.message })
        return
      }
      logger.error({ err: error }, "Failed to update profile")
      next(error)
    }
  })

  // ==========================================================================
  // Invitations
  // ==========================================================================

  // Create an invitation
  router.post("/:workspaceId/invitations", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const { email, role } = req.body

      if (!email || typeof email !== "string" || !email.includes("@")) {
        res.status(400).json({ error: "Valid email is required" })
        return
      }

      const validRoles = ["admin", "member", "guest"]
      const inviteRole = validRoles.includes(role) ? role : "member"

      const invitation = await workspaceService.createInvitation(
        workspaceId,
        email.toLowerCase().trim(),
        userId,
        inviteRole,
      )

      res.status(201).json({
        id: invitation.id,
        token: invitation.token,
        expiresAt: invitation.expiresAt,
        inviteUrl: `/invite/${invitation.token}`,
      })
    } catch (error: any) {
      if (error.message?.includes("already a member")) {
        res.status(409).json({ error: error.message })
        return
      }
      if (error.message?.includes("seat limit")) {
        res.status(403).json({ error: error.message })
        return
      }
      logger.error({ err: error }, "Failed to create invitation")
      next(error)
    }
  })

  // Get pending invitations for a workspace
  router.get("/:workspaceId/invitations", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const invitations = await workspaceService.getPendingInvitations(workspaceId)
      res.json({ invitations })
    } catch (error) {
      logger.error({ err: error }, "Failed to get invitations")
      next(error)
    }
  })

  // Revoke an invitation
  router.delete("/:workspaceId/invitations/:invitationId", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { invitationId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      await workspaceService.revokeInvitation(invitationId, userId)
      res.json({ success: true })
    } catch (error: any) {
      if (error.message?.includes("not found")) {
        res.status(404).json({ error: error.message })
        return
      }
      logger.error({ err: error }, "Failed to revoke invitation")
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
    agentId: event.agentId,
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
