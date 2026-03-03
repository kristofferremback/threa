import { describe, expect, it } from "bun:test"
import { parseMarkdown, serializeToMarkdown } from "./markdown"
import type { JSONContent } from "@threa/types"

describe("@threa/prosemirror markdown attachment metadata", () => {
  it("serializes attachment metadata into the markdown link title", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "attachmentReference",
              attrs: {
                id: "attach_123",
                filename: "report.pdf",
                mimeType: "application/pdf",
                sizeBytes: 2048,
                status: "uploaded",
                imageIndex: null,
                error: null,
              },
            },
          ],
        },
      ],
    }

    expect(serializeToMarkdown(doc)).toBe(
      '[report.pdf](attachment:attach_123 "threa-attachment:filename=report.pdf&mimeType=application%2Fpdf&sizeBytes=2048")'
    )
  })

  it("restores attachment metadata from the markdown link title", () => {
    const parsed = parseMarkdown(
      '[Image #2](attachment:attach_789 "threa-attachment:filename=photo.png&mimeType=image%2Fpng&sizeBytes=4096")'
    )

    expect(parsed.content?.[0]?.content?.[0]).toEqual({
      type: "attachmentReference",
      attrs: {
        id: "attach_789",
        filename: "photo.png",
        mimeType: "image/png",
        sizeBytes: 4096,
        status: "uploaded",
        imageIndex: 2,
        error: null,
      },
    })
  })

  it("treats legacy attachment markdown without metadata as unknown size", () => {
    const parsed = parseMarkdown("[report.pdf](attachment:attach_123)")

    expect(parsed.content?.[0]?.content?.[0]).toEqual({
      type: "attachmentReference",
      attrs: {
        id: "attach_123",
        filename: "report.pdf",
        mimeType: "application/octet-stream",
        sizeBytes: null,
        status: "uploaded",
        imageIndex: null,
        error: null,
      },
    })
  })

  it("round-trips attachment labels that contain brackets and backslashes", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "attachmentReference",
              attrs: {
                id: "attach_456",
                filename: "report[final]\\v2].pdf",
                mimeType: "application/pdf",
                sizeBytes: 512,
                status: "uploaded",
                imageIndex: null,
                error: null,
              },
            },
          ],
        },
      ],
    }

    const markdown = serializeToMarkdown(doc)
    expect(markdown).toBe(
      '[report\\[final\\]\\\\v2\\].pdf](attachment:attach_456 "threa-attachment:filename=report%5Bfinal%5D%5Cv2%5D.pdf&mimeType=application%2Fpdf&sizeBytes=512")'
    )

    const parsed = parseMarkdown(markdown)
    expect(parsed.content?.[0]?.content?.[0]).toEqual({
      type: "attachmentReference",
      attrs: {
        id: "attach_456",
        filename: "report[final]\\v2].pdf",
        mimeType: "application/pdf",
        sizeBytes: 512,
        status: "uploaded",
        imageIndex: null,
        error: null,
      },
    })
  })

  it("parses legacy escaped attachment labels without metadata", () => {
    const parsed = parseMarkdown("[report\\[final\\]\\\\v2\\].pdf](attachment:attach_456)")

    expect(parsed.content?.[0]?.content?.[0]).toEqual({
      type: "attachmentReference",
      attrs: {
        id: "attach_456",
        filename: "report[final]\\v2].pdf",
        mimeType: "application/octet-stream",
        sizeBytes: null,
        status: "uploaded",
        imageIndex: null,
        error: null,
      },
    })
  })
})
