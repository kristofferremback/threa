import { describe, it, expect } from "vitest"
import type { JSONContent } from "@threa/types"
import { hasCommandNode } from "./commands"

describe("hasCommandNode", () => {
  it("returns true when content contains a slashCommand node", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "slashCommand", attrs: { name: "echo" } },
            { type: "text", text: " hello world" },
          ],
        },
      ],
    }
    expect(hasCommandNode(doc)).toBe(true)
  })

  it("returns false for plain text that starts with a slash", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "/s" }],
        },
      ],
    }
    expect(hasCommandNode(doc)).toBe(false)
  })

  it("returns false for an empty paragraph", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph" }],
    }
    expect(hasCommandNode(doc)).toBe(false)
  })

  it("returns false when content only contains mentions, channels, or emojis", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "mention", attrs: { id: "user_1", slug: "alice", mentionType: "user" } },
            { type: "text", text: " look " },
            { type: "channelLink", attrs: { id: "stream_1", slug: "general" } },
            { type: "text", text: " " },
            { type: "emoji", attrs: { shortcode: "tada" } },
          ],
        },
      ],
    }
    expect(hasCommandNode(doc)).toBe(false)
  })

  it("detects a nested slashCommand node", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "prefix " },
            { type: "slashCommand", attrs: { name: "help" } },
          ],
        },
      ],
    }
    expect(hasCommandNode(doc)).toBe(true)
  })
})
