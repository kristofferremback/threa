import { z } from "zod"
import { AgentStepTypes } from "@threa/types"
import type { GeneralResearchResult } from "../general-researcher"
import { GENERAL_RESEARCH_TOTAL_BUDGET_MS } from "../general-researcher/config"
import { defineAgentTool, type AgentToolResult } from "../runtime"

const GeneralResearchSchema = z.object({
  query: z.string().min(1).describe("The research question to answer across available sources."),
})

export type GeneralResearchToolInput = z.infer<typeof GeneralResearchSchema>

export interface RunGeneralResearchOptions {
  toolCallId: string
  signal: AbortSignal
  onSubstep: (text: string) => void
  deadlineAt: number
}

export interface GeneralResearchCallbacks {
  runGeneralResearch: (query: string, opts: RunGeneralResearchOptions) => Promise<GeneralResearchResult>
}

const NEVER_SIGNAL = new AbortController().signal

function toTraceSourceType(type: string | undefined): "web" | "workspace" | "github" {
  if (type === "github") return "github"
  if (type === "workspace") return "workspace"
  return "web"
}

export function createGeneralResearchTool(callbacks: GeneralResearchCallbacks) {
  return defineAgentTool({
    name: "general_research",
    description:
      "Run bounded research across workspace knowledge, connected integrations like GitHub, and web search. Use for questions that require synthesis from multiple sources or deeper investigation than a single lookup.",
    inputSchema: GeneralResearchSchema,

    execute: async (input, { toolCallId, signal, onProgress }): Promise<AgentToolResult> => {
      const result = await callbacks.runGeneralResearch(input.query, {
        toolCallId,
        signal: signal ?? NEVER_SIGNAL,
        onSubstep: (text) => onProgress?.(text),
        deadlineAt: Date.now() + GENERAL_RESEARCH_TOTAL_BUDGET_MS,
      })

      return {
        output: JSON.stringify({
          status: result.status,
          answer: result.answer,
          reportStorageKey: result.reportStorageKey ?? null,
          sourceCount: result.sources.length,
          effort: result.effort ?? null,
          topicsCompleted: result.topicsCompleted,
          topicsPlanned: result.topicsPlanned,
          surfacesUsed: result.surfacesUsed,
          partialReason: result.partialReason ?? null,
          clarificationQuestion: result.clarificationQuestion ?? null,
          substeps: result.substeps,
        }),
        sources: result.sources,
        systemContext: result.answer.trim() || undefined,
      }
    },

    trace: {
      stepType: AgentStepTypes.GENERAL_RESEARCH,
      formatContent: (_input, result) => result.output,
      extractSources: (_input, result) =>
        (result.sources ?? []).map((source) => ({
          type: toTraceSourceType(source.type),
          title: source.title,
          url: source.url,
          snippet: source.snippet,
        })),
    },
  })
}
