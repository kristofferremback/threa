import { z } from "zod"
import { AgentStepTypes, STREAM_TYPES, StreamTypes, type StreamType } from "@threa/types"
import { logger } from "../../../lib/logger"
import { formatParticipantNames, StreamMemberRepository, StreamRepository, type Stream } from "../../streams"
import { UserRepository } from "../../workspaces"
import { MessageRepository } from "../../messaging"
import { PersonaRepository } from "../persona-repository"
import { enrichMessageSearchResults } from "../researcher"
import { resolveStreamIdentifier } from "./identifier-resolver"
import { defineAgentTool, type AgentToolResult } from "../runtime"
import type { WorkspaceToolDeps } from "./tool-deps"

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

const MAX_RESULTS = 10
const MAX_STREAM_MESSAGES = 20

interface DmSearchResult {
  stream: Stream
  displayName: string
  score: number
}

export function createSearchMessagesTool(deps: WorkspaceToolDeps) {
  const { db, workspaceId, accessibleStreamIds, invokingUserId, searchService } = deps

  return defineAgentTool({
    name: "search_messages",
    description: `Search for messages in the workspace knowledge base. Use this to find:
- Previous discussions about a topic
- Specific information mentioned in past conversations
- Context about decisions or plans

Set exact=true to find literal phrase matches (useful for error messages, IDs, or quoted text).
Optionally filter by stream using ID (stream_xxx), slug (general), or prefixed slug (#general).`,
    inputSchema: SearchMessagesSchema,

    execute: async (input): Promise<AgentToolResult> => {
      try {
        let filterStreamIds = accessibleStreamIds
        if (input.stream) {
          const resolved = await resolveStreamIdentifier(db, workspaceId, input.stream, accessibleStreamIds)
          if (!resolved.resolved)
            return {
              output: JSON.stringify({
                query: input.query,
                stream: input.stream,
                exact: input.exact,
                results: [],
                message: "No matching messages found",
              }),
            }
          filterStreamIds = [resolved.id]
        }

        const searchResults = await searchService.search({
          workspaceId,
          userId: invokingUserId,
          query: input.query,
          filters: { streamIds: filterStreamIds },
          limit: 10,
          exact: input.exact,
        })

        const enriched = await enrichMessageSearchResults(db, workspaceId, searchResults)
        const results: MessageSearchResult[] = enriched.map((r) => ({
          id: r.id,
          content: r.content,
          authorName: r.authorName,
          streamName: r.streamName,
          createdAt: r.createdAt.toISOString(),
        }))

        if (results.length === 0) {
          return {
            output: JSON.stringify({
              query: input.query,
              stream: input.stream,
              exact: input.exact,
              results: [],
              message: "No matching messages found",
            }),
          }
        }

        logger.debug(
          { query: input.query, stream: input.stream, exact: input.exact, resultCount: results.length },
          "Message search completed"
        )

        return {
          output: JSON.stringify({
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
          }),
        }
      } catch (error) {
        logger.error({ error, query: input.query }, "Message search failed")
        return {
          output: JSON.stringify({
            error: `Search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            query: input.query,
          }),
        }
      }
    },

    trace: {
      stepType: AgentStepTypes.WORKSPACE_SEARCH,
      formatContent: (input) =>
        JSON.stringify({
          tool: "search_messages",
          query: input.query ?? "",
          stream: input.stream ?? null,
        }),
    },
  })
}

export function createSearchStreamsTool(deps: WorkspaceToolDeps) {
  const { db, workspaceId, accessibleStreamIds, invokingUserId } = deps

  return defineAgentTool({
    name: "search_streams",
    description: `Search for streams (channels, scratchpads, DMs) in the workspace. Use this to find:
- Specific channels or conversations
- Where certain topics are discussed
- Related discussions in other streams`,
    inputSchema: SearchStreamsSchema,

    execute: async (input): Promise<AgentToolResult> => {
      try {
        const [nameMatches, dmSearchResults] = await Promise.all([
          StreamRepository.searchByName(db, {
            streamIds: accessibleStreamIds,
            query: input.query,
            types: input.types,
            limit: MAX_RESULTS,
          }),
          searchDmStreamsByParticipant(db, {
            workspaceId,
            invokingUserId,
            streamIds: accessibleStreamIds,
            query: input.query,
            types: input.types,
            limit: MAX_RESULTS,
          }),
        ])

        const dmDisplayNamesById = new Map(dmSearchResults.map((result) => [result.stream.id, result.displayName]))

        const mergedStreams = [...nameMatches, ...dmSearchResults.map((result) => result.stream)]

        const streams = mergedStreams
          .filter((stream, index, arr) => arr.findIndex((s) => s.id === stream.id) === index)
          .slice(0, MAX_RESULTS)

        const results: StreamSearchResult[] = streams.map((s) => ({
          id: s.id,
          type: s.type,
          name:
            s.type === StreamTypes.DM
              ? (dmDisplayNamesById.get(s.id) ?? s.displayName ?? "(direct message)")
              : (s.displayName ?? s.slug ?? null),
          description: s.description ?? null,
        }))

        if (results.length === 0) {
          return {
            output: JSON.stringify({
              query: input.query,
              types: input.types,
              results: [],
              message: "No matching streams found",
            }),
          }
        }

        logger.debug({ query: input.query, types: input.types, resultCount: results.length }, "Stream search completed")

        return {
          output: JSON.stringify({
            query: input.query,
            types: input.types,
            results: results.slice(0, MAX_RESULTS).map((r) => ({
              id: r.id,
              type: r.type,
              name: r.name ?? "(unnamed)",
              description: r.description ? truncate(r.description, 100) : null,
            })),
          }),
        }
      } catch (error) {
        logger.error({ error, query: input.query }, "Stream search failed")
        return {
          output: JSON.stringify({
            error: `Search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            query: input.query,
          }),
        }
      }
    },

    trace: {
      stepType: AgentStepTypes.WORKSPACE_SEARCH,
      formatContent: (input) => JSON.stringify({ tool: "search_streams", query: input.query ?? "" }),
    },
  })
}

