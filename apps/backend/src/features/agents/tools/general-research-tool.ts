import { z } from "zod"
import { AgentStepTypes } from "@threa/types"
import type { GeneralResearchResult } from "../general-researcher"
import { GENERAL_RESEARCH_TOTAL_BUDGET_MS } from "../general-researcher/config"
import { defineAgentTool, type AgentToolResult } from "../runtime"
import { logger } from "../../../lib/logger"

const GeneralResearchSchema = z.object({
  query: z.string().min(1).describe("The research question to answer across available sources."),
})

/** Input accepted by the `general_research` agent tool. */
export type GeneralResearchToolInput = z.infer<typeof GeneralResearchSchema>

/** Runtime controls for one general research tool invocation. */
export interface RunGeneralResearchOptions {
  toolCallId: string
  /** Abort signal supplied by AgentRuntime for user/session cancellation. */
  signal: AbortSignal
  /** Called with progress text that should be streamed into the trace. */
  onSubstep: (text: string) => void
  /** Absolute Unix millisecond deadline for the bounded research run. */
  deadlineAt: number
}

/** Callback surface used by the tool wrapper to invoke the researcher. */
export interface GeneralResearchCallbacks {
  runGeneralResearch: (query: string, opts: RunGeneralResearchOptions) => Promise<GeneralResearchResult>
}

function toTraceSourceType(type: string | undefined): "web" | "workspace" | "github" {
  if (type === "web") return "web"
  if (type === "github") return "github"
  if (type === "workspace") return "workspace"
  if (type !== undefined) {
    logger.warn({ sourceType: type }, "Unknown general research source type")
  }
  return "web"
}

/** Creates the bounded general research agent tool for PersonaAgent tool sets. */
export function createGeneralResearchTool(callbacks: GeneralResearchCallbacks) {
  return defineAgentTool({
    name: "general_research",
    description:
      "Run bounded research across workspace knowledge, connected integrations like GitHub, and web search. Use for questions that require synthesis from multiple sources or deeper investigation than a single lookup.",
    inputSchema: GeneralResearchSchema,

    execute: async (input, { toolCallId, signal, onProgress }): Promise<AgentToolResult> => {
      if (!signal) {
        throw new Error("general_research tool requires an AbortSignal from the runtime")
      }
      const result = await callbacks.runGeneralResearch(input.query, {
        toolCallId,
        signal,
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
