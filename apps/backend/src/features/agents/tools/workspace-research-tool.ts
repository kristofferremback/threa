import { tool } from "ai"
import { z } from "zod"
import type { ResearcherResult } from "../researcher"

const WorkspaceResearchSchema = z.object({
  reason: z.string().optional().describe("Optional reason for why additional workspace context is needed"),
})

export type WorkspaceResearchInput = z.infer<typeof WorkspaceResearchSchema>

export interface WorkspaceResearchToolResult {
  shouldSearch: boolean
  retrievedContext: string | null
  sources: ResearcherResult["sources"]
  memoCount: number
  messageCount: number
  attachmentCount: number
}

export interface WorkspaceResearchCallbacks {
  runResearcher: () => Promise<ResearcherResult>
}

/**
 * Creates a workspace_research tool that runs GAM retrieval on-demand.
 * The main companion agent can call this tool when it needs additional
 * workspace memory context before composing or revising a response.
 */
export function createWorkspaceResearchTool(callbacks: WorkspaceResearchCallbacks) {
  const { runResearcher } = callbacks

  return tool({
    description:
      "Retrieve relevant workspace memory (messages, memos, attachments) for the current conversation when you need additional context.",
    inputSchema: WorkspaceResearchSchema,
    execute: async () => {
      const result = await runResearcher()

      const payload: WorkspaceResearchToolResult = {
        shouldSearch: result.shouldSearch,
        retrievedContext: result.retrievedContext,
        sources: result.sources,
        memoCount: result.memos.length,
        messageCount: result.messages.length,
        attachmentCount: result.attachments?.length ?? 0,
      }

      return JSON.stringify(payload)
    },
  })
}
