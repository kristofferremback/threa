import { DynamicStructuredTool } from "@langchain/core/tools"
import { z } from "zod"
import { logger } from "../../lib/logger"

// Schema for search_messages tool
const SearchMessagesSchema = z.object({
  query: z.string().describe("The search query to find relevant messages in the workspace"),
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
  types: z
    .array(z.enum(["scratchpad", "channel", "dm", "thread"]))
    .optional()
    .describe("Filter by stream types"),
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
  query: z.string().describe("The search query to find users by name or email"),
})

export type SearchUsersInput = z.infer<typeof SearchUsersSchema>

export interface UserSearchResult {
  id: string
  name: string
  email: string
}

/**
 * Callbacks for workspace search tools.
 * These are provided by the PersonaAgent which has access to the session context.
 */
export interface SearchToolsCallbacks {
  searchMessages: (input: SearchMessagesInput) => Promise<MessageSearchResult[]>
  searchStreams: (input: SearchStreamsInput) => Promise<StreamSearchResult[]>
  searchUsers: (input: SearchUsersInput) => Promise<UserSearchResult[]>
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
Set exact=true to find literal phrase matches (useful for error messages, IDs, or quoted text).`,
    schema: SearchMessagesSchema,
    func: async (input: SearchMessagesInput) => {
      try {
        const results = await callbacks.searchMessages(input)

        if (results.length === 0) {
          return JSON.stringify({
            query: input.query,
            exact: input.exact,
            results: [],
            message: "No matching messages found",
          })
        }

        logger.debug(
          { query: input.query, exact: input.exact, resultCount: results.length },
          "Message search completed"
        )

        return JSON.stringify({
          query: input.query,
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

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 3) + "..."
}
