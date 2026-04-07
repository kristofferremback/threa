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

describe("@threa/prosemirror quote reply round-trip", () => {
  it("serializes quoteReply to blockquote with attribution link", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "quoteReply",
          attrs: {
            messageId: "msg_01ABC",
            streamId: "stream_01XYZ",
            authorName: "Kristoffer",
            snippet: "Hello world",
          },
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "My reply" }],
        },
      ],
    }

    const markdown = serializeToMarkdown(doc)
    expect(markdown).toBe("> Hello world\n> — [Kristoffer](quote:stream_01XYZ/msg_01ABC)\n\nMy reply")
  })

  it("parses blockquote with quote: attribution into quoteReply node", () => {
    const markdown = "> Hello world\n> — [Kristoffer](quote:stream_01XYZ/msg_01ABC)\n\nMy reply"
    const parsed = parseMarkdown(markdown)

    expect(parsed.content?.[0]).toEqual({
      type: "quoteReply",
      attrs: {
        messageId: "msg_01ABC",
        streamId: "stream_01XYZ",
        authorName: "Kristoffer",
        snippet: "Hello world",
      },
    })
    expect(parsed.content?.[1]?.type).toBe("paragraph")
  })

  it("round-trips quoteReply through markdown", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "quoteReply",
          attrs: {
            messageId: "msg_01KNGTTZJYCBZ8X4FEVX8YFBB3",
            streamId: "stream_01KJMS776MNP2Q382MJ639Y2JD",
            authorName: "Alice",
            snippet: "Gärna! Har du automatiskt mirroring?",
          },
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Ja, det har jag!" }],
        },
      ],
    }

    const markdown = serializeToMarkdown(doc)
    const parsed = parseMarkdown(markdown)

    expect(parsed.content?.[0]).toEqual({
      type: "quoteReply",
      attrs: {
        messageId: "msg_01KNGTTZJYCBZ8X4FEVX8YFBB3",
        streamId: "stream_01KJMS776MNP2Q382MJ639Y2JD",
        authorName: "Alice",
        snippet: "Gärna! Har du automatiskt mirroring?",
      },
    })
  })

  it("preserves multi-line snippets through round-trip", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "quoteReply",
          attrs: {
            messageId: "msg_01ABC",
            streamId: "stream_01XYZ",
            authorName: "Bob",
            snippet: "Line one\nLine two\nLine three",
          },
        },
      ],
    }

    const markdown = serializeToMarkdown(doc)
    expect(markdown).toBe("> Line one\n> Line two\n> Line three\n> — [Bob](quote:stream_01XYZ/msg_01ABC)")

    const parsed = parseMarkdown(markdown)
    expect(parsed.content?.[0]).toEqual({
      type: "quoteReply",
      attrs: {
        messageId: "msg_01ABC",
        streamId: "stream_01XYZ",
        authorName: "Bob",
        snippet: "Line one\nLine two\nLine three",
      },
    })
  })

  it("treats blockquote without quote: protocol as regular blockquote", () => {
    const markdown = "> Just a regular quote"
    const parsed = parseMarkdown(markdown)
    expect(parsed.content?.[0]?.type).toBe("blockquote")
  })
})
