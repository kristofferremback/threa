import { describe, expect, it } from "bun:test"
import { AgentStepTypes } from "@threa/types"
import { createGeneralResearchTool } from "./general-research-tool"

describe("createGeneralResearchTool", () => {
  it("returns compact output, sources, system context, and trace content", async () => {
    const tool = createGeneralResearchTool({
      runGeneralResearch: async (_query, opts) => {
        opts.onSubstep("Planning research")
        return {
          status: "ok",
          answer: "The answer is concise.",
          reportStorageKey: "research-reports/ws_1/session_1/grun_1.md",
          sources: [{ type: "web", title: "Source", url: "https://example.com" }],
          substeps: [{ text: "Planning research", at: "2026-04-25T12:00:00.000Z" }],
          effort: "quick",
          topicsCompleted: 1,
          topicsPlanned: 1,
          surfacesUsed: ["web"],
        }
      },
    })

    const progress: string[] = []
    const result = await tool.config.execute(
      { query: "What changed?" },
      { toolCallId: "tool_1", signal: new AbortController().signal, onProgress: (substep) => progress.push(substep) }
    )
    const parsed = JSON.parse(result.output)

    expect(tool.config.trace.stepType).toBe(AgentStepTypes.GENERAL_RESEARCH)
    expect(progress).toEqual(["Planning research"])
    expect(result.systemContext).toBe("The answer is concise.")
    expect(result.sources).toEqual([{ type: "web", title: "Source", url: "https://example.com" }])
    expect(parsed).toMatchObject({
      status: "ok",
      answer: "The answer is concise.",
      sourceCount: 1,
      effort: "quick",
      topicsCompleted: 1,
      topicsPlanned: 1,
    })
    expect(tool.config.trace.formatContent({ query: "What changed?" }, result)).toBe(result.output)
    expect(tool.config.trace.extractSources?.({ query: "What changed?" }, result)).toEqual([
      { type: "web", title: "Source", url: "https://example.com", snippet: undefined },
    ])
  })

  it("fails loudly when the runtime does not provide an abort signal", async () => {
    const tool = createGeneralResearchTool({
      runGeneralResearch: async () => {
        throw new Error("should not run without a signal")
      },
    })

    await expect(tool.config.execute({ query: "What changed?" }, { toolCallId: "tool_1" })).rejects.toThrow(
      "general_research tool requires an AbortSignal"
    )
  })
})
