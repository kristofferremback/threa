import { ToolMessage, type BaseMessage } from "@langchain/core/messages"
import type { SourceItem } from "@threa/types"
import type { WorkspaceResearchToolResult } from "../../tools"

/**
 * Extract sources from a web_search tool result.
 */
export function extractSourcesFromWebSearch(resultJson: string): SourceItem[] {
  try {
    const content = JSON.parse(resultJson)
    if (content.results && Array.isArray(content.results)) {
      return content.results
        .filter((r: { title?: string; url?: string }) => r.title && r.url)
        .map((r: { title: string; url: string }) => ({ title: r.title, url: r.url }))
    }
  } catch {
    // Not valid JSON or not a search result
  }
  return []
}

export function parseWorkspaceResearchResult(resultJson: string): WorkspaceResearchToolResult | null {
  try {
    const parsed = JSON.parse(resultJson) as Partial<WorkspaceResearchToolResult>
    if (!parsed || typeof parsed !== "object") return null

    return {
      shouldSearch: parsed.shouldSearch === true,
      retrievedContext: typeof parsed.retrievedContext === "string" ? parsed.retrievedContext : null,
      sources: Array.isArray(parsed.sources) ? parsed.sources : [],
      memoCount: typeof parsed.memoCount === "number" ? parsed.memoCount : 0,
      messageCount: typeof parsed.messageCount === "number" ? parsed.messageCount : 0,
      attachmentCount: typeof parsed.attachmentCount === "number" ? parsed.attachmentCount : 0,
    }
  } catch {
    return null
  }
}

export function mergeSourceItems(existing: SourceItem[], incoming: SourceItem[]): SourceItem[] {
  if (incoming.length === 0) return existing

  const merged: SourceItem[] = [...existing]
  const seen = new Set(merged.map((source) => `${source.url}|${source.title}`))

  for (const source of incoming) {
    const key = `${source.url}|${source.title}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(source)
  }

  return merged
}

export function toSourceItems(
  sources: Array<{ title: string; url: string; type: "web" | "workspace"; snippet?: string }>
): SourceItem[] {
  return sources
    .filter((source) => source.title && source.url)
    .map((source) => ({
      title: source.title,
      url: source.url,
      type: source.type,
      snippet: source.snippet,
    }))
}

/**
 * Extract sources from web_search tool results in the message history.
 */
export function extractSearchSources(messages: BaseMessage[]): Array<{ title: string; url: string }> {
  const sources: Array<{ title: string; url: string }> = []
  const seenUrls = new Set<string>()

  for (const msg of messages) {
    // Type guards work on deserialized messages and provide proper TypeScript narrowing
    if (!ToolMessage.isInstance(msg)) continue

    try {
      const content = JSON.parse(msg.content as string)
      if (content.results && Array.isArray(content.results)) {
        for (const result of content.results) {
          if (result.title && result.url && !seenUrls.has(result.url)) {
            seenUrls.add(result.url)
            sources.push({ title: result.title, url: result.url })
          }
        }
      }
    } catch {
      // Not JSON or not a search result, skip
    }
  }

  return sources
}
