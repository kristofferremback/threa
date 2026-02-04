import { describe, it, expect, mock } from "bun:test"
import { createSearchAttachmentsTool, type AttachmentSearchResult } from "./search-attachments-tool"
import { createGetAttachmentTool, type AttachmentDetails } from "./get-attachment-tool"
import { createLoadAttachmentTool, type LoadAttachmentResult } from "./load-attachment-tool"

describe("search_attachments tool", () => {
  it("returns search results when attachments found", async () => {
    const mockResults: AttachmentSearchResult[] = [
      {
        id: "attach_1",
        filename: "report.pdf",
        mimeType: "application/pdf",
        contentType: "document",
        summary: "Quarterly financial report with revenue analysis",
        streamId: "stream_1",
        messageId: "msg_1",
        createdAt: "2026-02-03T10:00:00Z",
      },
    ]

    const searchAttachments = mock(() => Promise.resolve(mockResults))
    const tool = createSearchAttachmentsTool({ searchAttachments })

    const result = await tool.invoke({ query: "financial report" })
    const parsed = JSON.parse(result)

    expect(parsed.query).toBe("financial report")
    expect(parsed.results).toHaveLength(1)
    expect(parsed.results[0]).toMatchObject({
      id: "attach_1",
      filename: "report.pdf",
      mimeType: "application/pdf",
      contentType: "document",
    })
  })

  it("returns empty message when no results", async () => {
    const searchAttachments = mock(() => Promise.resolve([]))
    const tool = createSearchAttachmentsTool({ searchAttachments })

    const result = await tool.invoke({ query: "nonexistent" })
    const parsed = JSON.parse(result)

    expect(parsed.query).toBe("nonexistent")
    expect(parsed.results).toHaveLength(0)
    expect(parsed.message).toBe("No matching attachments found")
  })

  it("truncates long summaries", async () => {
    const longSummary = "A".repeat(300)
    const mockResults: AttachmentSearchResult[] = [
      {
        id: "attach_1",
        filename: "doc.pdf",
        mimeType: "application/pdf",
        contentType: "document",
        summary: longSummary,
        streamId: "stream_1",
        messageId: "msg_1",
        createdAt: "2026-02-03T10:00:00Z",
      },
    ]

    const searchAttachments = mock(() => Promise.resolve(mockResults))
    const tool = createSearchAttachmentsTool({ searchAttachments })

    const result = await tool.invoke({ query: "doc" })
    const parsed = JSON.parse(result)

    expect(parsed.results[0].summary.length).toBeLessThanOrEqual(200)
    expect(parsed.results[0].summary.endsWith("...")).toBe(true)
  })

  it("enforces maximum result limit", async () => {
    const searchAttachments = mock((input: { limit?: number }) => {
      expect(input.limit).toBeLessThanOrEqual(20)
      return Promise.resolve([])
    })
    const tool = createSearchAttachmentsTool({ searchAttachments })

    await tool.invoke({ query: "test", limit: 100 })

    expect(searchAttachments).toHaveBeenCalled()
  })

  it("handles errors gracefully", async () => {
    const searchAttachments = mock(() => Promise.reject(new Error("Database error")))
    const tool = createSearchAttachmentsTool({ searchAttachments })

    const result = await tool.invoke({ query: "test" })
    const parsed = JSON.parse(result)

    expect(parsed.error).toContain("Search failed")
    expect(parsed.query).toBe("test")
  })
})

