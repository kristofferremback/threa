import { describe, expect, test, mock } from "bun:test"
import { createWorkspaceResearchTool } from "./workspace-research-tool"

describe("workspace_research tool", () => {
  test("should pass query to workspace agent and return structured AgentToolResult", async () => {
    const runWorkspaceAgent = mock(async () => ({
      retrievedContext: "## Retrieved Knowledge\nUseful workspace details.",
      sources: [
        {
          type: "workspace" as const,
          title: "Design Notes",
          url: "/w/ws_1/streams/stream_1?message=msg_1",
          snippet: "Important prior decision",
        },
      ],
      memos: [
        {
          memo: {} as unknown as import("../../memos").Memo,
          distance: 0.1,
          sourceStream: null,
        },
      ],
      messages: [],
      attachments: [],
    }))

    const tool = createWorkspaceResearchTool({ runWorkspaceAgent })
    const result = await tool.config.execute({ query: "What were the design decisions?" }, { toolCallId: "test" })

    expect(runWorkspaceAgent).toHaveBeenCalledTimes(1)
    expect(runWorkspaceAgent).toHaveBeenCalledWith("What were the design decisions?")

    const status = JSON.parse(result.output)
    expect(status).toMatchObject({
      status: "ok",
      contextAdded: true,
      sourceCount: 1,
      memoCount: 1,
      messageCount: 0,
      attachmentCount: 0,
    })

    expect(result.sources).toEqual([
      {
        title: "Design Notes",
        url: "/w/ws_1/streams/stream_1?message=msg_1",
        type: "workspace",
        snippet: "Important prior decision",
      },
    ])

    expect(result.systemContext).toBe("## Retrieved Knowledge\nUseful workspace details.")
  })
})
