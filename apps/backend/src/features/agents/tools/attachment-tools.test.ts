import { describe, it, expect, spyOn, afterEach } from "bun:test"
import { AttachmentRepository } from "../../attachments"
import { AttachmentExtractionRepository } from "../../attachments"
import { createSearchAttachmentsTool } from "./search-attachments-tool"
import { createGetAttachmentTool, type AttachmentDetails } from "./get-attachment-tool"
import { createLoadAttachmentTool } from "./load-attachment-tool"
import type { WorkspaceToolDeps } from "./tool-deps"

const toolOpts = { toolCallId: "test" }

function makeDeps(overrides?: Partial<WorkspaceToolDeps>): WorkspaceToolDeps {
  return {
    db: {} as WorkspaceToolDeps["db"],
    workspaceId: "workspace_test",
    accessibleStreamIds: ["stream_1", "stream_2"],
    invokingMemberId: "member_test",
    searchService: {} as WorkspaceToolDeps["searchService"],
    storage: { getObject: async () => Buffer.from("test") } as unknown as WorkspaceToolDeps["storage"],
    ...overrides,
  }
}

afterEach(() => {
  // spyOn auto-restores after each test in bun:test
})

describe("search_attachments tool", () => {
  it("should return search results when attachments found", async () => {
    const searchSpy = spyOn(AttachmentRepository, "searchWithExtractions").mockResolvedValue([
      {
        id: "attach_1",
        filename: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        storagePath: "uploads/report.pdf",
        processingStatus: "completed",
        streamId: "stream_1",
        messageId: "msg_1",
        createdAt: new Date("2026-02-03T10:00:00Z"),
        extraction: { contentType: "document", summary: "Quarterly financial report with revenue analysis" },
      } as any,
    ])

    const tool = createSearchAttachmentsTool(makeDeps())
    const { output } = await tool.config.execute({ query: "financial report", limit: 10 }, toolOpts)
    const parsed = JSON.parse(output)

    expect(parsed.query).toBe("financial report")
    expect(parsed.results).toHaveLength(1)
    expect(parsed.results[0]).toMatchObject({
      id: "attach_1",
      filename: "report.pdf",
      mimeType: "application/pdf",
      contentType: "document",
    })

    searchSpy.mockRestore()
  })

  it("should return empty message when no results", async () => {
    const searchSpy = spyOn(AttachmentRepository, "searchWithExtractions").mockResolvedValue([])

    const tool = createSearchAttachmentsTool(makeDeps())
    const { output } = await tool.config.execute({ query: "nonexistent", limit: 10 }, toolOpts)
    const parsed = JSON.parse(output)

    expect(parsed.query).toBe("nonexistent")
    expect(parsed.results).toHaveLength(0)
    expect(parsed.message).toBe("No matching attachments found")

    searchSpy.mockRestore()
  })

  it("should truncate long summaries", async () => {
    const longSummary = "A".repeat(300)
    const searchSpy = spyOn(AttachmentRepository, "searchWithExtractions").mockResolvedValue([
      {
        id: "attach_1",
        filename: "doc.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        storagePath: "uploads/doc.pdf",
        processingStatus: "completed",
        streamId: "stream_1",
        messageId: "msg_1",
        createdAt: new Date("2026-02-03T10:00:00Z"),
        extraction: { contentType: "document", summary: longSummary },
      } as any,
    ])

    const tool = createSearchAttachmentsTool(makeDeps())
    const { output } = await tool.config.execute({ query: "doc", limit: 10 }, toolOpts)
    const parsed = JSON.parse(output)

    expect(parsed.results[0].summary.length).toBeLessThanOrEqual(200)
    expect(parsed.results[0].summary.endsWith("...")).toBe(true)

    searchSpy.mockRestore()
  })

  it("should enforce maximum result limit", async () => {
    const searchSpy = spyOn(AttachmentRepository, "searchWithExtractions").mockResolvedValue([])

    const tool = createSearchAttachmentsTool(makeDeps())
    await tool.config.execute({ query: "test", limit: 100 }, toolOpts)

    expect(searchSpy).toHaveBeenCalled()
    const callArgs = searchSpy.mock.calls[0]
    expect((callArgs[1] as any).limit).toBeLessThanOrEqual(20)

    searchSpy.mockRestore()
  })

  it("should handle errors gracefully", async () => {
    const searchSpy = spyOn(AttachmentRepository, "searchWithExtractions").mockRejectedValue(
      new Error("Database error")
    )

    const tool = createSearchAttachmentsTool(makeDeps())
    const { output } = await tool.config.execute({ query: "test", limit: 10 }, toolOpts)
    const parsed = JSON.parse(output)

    expect(parsed.error).toContain("Search failed")
    expect(parsed.query).toBe("test")

    searchSpy.mockRestore()
  })
})

