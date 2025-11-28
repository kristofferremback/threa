import { tool } from "@langchain/core/tools"
import { z } from "zod"
import { Pool } from "pg"
import { SearchService } from "../../services/search-service"
import { StreamService } from "../../services/stream-service"
import { logger } from "../../lib/logger"

/**
 * Create Ariadne's tools for a specific workspace context.
 */
export function createAriadneTools(pool: Pool, workspaceId: string, currentStreamId?: string) {
  const searchService = new SearchService(pool)
  const streamService = new StreamService(pool)

  const searchMessages = tool(
    async (input) => {
      try {
        const results = await searchService.search(workspaceId, input.query, {
          limit: input.limit || 10,
          searchMessages: true,
          searchKnowledge: false,
        })

        if (results.results.length === 0) {
          return "No messages found matching that query."
        }

        return results.results
          .map((r, i) => {
            const channel = r.streamName ? `#${r.streamName}` : "unknown channel"
            const author = r.actor?.name || "Unknown"
            const date = new Date(r.createdAt).toLocaleDateString()
            return `[${i + 1}] ${author} in ${channel} (${date}):\n${r.content.slice(0, 500)}${r.content.length > 500 ? "..." : ""}`
          })
          .join("\n\n---\n\n")
      } catch (err) {
        logger.error({ err }, "Ariadne: searchMessages tool failed")
        return "Failed to search messages. Please try again."
      }
    },
    {
      name: "search_messages",
      description:
        "Search past messages in the workspace. Use this to find relevant discussions, decisions, or information from conversations. Returns matching messages with author, channel, and date.",
      schema: z.object({
        query: z.string().describe("The search query. Can include filters like 'from:username' or 'in:channel'."),
        limit: z.number().optional().describe("Maximum number of results to return (default: 10)"),
      }),
    },
  )

  const searchKnowledge = tool(
    async (input) => {
      try {
        const results = await searchService.search(workspaceId, input.query, {
          limit: input.limit || 10,
          searchMessages: false,
          searchKnowledge: true,
        })

        if (results.results.length === 0) {
          return "No knowledge articles found matching that query."
        }

        return results.results
          .map((r, i) => {
            const source = r.streamName ? `Source: #${r.streamName}` : ""
            return `[${i + 1}] ${r.content}\n${source}`
          })
          .join("\n\n---\n\n")
      } catch (err) {
        logger.error({ err }, "Ariadne: searchKnowledge tool failed")
        return "Failed to search knowledge base. Please try again."
      }
    },
    {
      name: "search_knowledge",
      description:
        "Search the knowledge base for documented information, how-tos, decisions, and guides. Use this for finding established knowledge rather than recent conversations.",
      schema: z.object({
        query: z.string().describe("The search query for the knowledge base."),
        limit: z.number().optional().describe("Maximum number of results to return (default: 10)"),
      }),
    },
  )

  const getStreamContext = tool(
    async (input) => {
      try {
        const streamId = input.streamId || currentStreamId
        if (!streamId) {
          return "No stream context available."
        }

        const events = await streamService.getStreamEvents(streamId, input.messageCount || 50)

        if (events.length === 0) {
          return "No recent messages in this stream."
        }

        // Get stream info
        const stream = await streamService.getStream(streamId)
        const streamName = stream?.name || stream?.slug || "this conversation"

        return (
          `Recent messages in ${streamName}:\n\n` +
          events
            .reverse() // Show oldest first
            .filter((e) => e.eventType === "message" && e.content)
            .map((e) => {
              const author = e.actorName || e.actorEmail || "Unknown"
              const time = new Date(e.createdAt).toLocaleTimeString()
              return `[${time}] ${author}: ${e.content}`
            })
            .join("\n")
        )
      } catch (err) {
        logger.error({ err }, "Ariadne: getStreamContext tool failed")
        return "Failed to get stream context. Please try again."
      }
    },
    {
      name: "get_stream_context",
      description:
        "Get recent messages from a stream (channel or thread) to understand the current conversation context. Use this to understand what's being discussed before answering.",
      schema: z.object({
        streamId: z.string().optional().describe("The stream ID to get context from. Defaults to the current stream."),
        messageCount: z.number().optional().describe("Number of recent messages to retrieve (default: 50, max: 100)"),
      }),
    },
  )

  const getThreadHistory = tool(
    async (input) => {
      try {
        // Get the thread/stream
        const stream = await streamService.getStream(input.threadId)
        if (!stream) {
          return "Thread not found."
        }

        // Get all events in the thread
        const events = await streamService.getStreamEvents(input.threadId, 200)

        // If it's a thread (has parent), also get the root message
        let rootContext = ""
        if (stream.branchedFromEventId) {
          const rootEvent = await streamService.getEventWithDetails(stream.branchedFromEventId)
          if (rootEvent) {
            const rootAuthor = rootEvent.actorName || rootEvent.actorEmail || "Unknown"
            rootContext = `Thread started from message by ${rootAuthor}:\n"${rootEvent.content}"\n\n---\n\n`
          }
        }

        if (events.length === 0) {
          return rootContext + "No messages in this thread yet."
        }

        return (
          rootContext +
          "Thread messages:\n\n" +
          events
            .reverse()
            .filter((e) => e.eventType === "message" && e.content)
            .map((e) => {
              const author = e.actorName || e.actorEmail || "Unknown"
              const time = new Date(e.createdAt).toLocaleTimeString()
              return `[${time}] ${author}: ${e.content}`
            })
            .join("\n")
        )
      } catch (err) {
        logger.error({ err }, "Ariadne: getThreadHistory tool failed")
        return "Failed to get thread history. Please try again."
      }
    },
    {
      name: "get_thread_history",
      description:
        "Get the full history of a thread, including the original message that started it. Use this when you need complete context of a threaded discussion.",
      schema: z.object({
        threadId: z.string().describe("The thread/stream ID to get history from."),
      }),
    },
  )

  return [searchMessages, searchKnowledge, getStreamContext, getThreadHistory]
}
