import { tool } from "ai"
import { z } from "zod"
import type { WorkspaceAgentResult } from "../researcher"

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

/**
 * Creates a workspace_research tool that runs GAM retrieval on-demand.
 * The main companion agent can call this tool when it needs additional
 * workspace memory context before composing or revising a response.
 */
export function createWorkspaceResearchTool(callbacks: WorkspaceResearchCallbacks) {
  const { runWorkspaceAgent } = callbacks

  return tool({
    description:
      "Retrieve relevant workspace memory (messages, memos, attachments) for the current conversation when you need additional context.",
    inputSchema: WorkspaceResearchSchema,
    execute: async (input) => {
      const result = await runWorkspaceAgent(input.query)

      const payload: WorkspaceResearchToolResult = {
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