describe("get_attachment tool", () => {
  it("should return full attachment details", async () => {
    const findSpy = spyOn(AttachmentRepository, "findById").mockResolvedValue({
      id: "attach_1",
      filename: "screenshot.png",
      mimeType: "image/png",
      sizeBytes: 102400,
      processingStatus: "completed",
      streamId: "stream_1",
      messageId: "msg_1",
      storagePath: "uploads/screenshot.png",
      createdAt: new Date("2026-02-03T10:00:00Z"),
    } as any)

    const extractionSpy = spyOn(AttachmentExtractionRepository, "findByAttachmentId").mockResolvedValue({
      contentType: "screenshot",
      summary: "A dashboard showing performance metrics",
      fullText: "Revenue: $1.2M, Users: 50,000",
      structuredData: null,
    } as any)

    const tool = createGetAttachmentTool(makeDeps())
    const { output } = await tool.config.execute({ attachmentId: "attach_1" }, toolOpts)
    const parsed = JSON.parse(output)

    expect(parsed).toMatchObject({
      id: "attach_1",
      filename: "screenshot.png",
      mimeType: "image/png",
      sizeBytes: 102400,
      processingStatus: "completed",
    })
    expect(parsed.extraction).toMatchObject({
      contentType: "screenshot",
      summary: "A dashboard showing performance metrics",
      fullText: "Revenue: $1.2M, Users: 50,000",
    })

    findSpy.mockRestore()
    extractionSpy.mockRestore()
  })

  it("should return error when attachment not found", async () => {
    const findSpy = spyOn(AttachmentRepository, "findById").mockResolvedValue(null as any)

    const tool = createGetAttachmentTool(makeDeps())
    const { output } = await tool.config.execute({ attachmentId: "nonexistent" }, toolOpts)
    const parsed = JSON.parse(output)

    expect(parsed.error).toContain("not found")
    expect(parsed.attachmentId).toBe("nonexistent")

    findSpy.mockRestore()
  })

  it("should return error when attachment is in inaccessible stream", async () => {
    const findSpy = spyOn(AttachmentRepository, "findById").mockResolvedValue({
      id: "attach_1",
      filename: "secret.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      processingStatus: "completed",
      streamId: "stream_private",
      messageId: "msg_1",
      storagePath: "uploads/secret.pdf",
      createdAt: new Date("2026-02-03T10:00:00Z"),
    } as any)

    const tool = createGetAttachmentTool(makeDeps())
    const { output } = await tool.config.execute({ attachmentId: "attach_1" }, toolOpts)
    const parsed = JSON.parse(output)

    expect(parsed.error).toContain("not found")

    findSpy.mockRestore()
  })

  it("should handle attachments without extraction", async () => {
    const findSpy = spyOn(AttachmentRepository, "findById").mockResolvedValue({
      id: "attach_1",
      filename: "new-upload.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 50000,
      processingStatus: "pending",
      streamId: "stream_1",
      messageId: "msg_1",
      storagePath: "uploads/new-upload.jpg",
      createdAt: new Date("2026-02-03T10:00:00Z"),
    } as any)

    const extractionSpy = spyOn(AttachmentExtractionRepository, "findByAttachmentId").mockResolvedValue(null as any)

    const tool = createGetAttachmentTool(makeDeps())
    const { output } = await tool.config.execute({ attachmentId: "attach_1" }, toolOpts)
    const parsed = JSON.parse(output)

    expect(parsed.extraction).toBeNull()
    expect(parsed.processingStatus).toBe("pending")

    findSpy.mockRestore()
    extractionSpy.mockRestore()
  })

  it("should handle errors gracefully", async () => {
    const findSpy = spyOn(AttachmentRepository, "findById").mockRejectedValue(new Error("Access denied"))

    const tool = createGetAttachmentTool(makeDeps())
    const { output } = await tool.config.execute({ attachmentId: "attach_1" }, toolOpts)
    const parsed = JSON.parse(output)

    expect(parsed.error).toContain("Failed to get attachment")
    expect(parsed.attachmentId).toBe("attach_1")

    findSpy.mockRestore()
  })
})

