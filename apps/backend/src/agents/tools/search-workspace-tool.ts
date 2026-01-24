import { DynamicStructuredTool } from "@langchain/core/tools"
import { z } from "zod"
import { STREAM_TYPES } from "@threa/types"
import { logger } from "../../lib/logger"

// Schema for search_messages tool
const SearchMessagesSchema = z.object({
  query: z.string().describe("The search query to find relevant messages in the workspace"),
  stream: z
    .string()
    .optional()
    .describe(
      "Optional: limit search to a specific stream. Can be an ID (stream_xxx), a slug (general), or a prefixed slug (#general)"
    ),
  exact: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, search for exact phrase matches instead of semantic similarity"),
})

export type SearchMessagesInput = z.infer<typeof SearchMessagesSchema>

export interface MessageSearchResult {
  id: string
  content: string
  authorName: string
  streamName: string
  createdAt: string
}

// Schema for search_streams tool
const SearchStreamsSchema = z.object({
  query: z.string().describe("The search query to find streams by name or description"),
  types: z.array(z.enum(STREAM_TYPES)).optional().describe("Filter by stream types"),
})

export type SearchStreamsInput = z.infer<typeof SearchStreamsSchema>

export interface StreamSearchResult {
  id: string
  type: string
  name: string | null
  description: string | null
}

// Schema for search_users tool
const SearchUsersSchema = z.object({
  query: z.string().describe("The search query to find users by slug, name, or email"),
})

export type SearchUsersInput = z.infer<typeof SearchUsersSchema>

export interface UserSearchResult {
  id: string
  name: string
  email: string
}

// Schema for get_stream_messages tool
const GetStreamMessagesSchema = z.object({
  stream: z
    .string()
    .describe(
      "The stream to get messages from. Can be an ID (stream_xxx), a slug (general), or a prefixed slug (#general)"
    ),
  limit: z
    .number()
    .optional()
    .default(10)
    .describe("Maximum number of recent messages to retrieve (default: 10, max: 20)"),
})

export type GetStreamMessagesInput = z.infer<typeof GetStreamMessagesSchema>

export interface StreamMessagesResult {
  id: string
  content: string
  authorName: string
  authorType: string
  createdAt: string
}

/**
 * Callbacks for workspace search tools.
 * These are provided by the PersonaAgent which has access to the session context.
 *
 * Note: The `stream` field in inputs may be an ID, slug, or prefixed slug (#general).
 * The callback implementation is responsible for resolving these to actual stream IDs.
 */
export interface SearchToolsCallbacks {
  searchMessages: (input: SearchMessagesInput) => Promise<MessageSearchResult[]>
  searchStreams: (input: SearchStreamsInput) => Promise<StreamSearchResult[]>
  searchUsers: (input: SearchUsersInput) => Promise<UserSearchResult[]>
  getStreamMessages: (input: GetStreamMessagesInput) => Promise<StreamMessagesResult[]>
}

const MAX_RESULTS = 10

/**
 * Creates a search_messages tool for semantic/exact workspace message search.
 */
