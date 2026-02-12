import { describe, expect, test, mock } from "bun:test"
import { createWorkspaceResearchTool } from "./workspace-research-tool"

const toolOpts = { toolCallId: "test", messages: [] as any[] }

describe("workspace_research tool", () => {
  test("should pass query to workspace agent and return structured results", async () => {
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
    const rawResult = (await tool.execute!({ query: "What were the design decisions?" }, toolOpts)) as string
    const result = JSON.parse(rawResult)

    expect(runWorkspaceAgent).toHaveBeenCalledTimes(1)
    expect(runWorkspaceAgent).toHaveBeenCalledWith("What were the design decisions?")
    expect(result).toMatchObject({
      retrievedContext: "## Retrieved Knowledge\nUseful workspace details.",
      memoCount: 1,
      messageCount: 0,
      attachmentCount: 0,
      sources: [
        {
          type: "workspace",
          title: "Design Notes",
          url: "/w/ws_1/streams/stream_1?message=msg_1",
        },
      ],
    })
  })
})
