import { describe, expect, test, mock } from "bun:test"
import { createWorkspaceResearchTool } from "./workspace-research-tool"

describe("workspace_research tool", () => {
  test("should return structured workspace research results", async () => {
    const runResearcher = mock(async () => ({
      shouldSearch: true,
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

    const tool = createWorkspaceResearchTool({ runResearcher })
    const rawResult = await tool.invoke({ reason: "Need prior context" })
    const result = JSON.parse(rawResult as string)

    expect(runResearcher).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      shouldSearch: true,
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