export function createSearchMessagesTool(callbacks: SearchToolsCallbacks) {
  return new DynamicStructuredTool({
    name: "search_messages",
    description: `Search for messages in the workspace knowledge base. Use this to find:
- Previous discussions about a topic
- Specific information mentioned in past conversations
- Context about decisions or plans

Set exact=true to find literal phrase matches (useful for error messages, IDs, or quoted text).
Optionally filter by stream using ID (stream_xxx), slug (general), or prefixed slug (#general).`,
    schema: SearchMessagesSchema,
    func: async (input: SearchMessagesInput) => {
      try {
        const results = await callbacks.searchMessages(input)

        if (results.length === 0) {
          return JSON.stringify({
            query: input.query,
            stream: input.stream,
            exact: input.exact,
            results: [],
            message: "No matching messages found",
          })
        }

        logger.debug(
          { query: input.query, stream: input.stream, exact: input.exact, resultCount: results.length },
          "Message search completed"
        )

        return JSON.stringify({
          query: input.query,
          stream: input.stream,
          exact: input.exact,
          results: results.slice(0, MAX_RESULTS).map((r) => ({
            id: r.id,
            content: truncate(r.content, 300),
            author: r.authorName,
            stream: r.streamName,
            date: r.createdAt,
          })),
        })
      } catch (error) {
        logger.error({ error, query: input.query }, "Message search failed")
        return JSON.stringify({
          error: `Search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          query: input.query,
        })
      }
    },
  })
}

/**
 * Creates a search_streams tool to find streams in the workspace.
 */
export function createSearchStreamsTool(callbacks: SearchToolsCallbacks) {
  return new DynamicStructuredTool({
    name: "search_streams",
    description: `Search for streams (channels, scratchpads, DMs) in the workspace. Use this to find:
- Specific channels or conversations
- Where certain topics are discussed
- Related discussions in other streams`,
    schema: SearchStreamsSchema,
    func: async (input: SearchStreamsInput) => {
      try {
        const results = await callbacks.searchStreams(input)

        if (results.length === 0) {
          return JSON.stringify({
            query: input.query,
            types: input.types,
            results: [],
            message: "No matching streams found",
          })
        }

        logger.debug({ query: input.query, types: input.types, resultCount: results.length }, "Stream search completed")

        return JSON.stringify({
          query: input.query,
          types: input.types,
          results: results.slice(0, MAX_RESULTS).map((r) => ({
            id: r.id,
            type: r.type,
            name: r.name ?? "(unnamed)",
            description: r.description ? truncate(r.description, 100) : null,
          })),
        })
      } catch (error) {
        logger.error({ error, query: input.query }, "Stream search failed")
        return JSON.stringify({
          error: `Search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          query: input.query,
        })
      }
    },
  })
}

/**
 * Creates a search_users tool to find users in the workspace.
 */
export function createSearchUsersTool(callbacks: SearchToolsCallbacks) {
  return new DynamicStructuredTool({
    name: "search_users",
    description: `Search for users in the workspace by name or email. Use this to find:
- A specific person
- Who to ask about a topic
- Contact information`,
    schema: SearchUsersSchema,
    func: async (input: SearchUsersInput) => {
      try {
        const results = await callbacks.searchUsers(input)

        if (results.length === 0) {
          return JSON.stringify({
            query: input.query,
            results: [],
            message: "No matching users found",
          })
        }

        logger.debug({ query: input.query, resultCount: results.length }, "User search completed")

        return JSON.stringify({
          query: input.query,
          results: results.slice(0, MAX_RESULTS).map((r) => ({
            id: r.id,
            name: r.name,
            email: r.email,
          })),
        })
      } catch (error) {
        logger.error({ error, query: input.query }, "User search failed")
        return JSON.stringify({
          error: `Search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          query: input.query,
        })
      }
    },
  })
}

const MAX_STREAM_MESSAGES = 20

/**
 * Creates a get_stream_messages tool to retrieve recent messages from a stream.
 */
export function createGetStreamMessagesTool(callbacks: SearchToolsCallbacks) {
  return new DynamicStructuredTool({
    name: "get_stream_messages",
    description: `Get recent messages from a specific stream (channel, scratchpad, DM, or thread). Use this to:
- See what's being discussed in another stream
- Get context from a related conversation
- Check recent activity in a channel

You can reference streams by their ID (stream_xxx), slug (general), or prefixed slug (#general).`,
    schema: GetStreamMessagesSchema,
    func: async (input: GetStreamMessagesInput) => {
      try {
        const limit = Math.min(input.limit ?? 10, MAX_STREAM_MESSAGES)
        const results = await callbacks.getStreamMessages({ ...input, limit })

        if (results.length === 0) {
          return JSON.stringify({
            stream: input.stream,
            messages: [],
            message: "No messages found in this stream (it may be empty or you may not have access)",
          })
        }

        logger.debug({ stream: input.stream, messageCount: results.length }, "Stream messages retrieved")

        return JSON.stringify({
          stream: input.stream,
          messages: results.map((r) => ({
            id: r.id,
            content: truncate(r.content, 500),
            author: r.authorName,
            authorType: r.authorType,
            date: r.createdAt,
          })),
        })
      } catch (error) {
        logger.error({ error, stream: input.stream }, "Get stream messages failed")
        return JSON.stringify({
          error: `Failed to get messages: ${error instanceof Error ? error.message : "Unknown error"}`,
          stream: input.stream,
        })
      }
    },
  })
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 3) + "..."
}