async function searchDmStreamsByParticipant(
  db: WorkspaceToolDeps["db"],
  params: {
    workspaceId: string
    invokingUserId: string
    streamIds: string[]
    query: string
    types?: StreamType[]
    limit: number
  }
): Promise<DmSearchResult[]> {
  const { workspaceId, invokingUserId, streamIds, query, types, limit } = params
  const shouldSearchDms = !types || types.length === 0 || types.includes(StreamTypes.DM)
  if (!shouldSearchDms || streamIds.length === 0) {
    return []
  }

  const candidateStreams = await StreamRepository.findByIds(db, streamIds)
  const dmStreams = candidateStreams.filter((stream) => stream.type === StreamTypes.DM)
  if (dmStreams.length === 0) {
    return []
  }

  const dmStreamIds = dmStreams.map((stream) => stream.id)
  const dmMembers = await StreamMemberRepository.list(db, { streamIds: dmStreamIds })
  const participantUserIds = Array.from(new Set(dmMembers.map((member) => member.memberId)))
  const users = await UserRepository.findByIds(db, workspaceId, participantUserIds)
  const usersById = new Map(users.map((user) => [user.id, user]))
  const membersByStreamId = new Map<string, string[]>()

  for (const member of dmMembers) {
    const currentMembers = membersByStreamId.get(member.streamId) ?? []
    currentMembers.push(member.memberId)
    membersByStreamId.set(member.streamId, currentMembers)
  }

  const queryTerms = extractSearchTerms(query)
  const matches: DmSearchResult[] = []

  for (const dmStream of dmStreams) {
    const memberIds = membersByStreamId.get(dmStream.id) ?? []
    const participants = memberIds
      .map((memberId) => usersById.get(memberId))
      .filter((user): user is NonNullable<typeof user> => user !== undefined)
      .map((user) => ({ id: user.id, name: user.name }))

    const displayName = formatParticipantNames(participants, invokingUserId)
    const otherParticipant = memberIds.find((memberId) => memberId !== invokingUserId)
    const otherParticipantUser = otherParticipant ? usersById.get(otherParticipant) : undefined

    const score = scoreDmMatch({
      queryTerms,
      displayName,
      participantSlug: otherParticipantUser?.slug ?? null,
    })
    if (score === Number.POSITIVE_INFINITY) {
      continue
    }

    matches.push({ stream: dmStream, displayName, score })
  }

  return matches
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score
      return a.displayName.localeCompare(b.displayName)
    })
    .slice(0, limit)
}

function extractSearchTerms(query: string): string[] {
  const lowerQuery = query.trim().toLowerCase()
  if (!lowerQuery) return []

  const terms = new Set<string>([lowerQuery])
  if (lowerQuery.startsWith("@")) {
    terms.add(lowerQuery.slice(1))
  }

  const tokenMatches = lowerQuery.match(/[@]?[a-z0-9][a-z0-9-]*/g) ?? []
  for (const token of tokenMatches) {
    terms.add(token)
    if (token.startsWith("@")) {
      terms.add(token.slice(1))
    }
  }

  return Array.from(terms).filter((term) => term.length > 1)
}

function scoreDmMatch(params: { queryTerms: string[]; displayName: string; participantSlug: string | null }): number {
  const candidates = [params.displayName.toLowerCase()]
  if (params.participantSlug) {
    const slug = params.participantSlug.toLowerCase()
    candidates.push(slug, `@${slug}`)
  }

  let bestScore = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    for (const term of params.queryTerms) {
      if (candidate === term) {
        bestScore = Math.min(bestScore, 0)
      } else if (candidate.startsWith(term)) {
        bestScore = Math.min(bestScore, 1)
      } else if (candidate.includes(term)) {
        bestScore = Math.min(bestScore, 2)
      } else if (term.includes(candidate)) {
        bestScore = Math.min(bestScore, 3)
      }
    }
  }

  return bestScore
}

