import { tool } from "@langchain/core/tools"
import { z } from "zod"
import { Pool } from "pg"
import * as cheerio from "cheerio"
import { SearchService, SearchScope } from "../../services/search-service"
import { StreamService } from "../../services/stream-service"
import { MemoService } from "../../services/memo-service"
import { logger } from "../../lib/logger"
import { TAVILY_API_KEY } from "../../config"
import type { Citation } from "./researcher"

/**
 * Accumulator for tracking citations from tool calls.
 * Tools register their sources as they return results, allowing
 * us to build rich citation metadata for the final response.
 */
export class CitationAccumulator {
  private citations: Citation[] = []
  private nextIndex = 1

  /**
   * Register a message citation.
   * Returns the citation index to use in the response (e.g., [1], [2]).
   */
  addMessage(params: {
    id: string
    streamId?: string
    streamName?: string
    author?: string
    date?: string
    preview?: string
  }): number {
    const index = this.nextIndex++
    this.citations.push({
      index,
      type: "message",
      id: params.id,
      streamId: params.streamId,
      streamName: params.streamName,
      author: params.author,
      date: params.date,
      preview: params.preview,
    })
    return index
  }

  /**
   * Register a memo citation.
   */
  addMemo(params: {
    id: string
    streamId?: string
    streamName?: string
    preview?: string
  }): number {
    const index = this.nextIndex++
    this.citations.push({
      index,
      type: "memo",
      id: params.id,
      streamId: params.streamId,
      streamName: params.streamName,
      preview: params.preview,
    })
    return index
  }

  /**
   * Register a web citation.
   */
  addWeb(params: {
    url: string
    title?: string
    preview?: string
  }): number {
    const index = this.nextIndex++
    this.citations.push({
      index,
      type: "web",
      id: params.url,
      author: params.title,
      preview: params.preview,
    })
    return index
  }

  /**
   * Get all accumulated citations.
   */
  getCitations(): Citation[] {
    return [...this.citations]
  }

  /**
   * Clear all citations (useful for reset between invocations).
   */
  clear(): void {
    this.citations = []
    this.nextIndex = 1
  }
}

export interface AriadneToolsContext {
  workspaceId: string
  userId: string
  currentStreamId?: string
  /**
   * Search scope determines information boundaries:
   * - public: Only public streams (invoked from public channel)
   * - private: Current stream + public streams (invoked from private channel)
   * - user: All user-accessible content (invoked from thinking space)
   */
  scope: SearchScope
  /**
   * Optional citation accumulator for tracking sources.
   * When provided, tools will register citations as they return results.
   */
  citationAccumulator?: CitationAccumulator
}

/**
 * Create Ariadne's tools for a specific workspace and user context.
 * The scope controls what information Ariadne can access based on invocation context.
 */
