import { z } from "zod"
import type { WorkspaceAgentResult } from "../researcher"
import { defineAgentTool, type AgentToolResult } from "../runtime"

const WorkspaceResearchSchema = z.object({
  query: z.string().describe("What information you need from the workspace"),
})

export type WorkspaceResearchInput = z.infer<typeof WorkspaceResearchSchema>

export interface WorkspaceResearchToolResult {
  retrievedContext: string | null
  sources: WorkspaceAgentResult["sources"]
  memoCount: number
  messageCount: number
  attachmentCount: number
}

export interface WorkspaceResearchCallbacks {
  runWorkspaceAgent: (query: string) => Promise<WorkspaceAgentResult>
}

export function createWorkspaceResearchTool(callbacks: WorkspaceResearchCallbacks) {
  const { runWorkspaceAgent } = callbacks

  return defineAgentTool({
    name: "workspace_research",
    description:
      "Retrieve relevant workspace memory (messages, memos, attachments) for the current conversation when you need additional context.",
    inputSchema: WorkspaceResearchSchema,

    execute: async (input): Promise<AgentToolResult> => {
      const result = await runWorkspaceAgent(input.query)

      const payload: WorkspaceResearchToolResult = {
        retrievedContext: result.retrievedContext,
        sources: result.sources,
        memoCount: result.memos.length,
        messageCount: result.messages.length,
        attachmentCount: result.attachments?.length ?? 0,
      }

      // Source items for message citations
      const sourceItems = result.sources
        .filter((s) => s.title && s.url)
        .map((s) => ({
          title: s.title,
          url: s.url,
          type: s.type as "web" | "workspace",
          snippet: s.snippet,
        }))

      // The LLM gets a compact status summary; the actual context goes into systemContext
      const output = JSON.stringify({
        status: "ok",
        contextAdded: Boolean(payload.retrievedContext?.trim()),
        sourceCount: sourceItems.length,
        memoCount: payload.memoCount,
        messageCount: payload.messageCount,
        attachmentCount: payload.attachmentCount,
      })

      return {
        output,
        sources: sourceItems,
        systemContext: payload.retrievedContext?.trim() || undefined,
      }
    },

    trace: {
      stepType: "workspace_search",
      formatContent: (_input, result) => {
        try {
          return result.output
        } catch {
          return "{}"
        }
      },
      extractSources: (_input, result) =>
        (result.sources ?? []).map((s) => ({
          type: "workspace" as const,
          title: s.title,
          url: s.url,
          snippet: s.snippet,
        })),
    },
  })
}