export function createSearchUsersTool(deps: WorkspaceToolDeps) {
  const { db, workspaceId } = deps

  return defineAgentTool({
    name: "search_users",
    description: `Search for users in the workspace by name or email. Use this to find:
- A specific person
- Who to ask about a topic
- Contact information`,
    inputSchema: SearchUsersSchema,

    execute: async (input): Promise<AgentToolResult> => {
      try {
        const members = await UserRepository.searchByNameOrSlug(db, workspaceId, input.query, 10)
        const results: UserSearchResult[] = members.map((m) => ({ id: m.id, name: m.name, email: m.email }))

        if (results.length === 0) {
          return {
            output: JSON.stringify({
              query: input.query,
              results: [],
              message: "No matching users found",
            }),
          }
        }

        logger.debug({ query: input.query, resultCount: results.length }, "User search completed")

        return {
          output: JSON.stringify({
            query: input.query,
            results: results.slice(0, MAX_RESULTS).map((r) => ({
              id: r.id,
              name: r.name,
              email: r.email,
            })),
          }),
        }
      } catch (error) {
        logger.error({ error, query: input.query }, "User search failed")
        return {
          output: JSON.stringify({
            error: `Search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            query: input.query,
          }),
        }
      }
    },

    trace: {
      stepType: AgentStepTypes.WORKSPACE_SEARCH,
      formatContent: (input) => JSON.stringify({ tool: "search_users", query: input.query ?? "" }),
    },
  })
}

export function createGetStreamMessagesTool(deps: WorkspaceToolDeps) {
  const { db, workspaceId, accessibleStreamIds } = deps

  return defineAgentTool({
    name: "get_stream_messages",
    description: `Get recent messages from a specific stream (channel, scratchpad, DM, or thread). Use this to:
- See what's being discussed in another stream
- Get context from a related conversation
- Check recent activity in a channel

You can reference streams by their ID (stream_xxx), slug (general), or prefixed slug (#general).`,
    inputSchema: GetStreamMessagesSchema,

    execute: async (input): Promise<AgentToolResult> => {
      try {
        const limit = Math.min(input.limit ?? 10, MAX_STREAM_MESSAGES)

        const resolved = await resolveStreamIdentifier(db, workspaceId, input.stream, accessibleStreamIds)
        if (!resolved.resolved) {
          return {
            output: JSON.stringify({
              stream: input.stream,
              messages: [],
              message: "No messages found in this stream (it may be empty or you may not have access)",
            }),
          }
        }

        const messages = await MessageRepository.list(db, resolved.id, { limit })
        messages.reverse()

        const userIds = [...new Set(messages.filter((m) => m.authorType === "user").map((m) => m.authorId))]
        const personaIds = [...new Set(messages.filter((m) => m.authorType === "persona").map((m) => m.authorId))]
        const [members, personas] = await Promise.all([
          userIds.length > 0 ? UserRepository.findByIds(db, workspaceId, userIds) : Promise.resolve([]),
          personaIds.length > 0 ? PersonaRepository.findByIds(db, personaIds) : Promise.resolve([]),
        ])

        const memberMap = new Map(members.map((m) => [m.id, m.name]))
        const personaMap = new Map(personas.map((p) => [p.id, p.name]))

        const results: StreamMessagesResult[] = messages.map((m) => ({
          id: m.id,
          content: m.contentMarkdown,
          authorName:
            m.authorType === "user"
              ? (memberMap.get(m.authorId) ?? "Unknown Member")
              : (personaMap.get(m.authorId) ?? "Unknown Persona"),
          authorType: m.authorType,
          createdAt: m.createdAt.toISOString(),
        }))

        if (results.length === 0) {
          return {
            output: JSON.stringify({
              stream: input.stream,
              messages: [],
              message: "No messages found in this stream (it may be empty or you may not have access)",
            }),
          }
        }

        logger.debug({ stream: input.stream, messageCount: results.length }, "Stream messages retrieved")

        return {
          output: JSON.stringify({
            stream: input.stream,
            messages: results.map((r) => ({
              id: r.id,
              content: truncate(r.content, 500),
              author: r.authorName,
              authorType: r.authorType,
              date: r.createdAt,
            })),
          }),
        }
      } catch (error) {
        logger.error({ error, stream: input.stream }, "Get stream messages failed")
        return {
          output: JSON.stringify({
            error: `Failed to get messages: ${error instanceof Error ? error.message : "Unknown error"}`,
            stream: input.stream,
          }),
        }
      }
    },

    trace: {
      stepType: AgentStepTypes.WORKSPACE_SEARCH,
      formatContent: (input) => JSON.stringify({ tool: "get_stream_messages", stream: input.stream ?? null }),
    },
  })
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 3) + "..."
}
