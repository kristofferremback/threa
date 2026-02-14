import type { Tool } from "ai"
import { z } from "zod"
import type { AgentStepType, TraceSource, SourceItem } from "@threa/types"

// ---------------------------------------------------------------------------
// AgentToolResult — unified return type for all tool execute handlers
// ---------------------------------------------------------------------------

export interface AgentToolResult {
  /** What the LLM sees as the tool result */
  output: string
  /** Images for vision models — injected as user messages */
  multimodal?: Array<{ type: "image"; url: string }>
  /** Citation sources accumulated and attached to sent messages */
  sources?: SourceItem[]
  /** Injected into system prompt on next iteration (workspace research context) */
  systemContext?: string
}

// ---------------------------------------------------------------------------
// AgentToolConfig — self-describing tool definition
// ---------------------------------------------------------------------------

/**
 * Execution phase controls tool ordering within a single LLM turn.
 * - "early": runs first (e.g., web_search — collect sources before other tools)
 * - "normal": runs after early tools (default)
 */
export type ExecutionPhase = "early" | "normal"

export interface AgentToolConfig<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string
  description: string
  inputSchema: TSchema
  execute: (input: z.infer<TSchema>, opts: { toolCallId: string }) => Promise<AgentToolResult>
  /** Controls execution ordering within a single LLM turn. Defaults to "normal". */
  executionPhase?: ExecutionPhase
  trace: {
    stepType: AgentStepType
    formatContent: (input: z.infer<TSchema>, result: AgentToolResult) => string
    extractSources?: (input: z.infer<TSchema>, result: AgentToolResult) => TraceSource[]
  }
}

// ---------------------------------------------------------------------------
// AgentTool — opaque handle returned by defineAgentTool
// ---------------------------------------------------------------------------

export interface AgentTool {
  readonly name: string
  readonly config: AgentToolConfig
}

// ---------------------------------------------------------------------------
// defineAgentTool — factory that validates config and returns an AgentTool
// ---------------------------------------------------------------------------

export function defineAgentTool<TSchema extends z.ZodTypeAny>(config: AgentToolConfig<TSchema>): AgentTool {
  return { name: config.name, config: config as AgentToolConfig }
}

// ---------------------------------------------------------------------------
// toVercelToolDefs — convert AgentTool[] to Vercel AI tool definitions
// (schema only, no execute — the runtime executes tools manually)
// ---------------------------------------------------------------------------

export function toVercelToolDefs(tools: AgentTool[]): Record<string, Tool<any, any>> {
  const defs: Record<string, Tool<any, any>> = {}
  for (const t of tools) {
    defs[t.name] = {
      description: t.config.description,
      inputSchema: t.config.inputSchema,
    } as Tool<any, any>
  }
  return defs
}
