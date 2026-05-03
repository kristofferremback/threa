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

describe("@threa/prosemirror emoji parsing", () => {
  it("can parse emoji shortcodes as editable text for composer surfaces", () => {
    const parsed = parseMarkdown(":rocket: launch", undefined, (shortcode) => (shortcode === "rocket" ? "🚀" : null), {
      emojiAsText: true,
    })

    expect(parsed.content?.[0]?.content).toEqual([
      { type: "text", text: "🚀" },
      { type: "text", text: " launch" },
    ])
    expect(serializeToMarkdown(parsed)).toBe("🚀 launch")
  })

  it("parses emoji shortcodes as atom nodes by default for wire-format round trips", () => {
    const parsed = parseMarkdown(":rocket:", undefined, (shortcode) => (shortcode === "rocket" ? "🚀" : null))

    expect(parsed.content?.[0]?.content?.[0]).toEqual({
      type: "emoji",
      attrs: { shortcode: "rocket", emoji: "🚀" },
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
            authorId: "usr_01KR",
            actorType: "user",
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
    expect(markdown).toBe("> Hello world\n>\n> — [Kristoffer](quote:stream_01XYZ/msg_01ABC/usr_01KR/user)\n\nMy reply")
  })

  it("parses blockquote with quote: attribution into quoteReply node", () => {
    const markdown = "> Hello world\n>\n> — [Kristoffer](quote:stream_01XYZ/msg_01ABC/usr_01KR/user)\n\nMy reply"
    const parsed = parseMarkdown(markdown)

    expect(parsed.content?.[0]).toEqual({
      type: "quoteReply",
      attrs: {
        messageId: "msg_01ABC",
        streamId: "stream_01XYZ",
        authorName: "Kristoffer",
        authorId: "usr_01KR",
        actorType: "user",
        snippet: "Hello world",
      },
    })
    expect(parsed.content?.[1]?.type).toBe("paragraph")
  })

  it("parses old format (no authorId/actorType) for backward compatibility", () => {
    const markdown = "> Hello world\n> — [Kristoffer](quote:stream_01XYZ/msg_01ABC)"
    const parsed = parseMarkdown(markdown)

    expect(parsed.content?.[0]).toEqual({
      type: "quoteReply",
      attrs: {
        messageId: "msg_01ABC",
        streamId: "stream_01XYZ",
        authorName: "Kristoffer",
        authorId: "",
        actorType: "user",
        snippet: "Hello world",
      },
    })
  })

  it("serializes empty authorId as the legacy two-segment form so it roundtrips", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "quoteReply",
          attrs: {
            messageId: "msg_01ABC",
            streamId: "stream_01XYZ",
            authorName: "Kristoffer",
            authorId: "",
            actorType: "user",
            snippet: "Hello world",
          },
        },
      ],
    }

    const markdown = serializeToMarkdown(doc)
    expect(markdown).toBe("> Hello world\n>\n> — [Kristoffer](quote:stream_01XYZ/msg_01ABC)")
    const reparsed = parseMarkdown(markdown)
    expect(reparsed.content?.[0]?.type).toBe("quoteReply")
    expect((reparsed.content?.[0]?.attrs as { authorId: string }).authorId).toBe("")
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
            authorId: "usr_01AL",
            actorType: "user",
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
        authorId: "usr_01AL",
        actorType: "user",
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
            authorId: "usr_01BOB",
            actorType: "user",
            snippet: "Line one\nLine two\nLine three",
          },
        },
      ],
    }

    const markdown = serializeToMarkdown(doc)
    expect(markdown).toBe(
      "> Line one\n> Line two\n> Line three\n>\n> — [Bob](quote:stream_01XYZ/msg_01ABC/usr_01BOB/user)"
    )

    const parsed = parseMarkdown(markdown)
    expect(parsed.content?.[0]).toEqual({
      type: "quoteReply",
      attrs: {
        messageId: "msg_01ABC",
        streamId: "stream_01XYZ",
        authorName: "Bob",
        authorId: "usr_01BOB",
        actorType: "user",
        snippet: "Line one\nLine two\nLine three",
      },
    })
  })

  it("round-trips a sharedMessage node losslessly", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "sharedMessage",
          attrs: {
            messageId: "msg_01ABC",
            streamId: "stream_01XYZ",
            authorName: "Ariadne",
            authorId: "",
            actorType: "user",
          },
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "FYI" }],
        },
      ],
    }

    const markdown = serializeToMarkdown(doc)
    expect(markdown).toBe("Shared a message from [Ariadne](shared-message:stream_01XYZ/msg_01ABC)\n\nFYI")

    const parsed = parseMarkdown(markdown)
    expect(parsed.content?.[0]).toEqual({
      type: "sharedMessage",
      attrs: {
        messageId: "msg_01ABC",
        streamId: "stream_01XYZ",
        authorName: "Ariadne",
        authorId: "",
        actorType: "user",
      },
    })
    expect(parsed.content?.[1]?.type).toBe("paragraph")
  })

  it("does not match shared-message line when prefix or trailing text differs", () => {
    const onlyParagraph = parseMarkdown("Hi! [Ariadne](shared-message:stream_01XYZ/msg_01ABC)")
    expect(onlyParagraph.content?.[0]?.type).toBe("paragraph")

    const withTrailing = parseMarkdown("Shared a message from [Ariadne](shared-message:stream_01XYZ/msg_01ABC) extra")
    expect(withTrailing.content?.[0]?.type).toBe("paragraph")
  })

  it("treats blockquote without quote: protocol as regular blockquote", () => {
    const markdown = "> Just a regular quote"
    const parsed = parseMarkdown(markdown)
    expect(parsed.content?.[0]?.type).toBe("blockquote")
  })

  it("round-trips author names containing brackets and backslashes", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "quoteReply",
          attrs: {
            messageId: "msg_01ABC",
            streamId: "stream_01XYZ",
            authorName: "John [Dev] Smith\\Sr",
            authorId: "usr_01JOHN",
            actorType: "user",
            snippet: "Hello",
          },
        },
      ],
    }

    const markdown = serializeToMarkdown(doc)
    expect(markdown).toBe("> Hello\n>\n> — [John [Dev\\] Smith\\\\Sr](quote:stream_01XYZ/msg_01ABC/usr_01JOHN/user)")

    const parsed = parseMarkdown(markdown)
    expect(parsed.content?.[0]).toEqual({
      type: "quoteReply",
      attrs: {
        messageId: "msg_01ABC",
        streamId: "stream_01XYZ",
        authorName: "John [Dev] Smith\\Sr",
        authorId: "usr_01JOHN",
        actorType: "user",
        snippet: "Hello",
      },
    })
  })

  it("round-trips persona actorType", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "quoteReply",
          attrs: {
            messageId: "msg_01ABC",
            streamId: "stream_01XYZ",
            authorName: "Ariadne",
            authorId: "persona_01AR",
            actorType: "persona",
            snippet: "Hello!",
          },
        },
      ],
    }

    const markdown = serializeToMarkdown(doc)
    const parsed = parseMarkdown(markdown)
    expect(parsed.content?.[0]).toEqual(doc.content![0])
  })

  it("preserves URL fragments when autolink text contains the full URL", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "https://github.com/threahq/priv-test/blob/main/README.md?plain=1#L4",
              marks: [
                {
                  type: "link",
                  attrs: { href: "https://github.com/threahq/priv-test/blob/main/README.md?plain=1" },
                },
              ],
            },
          ],
        },
      ],
    }

    expect(serializeToMarkdown(doc)).toBe(
      "[https://github.com/threahq/priv-test/blob/main/README.md?plain=1#L4](https://github.com/threahq/priv-test/blob/main/README.md?plain=1#L4)"
    )
  })
})

describe("mention/channel whitespace boundary", () => {
  it("should not parse @ as mention in email addresses", () => {
    const result = parseMarkdown("test@gmail.com")
    const content = result.content?.[0]?.content

    expect(content).toHaveLength(1)
    expect(content?.[0]).toEqual({ type: "text", text: "test@gmail.com" })
  })

  it("should not parse # as channel without preceding whitespace", () => {
    const result = parseMarkdown("issue#123")
    const content = result.content?.[0]?.content

    expect(content).toHaveLength(1)
    expect(content?.[0]).toEqual({ type: "text", text: "issue#123" })
  })

  it("should parse @ as mention when preceded by whitespace", () => {
    const result = parseMarkdown("Hey @kristoffer")
    const content = result.content?.[0]?.content

    expect(content).toHaveLength(2)
    expect(content?.[0]).toEqual({ type: "text", text: "Hey " })
    expect(content?.[1]?.type).toBe("mention")
    expect(content?.[1]?.attrs?.slug).toBe("kristoffer")
  })

  it("should parse @ as mention at start of text", () => {
    const result = parseMarkdown("@kristoffer")
    const content = result.content?.[0]?.content

    expect(content).toHaveLength(1)
    expect(content?.[0]?.type).toBe("mention")
  })
})