describe("load_attachment tool", () => {
  it("should return AgentToolResult with multimodal content for images", async () => {
    const findSpy = spyOn(AttachmentRepository, "findById").mockResolvedValue({
      id: "attach_1",
      filename: "chart.png",
      mimeType: "image/png",
      sizeBytes: 1024,
      processingStatus: "completed",
      streamId: "stream_1",
      messageId: "msg_1",
      storagePath: "uploads/chart.png",
      createdAt: new Date("2026-02-03T10:00:00Z"),
    } as any)

    const imageData = Buffer.from("fake-png-data")
    const deps = makeDeps({
      storage: { getObject: async () => imageData } as unknown as WorkspaceToolDeps["storage"],
    })

    const tool = createLoadAttachmentTool(deps)
    const result = await tool.config.execute({ attachmentId: "attach_1" }, toolOpts)

    expect(result.output).toContain("chart.png")
    expect(result.multimodal).toEqual([{ type: "image", url: `data:image/png;base64,${imageData.toString("base64")}` }])

    findSpy.mockRestore()
  })

  it("should return error when attachment not found", async () => {
    const findSpy = spyOn(AttachmentRepository, "findById").mockResolvedValue(null as any)

    const tool = createLoadAttachmentTool(makeDeps())
    const { output } = await tool.config.execute({ attachmentId: "nonexistent" }, toolOpts)
    const parsed = JSON.parse(output)

    expect(parsed.error).toContain("not found")
    expect(parsed.attachmentId).toBe("nonexistent")

    findSpy.mockRestore()
  })

  it("should return error for non-image attachments", async () => {
    const findSpy = spyOn(AttachmentRepository, "findById").mockResolvedValue({
      id: "attach_1",
      filename: "doc.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      processingStatus: "completed",
      streamId: "stream_1",
      messageId: "msg_1",
      storagePath: "uploads/doc.pdf",
      createdAt: new Date("2026-02-03T10:00:00Z"),
    } as any)

    const tool = createLoadAttachmentTool(makeDeps())
    const { output } = await tool.config.execute({ attachmentId: "attach_1" }, toolOpts)
    const parsed = JSON.parse(output)

    expect(parsed.error).toContain("not an image")

    findSpy.mockRestore()
  })

  it("should handle errors gracefully", async () => {
    const findSpy = spyOn(AttachmentRepository, "findById").mockRejectedValue(new Error("Storage unavailable"))

    const tool = createLoadAttachmentTool(makeDeps())
    const { output } = await tool.config.execute({ attachmentId: "attach_1" }, toolOpts)
    const parsed = JSON.parse(output)

    expect(parsed.error).toContain("Failed to load attachment")
    expect(parsed.attachmentId).toBe("attach_1")

    findSpy.mockRestore()
  })
})
