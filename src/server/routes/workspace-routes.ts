import { Router, Request, Response, NextFunction } from "express"
import { ChatService } from "../services/chat-service"
import { WorkspaceService } from "../services/workspace-service"
import { logger } from "../lib/logger"
import { Pool } from "pg"
import { createValidSlug } from "../../shared/slug"

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string
        email: string
      }
    }
  }
}

export function createWorkspaceRoutes(
  chatService: ChatService,
  workspaceService: WorkspaceService,
  pool: Pool,
): Router {
  const router = Router()

  // ==========================================================================
  // Create Workspace
  // ==========================================================================
  router.post("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const { name } = req.body

      if (!name || typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({ error: "Workspace name is required" })
        return
      }

      // Create workspace (this also creates the default #general channel)
      const workspace = await workspaceService.createWorkspace(name.trim(), userId)

      // Add creator as admin
      await workspaceService.ensureWorkspaceMember(workspace.id, userId, "admin")

      // Add user to the default channel
      const defaultChannelId = await workspaceService.getOrCreateDefaultChannel(workspace.id)
      await chatService.joinChannel(defaultChannelId, userId)

      res.status(201).json(workspace)
    } catch (error) {
      logger.error({ err: error }, "Failed to create workspace")
      next(error)
    }
  })

  // ==========================================================================
  // Bootstrap - Get everything needed to render the UI
  // ==========================================================================

  // Special route: Get default workspace for user
  router.get("/default/bootstrap", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

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
      const result = await chatService.bootstrap(workspaceId, userId)
      res.json(result)
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

      const result = await chatService.bootstrap(workspaceId, userId)
      res.json(result)
    } catch (error) {
      logger.error({ err: error }, "Bootstrap failed")
      next(error)
    }
  })

  // ==========================================================================
  // Messages
  // ==========================================================================

  // Get message revisions
  router.get("/:workspaceId/messages/:messageId/revisions", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { messageId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const revisions = await chatService.getMessageRevisions(messageId)
      res.json({ revisions })
    } catch (error) {
      logger.error({ err: error }, "Failed to get message revisions")
      next(error)
    }
  })

  // Edit a message
  router.patch("/:workspaceId/messages/:messageId", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { messageId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const { content } = req.body

      if (!content || typeof content !== "string" || content.trim().length === 0) {
        res.status(400).json({ error: "Message content is required" })
        return
      }

      const { message, revisionId } = await chatService.editMessage(messageId, userId, content.trim())

      const email = await chatService.getUserEmail(userId)
      res.json({
        id: message.id,
        userId: message.author_id,
        email: email || "unknown",
        message: message.content,
        timestamp: message.created_at.toISOString(),
        channelId: message.channel_id,
        conversationId: message.conversation_id,
        replyToMessageId: message.reply_to_message_id,
        isEdited: true,
        updatedAt: message.updated_at?.toISOString(),
        revisionId,
      })
    } catch (error: any) {
      if (error.message === "Message not found") {
        res.status(404).json({ error: error.message })
        return
      }
      if (error.message === "You can only edit your own messages") {
        res.status(403).json({ error: error.message })
        return
      }
      logger.error({ err: error }, "Failed to edit message")
      next(error)
    }
  })

  // Send a message (channel message or reply)
  router.post("/:workspaceId/messages", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const { content, channelId, replyToMessageId } = req.body

      if (!content || typeof content !== "string" || content.trim().length === 0) {
        res.status(400).json({ error: "Message content is required" })
        return
      }

      if (!channelId) {
        res.status(400).json({ error: "Channel ID is required" })
        return
      }

      // Resolve slug to channel ID if needed
      let targetChannelId = channelId
      if (!channelId.startsWith("chan_")) {
        const channel = await chatService.getChannelBySlug(workspaceId, channelId)
        if (!channel) {
          res.status(404).json({ error: `Channel "${channelId}" not found` })
          return
        }
        targetChannelId = channel.id
      }

      let conversationId: string | null = null

      // If replying to a message, handle conversation creation/lookup
      if (replyToMessageId) {
        const targetMessage = await chatService.getMessageById(replyToMessageId)

        if (!targetMessage) {
          res.status(404).json({ error: "Reply target message not found" })
          return
        }

        // Check if there's already a conversation where this message is the ROOT
        const existingConversation = await chatService.getConversationByRootMessage(replyToMessageId)

        if (existingConversation) {
          // A conversation already exists with this message as root, add to it
          conversationId = existingConversation.id
        } else {
          // No conversation exists yet - create one branching from this message
          const conversation = await chatService.createConversation(workspaceId, replyToMessageId, targetChannelId, [])
          conversationId = conversation.id

          // Auto-follow the conversation for the replier
          await chatService.followConversation(conversationId, userId)
        }
      }

      // Persist message to PostgreSQL (creates outbox event for real-time push)
      const message = await chatService.createMessage({
        workspaceId,
        channelId: targetChannelId,
        authorId: userId,
        content: content.trim(),
        conversationId,
        replyToMessageId: replyToMessageId || null,
      })

      // Return the created message with author info
      const email = await chatService.getUserEmail(userId)
      res.status(201).json({
        id: message.id,
        userId: message.author_id,
        email: email || "unknown",
        message: message.content,
        timestamp: message.created_at.toISOString(),
        channelId: message.channel_id,
        conversationId: message.conversation_id,
        replyToMessageId: message.reply_to_message_id,
      })
    } catch (error) {
      logger.error({ err: error }, "Failed to send message")
      next(error)
    }
  })

  // ==========================================================================
  // Channels
  // ==========================================================================

  // Check if a channel slug exists (for UI validation)
  router.get("/:workspaceId/channels/check-slug", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id
      const name = req.query.name as string

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      if (!name || typeof name !== "string") {
        res.status(400).json({ error: "Name is required" })
        return
      }

      // Generate and validate slug from name
      const { slug, valid, error } = createValidSlug(name)

      // If the slug is invalid, return that info
      if (!valid) {
        res.json({
          exists: false,
          slug,
          slugValid: false,
          slugError: error,
        })
        return
      }

      const result = await chatService.checkChannelSlugExists(workspaceId, slug, userId)
      res.json({
        ...result,
        slug,
        slugValid: true,
      })
    } catch (error) {
      logger.error({ err: error }, "Failed to check channel slug")
      next(error)
    }
  })

  // Create a channel
  router.post("/:workspaceId/channels", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const { name, description, visibility } = req.body

      if (!name || typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({ error: "Channel name is required" })
        return
      }

      const channel = await chatService.createChannel(workspaceId, name.trim(), userId, {
        description: description?.trim() || undefined,
        visibility: visibility === "private" ? "private" : "public",
      })

      res.status(201).json(channel)
    } catch (error: any) {
      if (error.message?.includes("already exists")) {
        res.status(409).json({ error: error.message })
        return
      }
      // Handle PostgreSQL unique constraint violation (code 23505)
      if (error.code === "23505" && error.constraint === "channels_workspace_id_slug_key") {
        res.status(409).json({ error: "A channel with this name already exists (it may be archived)" })
        return
      }
      logger.error({ err: error }, "Failed to create channel")
      next(error)
    }
  })

  // Update a channel
  router.patch("/:workspaceId/channels/:channelId", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId, channelId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const { name, topic, description } = req.body

      // Resolve slug to channel ID if needed
      let targetChannelId = channelId
      if (!channelId.startsWith("chan_")) {
        const channel = await chatService.getChannelBySlug(workspaceId, channelId)
        if (!channel) {
          res.status(404).json({ error: `Channel "${channelId}" not found` })
          return
        }
        targetChannelId = channel.id
      }

      const channel = await chatService.updateChannel(targetChannelId, { name, topic, description })
      res.json(channel)
    } catch (error: any) {
      if (error.message?.includes("already exists")) {
        res.status(409).json({ error: error.message })
        return
      }
      if (error.message?.includes("not found")) {
        res.status(404).json({ error: error.message })
        return
      }
      logger.error({ err: error }, "Failed to update channel")
      next(error)
    }
  })

  // Archive a channel
  router.delete("/:workspaceId/channels/:channelId", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId, channelId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      // Resolve slug to channel ID if needed
      let targetChannelId = channelId
      if (!channelId.startsWith("chan_")) {
        const channel = await chatService.getChannelBySlug(workspaceId, channelId)
        if (!channel) {
          res.status(404).json({ error: `Channel "${channelId}" not found` })
          return
        }
        targetChannelId = channel.id
      }

      await chatService.archiveChannel(targetChannelId)
      res.json({ success: true })
    } catch (error: any) {
      if (error.message?.includes("not found")) {
        res.status(404).json({ error: error.message })
        return
      }
      logger.error({ err: error }, "Failed to archive channel")
      next(error)
    }
  })

  // Get messages for a channel
  router.get("/:workspaceId/channels/:channelId/messages", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId, channelId } = req.params
      const limit = parseInt(req.query.limit as string) || 50
      const offset = parseInt(req.query.offset as string) || 0

      // Resolve slug to channel ID if needed
      let targetChannelId = channelId
      if (!channelId.startsWith("chan_")) {
        const channel = await chatService.getChannelBySlug(workspaceId, channelId)
        if (!channel) {
          res.status(404).json({ error: `Channel "${channelId}" not found` })
          return
        }
        targetChannelId = channel.id
      }

      const messages = await chatService.getMessagesWithAuthors(targetChannelId, limit, offset)
      res.json({ messages })
    } catch (error) {
      logger.error({ err: error }, "Failed to get channel messages")
      next(error)
    }
  })

  // Mark messages as read in a channel
  router.post("/:workspaceId/channels/:channelId/read", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId, channelId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const { messageId } = req.body

      if (!messageId) {
        res.status(400).json({ error: "Message ID is required" })
        return
      }

      // Resolve slug to channel ID if needed
      let targetChannelId = channelId
      if (!channelId.startsWith("chan_")) {
        const channel = await chatService.getChannelBySlug(workspaceId, channelId)
        if (!channel) {
          res.status(404).json({ error: `Channel "${channelId}" not found` })
          return
        }
        targetChannelId = channel.id
      }

      await chatService.updateChannelReadCursor(targetChannelId, userId, messageId)
      res.json({ success: true })
    } catch (error) {
      logger.error({ err: error }, "Failed to mark channel messages as read")
      next(error)
    }
  })

  // Mark a message as unread in a channel
  router.post("/:workspaceId/channels/:channelId/unread", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { workspaceId, channelId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const { messageId } = req.body

      if (!messageId) {
        res.status(400).json({ error: "Message ID is required" })
        return
      }

      // Resolve slug to channel ID if needed
      let targetChannelId = channelId
      if (!channelId.startsWith("chan_")) {
        const channel = await chatService.getChannelBySlug(workspaceId, channelId)
        if (!channel) {
          res.status(404).json({ error: `Channel "${channelId}" not found` })
          return
        }
        targetChannelId = channel.id
      }

      await chatService.markMessageAsUnread(targetChannelId, userId, messageId)
      res.json({ success: true })
    } catch (error) {
      logger.error({ err: error }, "Failed to mark message as unread")
      next(error)
    }
  })

  // Join a channel
  router.post("/:workspaceId/channels/:channelId/join", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { channelId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      await chatService.joinChannel(channelId, userId)
      res.json({ success: true })
    } catch (error) {
      logger.error({ err: error }, "Failed to join channel")
      next(error)
    }
  })

  // Leave a channel
  router.post("/:workspaceId/channels/:channelId/leave", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { channelId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      await chatService.leaveChannel(channelId, userId)
      res.json({ success: true })
    } catch (error) {
      logger.error({ err: error }, "Failed to leave channel")
      next(error)
    }
  })

  // ==========================================================================
  // Conversations (Threads)
  // ==========================================================================

  // Get messages for a conversation/thread
  router.get(
    "/:workspaceId/conversations/:conversationId/messages",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { conversationId } = req.params

        const messages = await chatService.getMessagesByConversation(conversationId)
        res.json({ messages })
      } catch (error) {
        logger.error({ err: error }, "Failed to get conversation messages")
        next(error)
      }
    },
  )

  // Mark messages as read in a conversation
  router.post(
    "/:workspaceId/conversations/:conversationId/read",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { conversationId } = req.params
        const userId = req.user?.id

        if (!userId) {
          res.status(401).json({ error: "Unauthorized" })
          return
        }

        const { messageId } = req.body

        if (!messageId) {
          res.status(400).json({ error: "Message ID is required" })
          return
        }

        await chatService.updateConversationReadCursor(conversationId, userId, messageId)
        res.json({ success: true })
      } catch (error) {
        logger.error({ err: error }, "Failed to mark conversation messages as read")
        next(error)
      }
    },
  )

  // Mark a message as unread in a conversation
  router.post(
    "/:workspaceId/conversations/:conversationId/unread",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { conversationId } = req.params
        const userId = req.user?.id

        if (!userId) {
          res.status(401).json({ error: "Unauthorized" })
          return
        }

        const { messageId } = req.body

        if (!messageId) {
          res.status(400).json({ error: "Message ID is required" })
          return
        }

        await chatService.markConversationMessageAsUnread(conversationId, userId, messageId)
        res.json({ success: true })
      } catch (error) {
        logger.error({ err: error }, "Failed to mark conversation message as unread")
        next(error)
      }
    },
  )

  // Follow a conversation (watch thread)
  router.post(
    "/:workspaceId/conversations/:conversationId/watch",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { conversationId } = req.params
        const userId = req.user?.id

        if (!userId) {
          res.status(401).json({ error: "Unauthorized" })
          return
        }

        await chatService.followConversation(conversationId, userId)
        res.json({ success: true })
      } catch (error) {
        logger.error({ err: error }, "Failed to follow conversation")
        next(error)
      }
    },
  )

  // Unfollow a conversation (unwatch thread)
  router.post(
    "/:workspaceId/conversations/:conversationId/unwatch",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { conversationId } = req.params
        const userId = req.user?.id

        if (!userId) {
          res.status(401).json({ error: "Unauthorized" })
          return
        }

        await chatService.unfollowConversation(conversationId, userId)
        res.json({ success: true })
      } catch (error) {
        logger.error({ err: error }, "Failed to unfollow conversation")
        next(error)
      }
    },
  )

  // Get thread with ancestors (for thread view)
  router.get("/:workspaceId/threads/:messageId", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { messageId } = req.params

      const [message, ancestors, conversation, rootIsEdited] = await Promise.all([
        chatService.getMessageById(messageId),
        chatService.getMessageAncestors(messageId),
        chatService.getConversationByRootMessage(messageId),
        chatService.hasRevisions(messageId),
      ])

      if (!message) {
        res.status(404).json({ error: "Message not found" })
        return
      }

      const rootEmail = await chatService.getUserEmail(message.author_id)

      let replies: any[] = []
      if (conversation) {
        const conversationMessages = await chatService.getMessagesByConversation(conversation.id)
        replies = await Promise.all(
          conversationMessages
            .filter((r) => r.id !== messageId)
            .map(async (r) => {
              const [email, isEdited] = await Promise.all([
                chatService.getUserEmail(r.author_id),
                chatService.hasRevisions(r.id),
              ])
              return {
                ...r,
                email: email || "unknown",
                isEdited,
              }
            }),
        )
      }

      const ancestorsWithEmail = await Promise.all(
        ancestors.map(async (a) => {
          const [email, isEdited] = await Promise.all([
            chatService.getUserEmail(a.author_id),
            chatService.hasRevisions(a.id),
          ])
          return {
            ...a,
            email: email || "unknown",
            isEdited,
          }
        }),
      )

      res.json({
        rootMessage: {
          ...message,
          email: rootEmail || "unknown",
          isEdited: rootIsEdited,
        },
        ancestors: ancestorsWithEmail,
        replies,
        conversationId: conversation?.id || null,
      })
    } catch (error) {
      logger.error({ err: error }, "Failed to get thread")
      next(error)
    }
  })

  return router
}