export function createAriadneTools(pool: Pool, context: AriadneToolsContext) {
  const { workspaceId, userId, currentStreamId, scope, citationAccumulator } = context
  const searchService = new SearchService(pool)
  const streamService = new StreamService(pool)
  const memoService = new MemoService(pool)

  const searchMessages = tool(
    async (input) => {
      try {
        // Resolve human-readable names/slugs to IDs
        const userIds: string[] = []
        const withUserIds: string[] = []
        const streamIds: string[] = []

        if (input.fromUsers?.length) {
          const resolved = await searchService.resolveUserNames(workspaceId, input.fromUsers)
          for (const [name, id] of resolved) {
            userIds.push(id)
            logger.debug({ name, id }, "Resolved user name to ID (from)")
          }
          for (const name of input.fromUsers) {
            if (!resolved.has(name)) {
              logger.debug({ name }, "Could not resolve user name (from)")
            }
          }
        }

        if (input.withUsers?.length) {
          const resolved = await searchService.resolveUserNames(workspaceId, input.withUsers)
          for (const [name, id] of resolved) {
            withUserIds.push(id)
            logger.debug({ name, id }, "Resolved user name to ID (with)")
          }
          for (const name of input.withUsers) {
            if (!resolved.has(name)) {
              logger.debug({ name }, "Could not resolve user name (with)")
            }
          }
        }

        if (input.inChannels?.length) {
          const resolved = await searchService.resolveStreamSlugs(workspaceId, input.inChannels)
          for (const [slug, id] of resolved) {
            streamIds.push(id)
            logger.debug({ slug, id }, "Resolved stream slug to ID")
          }
          for (const slug of input.inChannels) {
            if (!resolved.has(slug)) {
              logger.debug({ slug }, "Could not resolve stream slug")
            }
          }
        }

        // Validate stream types
        const validStreamTypes = ["channel", "thread", "thinking_space"] as const
        const streamTypes = input.streamTypes?.filter((t): t is typeof validStreamTypes[number] =>
          validStreamTypes.includes(t as typeof validStreamTypes[number])
        )

        const results = await searchService.search(workspaceId, input.query, {
          limit: input.limit || 10,
          searchMessages: true,
          searchKnowledge: false,
          userId,
          scope, // Context-aware information boundaries
          filters: {
            userIds: userIds.length > 0 ? userIds : undefined,
            withUserIds: withUserIds.length > 0 ? withUserIds : undefined,
            streamIds: streamIds.length > 0 ? streamIds : undefined,
            streamTypes: streamTypes?.length ? streamTypes : undefined,
          },
        })

        if (results.results.length === 0) {
          return "No messages found matching that query."
        }

        return results.results
          .map((r) => {
            const channel = r.streamName ? `#${r.streamName}` : "unknown channel"
            const author = r.actor?.name || "Unknown"
            const date = new Date(r.createdAt).toLocaleDateString()
            const preview = r.content.slice(0, 500) + (r.content.length > 500 ? "..." : "")

            // Register citation if accumulator is provided
            const index = citationAccumulator
              ? citationAccumulator.addMessage({
                  id: r.id,
                  streamId: r.streamId,
                  streamName: r.streamName,
                  author,
                  date,
                  preview: r.content.slice(0, 200),
                })
              : results.results.indexOf(r) + 1

            // Include IDs for navigation: [index|eventId|streamId]
            return `[${index}|${r.id}|${r.streamId}] ${author} in ${channel} (${date}):\n${preview}`
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
        query: z.string().describe("The search query text (semantic search). Leave empty to just filter."),
        fromUsers: z.array(z.string()).optional().describe("Filter by message author names (e.g., ['Kris', 'Stefan'])"),
        withUsers: z.array(z.string()).optional().describe("Filter by conversations where these users participated together (e.g., ['Kris', 'Annica'] finds conversations where both were involved)"),
        inChannels: z.array(z.string()).optional().describe("Filter by channel names/slugs (e.g., ['general', 'engineering'])"),
        streamTypes: z.array(z.string()).optional().describe("Filter by stream type: 'channel', 'thread', or 'thinking_space'"),
        limit: z.number().optional().describe("Maximum number of results to return (default: 10)"),
      }),
    },
  )

  const searchMemos = tool(
    async (input) => {
      try {
        const results = await searchService.search(workspaceId, input.query, {
          limit: input.limit || 10,
          searchMessages: false,
          searchKnowledge: true, // Searches memos (renamed from knowledge)
          userId,
          scope, // Context-aware information boundaries (memos only in "user" scope)
        })

        if (results.results.length === 0) {
          return "No memos found matching that query. Try searching messages instead."
        }

        // Log the retrieval for evolution tracking
        const retrievedMemoIds = results.results.map((r) => r.id)
        await memoService.logRetrieval({
          workspaceId,
          query: input.query,
          requesterType: "ariadne",
          requesterId: userId,
          retrievedMemoIds,
          retrievalScores: Object.fromEntries(results.results.map((r) => [r.id, r.score])),
        }).catch((err) => {
          logger.warn({ err }, "Failed to log memo retrieval")
        })

        return results.results
          .map((r) => {
            const source = r.streamName ? `Source: #${r.streamName}` : ""

            // Register citation if accumulator is provided
            const index = citationAccumulator
              ? citationAccumulator.addMemo({
                  id: r.id,
                  streamId: r.streamId,
                  streamName: r.streamName,
                  preview: r.content.slice(0, 200),
                })
              : results.results.indexOf(r) + 1

            return `[${index}] ${r.content}\n${source}`
          })
          .join("\n\n---\n\n")
      } catch (err) {
        logger.error({ err }, "Ariadne: searchMemos tool failed")
        return "Failed to search memos. Please try again."
      }
    },
    {
      name: "search_memos",
      description:
        "Search memos - lightweight pointers to valuable past conversations and decisions. Memos summarize what knowledge exists and where to find it. Use this FIRST before searching all messages, as memos point to the most relevant discussions. If memo results are helpful, follow up with get_thread_history to read the full context.",
      schema: z.object({
        query: z.string().describe("The search query for memos. Be specific about what information you're looking for."),
        limit: z.number().optional().describe("Maximum number of results to return (default: 10)"),
      }),
    },
  )

  const getStreamContext = tool(
    async (input) => {
      try {
        let streamId = input.stream || currentStreamId
        if (!streamId) {
          return "No stream context available."
        }

        // Resolve slug to ID if needed (stream IDs start with "stream_")
        if (!streamId.startsWith("stream_")) {
          const resolved = await searchService.resolveStreamSlugs(workspaceId, [streamId])
          const resolvedId = resolved.get(streamId)
          if (resolvedId) {
            streamId = resolvedId
          } else {
            return `Could not find channel "${streamId}". Make sure you're using the correct channel name.`
          }
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
        stream: z.string().optional().describe("The channel name (e.g., 'general') or stream ID. Defaults to the current stream."),
        messageCount: z.number().optional().describe("Number of recent messages to retrieve (default: 50, max: 100)"),
      }),
    },
  )

  const getThreadHistory = tool(
    async (input) => {
      try {
        let threadId = input.thread

        // Resolve slug to ID if needed (stream IDs start with "stream_")
        if (threadId && !threadId.startsWith("stream_")) {
          const resolved = await searchService.resolveStreamSlugs(workspaceId, [threadId])
          const resolvedId = resolved.get(threadId)
          if (resolvedId) {
            threadId = resolvedId
          } else {
            return `Could not find thread or channel "${threadId}". Make sure you're using the correct name.`
          }
        }

        // Get the thread/stream
        const stream = await streamService.getStream(threadId)
        if (!stream) {
          return "Thread not found."
        }

        // Get all events in the thread
        const events = await streamService.getStreamEvents(threadId, 200)

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
        thread: z.string().describe("The channel name (e.g., 'general') or thread/stream ID to get history from."),
      }),
    },
  )

  const webSearch = tool(
    async (input) => {
      if (!TAVILY_API_KEY) {
        return "Web search is not configured. Please ask your workspace admin to set up the TAVILY_API_KEY."
      }

      try {
        const response = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            api_key: TAVILY_API_KEY,
            query: input.query,
            search_depth: input.deepSearch ? "advanced" : "basic",
            include_answer: true,
            include_raw_content: false,
            max_results: input.maxResults || 5,
          }),
        })

        if (!response.ok) {
          const errorText = await response.text()
          logger.error({ status: response.status, error: errorText }, "Tavily API error")
          return "Web search failed. Please try again."
        }

        const data = (await response.json()) as {
          answer?: string
          results: Array<{
            title: string
            url: string
            content: string
            score: number
          }>
        }

        // Format results
        let output = ""

        if (data.answer) {
          output += `**Summary:** ${data.answer}\n\n---\n\n`
        }

        if (data.results.length === 0) {
          return output + "No relevant web results found."
        }

        output += "**Sources:**\n\n"
        output += data.results
          .map((r) => {
            const snippet = r.content.length > 400 ? r.content.slice(0, 400) + "..." : r.content

            // Register citation if accumulator is provided
            const index = citationAccumulator
              ? citationAccumulator.addWeb({
                  url: r.url,
                  title: r.title,
                  preview: r.content.slice(0, 200),
                })
              : data.results.indexOf(r) + 1

            return `[${index}] **${r.title}**\n${r.url}\n${snippet}`
          })
          .join("\n\n")

        return output
      } catch (err) {
        logger.error({ err }, "Ariadne: webSearch tool failed")
        return "Web search failed. Please try again."
      }
    },
    {
      name: "web_search",
      description:
        "Search the web for current information, documentation, news, or anything not in the workspace's knowledge base. Use this when you need up-to-date information or external resources.",
      schema: z.object({
        query: z.string().describe("The search query for web search"),
        deepSearch: z
          .boolean()
          .optional()
          .describe("Set to true for more thorough search (slower but better for complex queries)"),
        maxResults: z.number().optional().describe("Maximum number of results to return (default: 5, max: 10)"),
      }),
    },
  )

  const fetchUrl = tool(
    async (input) => {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 10000)

        const response = await fetch(input.url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; Ariadne/1.0; +https://threa.app)",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          signal: controller.signal,
        })
        clearTimeout(timeout)

        if (!response.ok) {
          return `Failed to fetch URL: ${response.status} ${response.statusText}`
        }

        const contentType = response.headers.get("content-type") || ""

        // Handle JSON responses
        if (contentType.includes("application/json")) {
          const json = await response.json()
          const jsonStr = JSON.stringify(json, null, 2)
          if (jsonStr.length > 4000) {
            return `JSON response (truncated):\n\`\`\`json\n${jsonStr.slice(0, 4000)}...\n\`\`\``
          }
          return `JSON response:\n\`\`\`json\n${jsonStr}\n\`\`\``
        }

        // Handle plain text
        if (contentType.includes("text/plain")) {
          const text = await response.text()
          if (text.length > 4000) {
            return `Plain text (truncated):\n${text.slice(0, 4000)}...`
          }
          return text
        }

        // Handle HTML - extract main content
        const html = await response.text()
        const $ = cheerio.load(html)

        // Remove unwanted elements
        $("script, style, nav, header, footer, aside, iframe, noscript").remove()

        // Try to find the main content
        let mainContent = ""
        const mainSelectors = ["article", "main", '[role="main"]', ".content", ".post", ".article", "#content"]

        for (const selector of mainSelectors) {
          const el = $(selector)
          if (el.length > 0) {
            mainContent = el.text()
            break
          }
        }

        // Fall back to body if no main content found
        if (!mainContent) {
          mainContent = $("body").text()
        }

        // Clean up whitespace
        mainContent = mainContent.replace(/\s+/g, " ").trim()

        // Get title
        const title = $("title").text().trim() || $("h1").first().text().trim() || "Untitled"

        // Get meta description
        const description = $('meta[name="description"]').attr("content") || ""

        // Register citation for this URL fetch
        if (citationAccumulator) {
          citationAccumulator.addWeb({
            url: input.url,
            title,
            preview: mainContent.slice(0, 200),
          })
        }

        let output = `**${title}**\n`
        if (description) {
          output += `*${description}*\n\n`
        }

        if (mainContent.length > 4000) {
          output += mainContent.slice(0, 4000) + "..."
        } else {
          output += mainContent
        }

        return output
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return "Request timed out. The URL took too long to respond."
        }
        logger.error({ err, url: input.url }, "Ariadne: fetchUrl tool failed")
        return `Failed to fetch URL: ${err instanceof Error ? err.message : "Unknown error"}`
      }
    },
    {
      name: "fetch_url",
      description:
        "Fetch and read the content of a URL. Use this to read documentation, articles, or any web page that someone shared. Returns the main text content of the page.",
      schema: z.object({
        url: z.string().url().describe("The URL to fetch and read"),
      }),
    },
  )

  return [searchMemos, searchMessages, getStreamContext, getThreadHistory, webSearch, fetchUrl]
}
