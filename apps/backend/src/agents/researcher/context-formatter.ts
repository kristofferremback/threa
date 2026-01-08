import type { PoolClient } from "pg"
import type { Memo } from "../../repositories/memo-repository"
import { UserRepository } from "../../repositories/user-repository"
import { PersonaRepository } from "../../repositories/persona-repository"
import { StreamRepository } from "../../repositories/stream-repository"
import { formatRelativeDate } from "../../lib/temporal"

/**
 * Enriched memo result with source stream info.
 */
export interface EnrichedMemoResult {
  memo: Memo
  distance: number
  sourceStream: {
    id: string
    type: string
    name: string | null
  } | null
}

/**
 * Enriched message result with author and stream info.
 */
export interface EnrichedMessageResult {
  id: string
  streamId: string
  content: string
  authorId: string
  authorType: "user" | "persona"
  authorName: string
  streamName: string
  streamType: string
  createdAt: Date
}

/**
 * Format retrieved memos and messages into a context section for the system prompt.
 *
 * Returns null if no results were found.
 * Otherwise returns a formatted markdown section to inject into the prompt.
 */
export function formatRetrievedContext(memos: EnrichedMemoResult[], messages: EnrichedMessageResult[]): string | null {
  if (memos.length === 0 && messages.length === 0) {
    return null
  }

  const memosSection = memos.length > 0 ? formatMemosSection(memos) : ""
  const messagesSection = messages.length > 0 ? formatMessagesSection(messages) : ""

  return `## Retrieved Knowledge

The following relevant information was found in the workspace:

${memosSection}${messagesSection}Use this knowledge to inform your response. Cite sources when relevant.`
}

function formatMemosSection(memos: EnrichedMemoResult[]): string {
  const memoEntries = memos
    .map(({ memo, sourceStream }) => {
      const location = sourceStream?.name ?? sourceStream?.type ?? "workspace"
      const keyPointsList =
        memo.keyPoints.length > 0 ? `\nKey points:\n${memo.keyPoints.map((kp) => `- ${kp}`).join("\n")}\n` : ""

      return `**${memo.title}** _(from ${location})_

${memo.abstract}
${keyPointsList}`
    })
    .join("\n")

  return `### Memos

${memoEntries}
`
}

function formatMessagesSection(messages: EnrichedMessageResult[]): string {
  const messageEntries = messages
    .map((msg) => {
      const relativeDate = formatRelativeDate(msg.createdAt)
      const author = msg.authorType === "user" ? `@${msg.authorName}` : msg.authorName
      const content = msg.content.replace(/\s+/g, " ").trim()

      return `> **${author}** in _${msg.streamName}_ (${relativeDate}):
> ${content}`
    })
    .join("\n\n")

  return `### Related Messages

${messageEntries}

`
}

/**
 * Raw message search result from the search service.
 */
export interface RawMessageSearchResult {
  id: string
  streamId: string
  content: string
  authorId: string
  authorType: "user" | "persona"
  createdAt: Date
}

/**
 * Enrich raw message search results with author names and stream names.
 * This is a shared utility used by both the Researcher and PersonaAgent search callbacks.
 */
export async function enrichMessageSearchResults(
  client: PoolClient,
  results: RawMessageSearchResult[]
): Promise<EnrichedMessageResult[]> {
  if (results.length === 0) return []

  // Collect unique IDs for batch lookup
  const userIds = new Set<string>()
  const personaIds = new Set<string>()
  const streamIds = new Set<string>()

  for (const r of results) {
    if (r.authorType === "user") {
      userIds.add(r.authorId)
    } else {
      personaIds.add(r.authorId)
    }
    streamIds.add(r.streamId)
  }

  // Batch fetch users, personas, streams
  const [users, personas, streams] = await Promise.all([
    userIds.size > 0 ? UserRepository.findByIds(client, [...userIds]) : Promise.resolve([]),
    personaIds.size > 0 ? PersonaRepository.findByIds(client, [...personaIds]) : Promise.resolve([]),
    StreamRepository.findByIds(client, [...streamIds]),
  ])

  // Build lookup maps
  const userMap = new Map(users.map((u) => [u.id, u]))
  const personaMap = new Map(personas.map((p) => [p.id, p]))
  const streamMap = new Map(streams.map((s) => [s.id, s]))

  // Enrich results
  return results.map((r) => {
    const authorName =
      r.authorType === "user"
        ? (userMap.get(r.authorId)?.name ?? "Unknown")
        : (personaMap.get(r.authorId)?.name ?? "Assistant")

    const stream = streamMap.get(r.streamId)
    const streamName = stream?.displayName ?? stream?.slug ?? stream?.type ?? "Unknown"

    return {
      id: r.id,
      streamId: r.streamId,
      content: r.content,
      authorId: r.authorId,
      authorType: r.authorType,
      authorName,
      streamName,
      streamType: stream?.type ?? "unknown",
      createdAt: r.createdAt,
    }
  })
}