describe("get_attachment tool", () => {
  it("returns full attachment details", async () => {
    const mockAttachment: AttachmentDetails = {
      id: "attach_1",
      filename: "screenshot.png",
      mimeType: "image/png",
      sizeBytes: 102400,
      processingStatus: "completed",
      createdAt: "2026-02-03T10:00:00Z",
      extraction: {
        contentType: "screenshot",
        summary: "A dashboard showing performance metrics",
        fullText: "Revenue: $1.2M, Users: 50,000",
        structuredData: null,
      },
    }

    const getAttachment = mock(() => Promise.resolve(mockAttachment))
    const tool = createGetAttachmentTool({ getAttachment })

    const result = await tool.invoke({ attachmentId: "attach_1" })
    const parsed = JSON.parse(result)

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
  })

  it("returns error when attachment not found", async () => {
    const getAttachment = mock(() => Promise.resolve(null))
    const tool = createGetAttachmentTool({ getAttachment })

    const result = await tool.invoke({ attachmentId: "nonexistent" })
    const parsed = JSON.parse(result)

    expect(parsed.error).toContain("not found")
    expect(parsed.attachmentId).toBe("nonexistent")
  })

  it("handles attachments without extraction", async () => {
    const mockAttachment: AttachmentDetails = {
      id: "attach_1",
      filename: "new-upload.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 50000,
      processingStatus: "pending",
      createdAt: "2026-02-03T10:00:00Z",
      extraction: null,
    }

    const getAttachment = mock(() => Promise.resolve(mockAttachment))
    const tool = createGetAttachmentTool({ getAttachment })

    const result = await tool.invoke({ attachmentId: "attach_1" })
    const parsed = JSON.parse(result)

    expect(parsed.extraction).toBeNull()
    expect(parsed.processingStatus).toBe("pending")
  })

  it("handles errors gracefully", async () => {
    const getAttachment = mock(() => Promise.reject(new Error("Access denied")))
    const tool = createGetAttachmentTool({ getAttachment })

    const result = await tool.invoke({ attachmentId: "attach_1" })
    const parsed = JSON.parse(result)

    expect(parsed.error).toContain("Failed to get attachment")
    expect(parsed.attachmentId).toBe("attach_1")
  })
})

describe("load_attachment tool", () => {
  it("returns multimodal content with image for vision models", async () => {
    const mockResult: LoadAttachmentResult = {
      id: "attach_1",
      filename: "chart.png",
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,iVBORw0KGgo...",
    }

    const loadAttachment = mock(() => Promise.resolve(mockResult))
    const tool = createLoadAttachmentTool({ loadAttachment })

    const result = await tool.invoke({ attachmentId: "attach_1" })

    // Result should be a MultimodalToolResult, not a JSON string
    expect(typeof result).toBe("object")
    expect(result).toHaveProperty("__multimodal__", true)
    expect(result).toHaveProperty("content")

    // Type narrow to access content
    if (typeof result === "object" && result !== null && "content" in result) {
      const content = result.content as Array<{ type: string; text?: string; image_url?: { url: string } }>
      expect(Array.isArray(content)).toBe(true)

      // Should have text and image_url blocks
      const textBlock = content.find((b) => b.type === "text")
      const imageBlock = content.find((b) => b.type === "image_url")

      expect(textBlock).toBeDefined()
      expect(textBlock?.text).toContain("chart.png")
      expect(imageBlock).toBeDefined()
      expect(imageBlock?.image_url?.url).toBe("data:image/png;base64,iVBORw0KGgo...")
    } else {
      throw new Error("Expected multimodal result")
    }
  })

  it("returns error when attachment not found", async () => {
    const loadAttachment = mock(() => Promise.resolve(null))
    const tool = createLoadAttachmentTool({ loadAttachment })

    const result = await tool.invoke({ attachmentId: "nonexistent" })

    // Errors are still returned as JSON strings
    expect(typeof result).toBe("string")
    const parsed = JSON.parse(result as string)

    expect(parsed.error).toContain("not found")
    expect(parsed.attachmentId).toBe("nonexistent")
  })

  it("handles errors gracefully", async () => {
    const loadAttachment = mock(() => Promise.reject(new Error("Storage unavailable")))
    const tool = createLoadAttachmentTool({ loadAttachment })

    const result = await tool.invoke({ attachmentId: "attach_1" })

    // Errors are still returned as JSON strings
    expect(typeof result).toBe("string")
    const parsed = JSON.parse(result as string)

    expect(parsed.error).toContain("Failed to load attachment")
    expect(parsed.attachmentId).toBe("attach_1")
  })
})
