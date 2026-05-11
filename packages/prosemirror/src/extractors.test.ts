import { describe, expect, it } from "bun:test"
import type { JSONContent } from "@threa/types"
import { collectAttachmentReferenceIds } from "./extractors"

const reference = (id: string, status: string = "uploaded"): JSONContent => ({
  type: "attachmentReference",
  attrs: {
    id,
    filename: `${id}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 1024,
    status,
    imageIndex: null,
    error: null,
  },
})

describe("collectAttachmentReferenceIds", () => {
  it("returns ids in document order across nested blocks", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "see " }, reference("attach_a"), reference("attach_b")],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [reference("attach_c")],
                },
              ],
            },
          ],
        },
      ],
    }

    expect(collectAttachmentReferenceIds(doc)).toEqual(["attach_a", "attach_b", "attach_c"])
  })

  it("filters uploading and error nodes", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            reference("attach_ok", "uploaded"),
            reference("attach_pending", "uploading"),
            reference("attach_failed", "error"),
          ],
        },
      ],
    }

    expect(collectAttachmentReferenceIds(doc)).toEqual(["attach_ok"])
  })

  it("dedupes repeats while preserving first-seen order", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [reference("attach_x"), reference("attach_y"), reference("attach_x")],
        },
      ],
    }

    expect(collectAttachmentReferenceIds(doc)).toEqual(["attach_x", "attach_y"])
  })

  it("returns empty array for documents without attachment references", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hello world" }] }],
    }

    expect(collectAttachmentReferenceIds(doc)).toEqual([])
  })

  it("ignores nodes with missing or empty id", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "attachmentReference", attrs: { status: "uploaded" } },
            { type: "attachmentReference", attrs: { id: "", status: "uploaded" } },
            reference("attach_real"),
          ],
        },
      ],
    }

    expect(collectAttachmentReferenceIds(doc)).toEqual(["attach_real"])
  })
})
