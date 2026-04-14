import { describe, it, expect } from "vitest"
import { stripMarkdown } from "./strip"

describe("stripMarkdown", () => {
  it("removes bold and italic markers", () => {
    expect(stripMarkdown("**Deploy succeeded** on _main_")).toBe("Deploy succeeded on main")
  })

  it("preserves underscores that are part of identifiers", () => {
    expect(stripMarkdown(":white_check_mark: Deploy Cloudflare succeeded")).toBe(
      ":white_check_mark: Deploy Cloudflare succeeded"
    )
  })

  it("strips link syntax but keeps the link text", () => {
    expect(stripMarkdown("Staging deployed — [feat(messaging): metadata](https://example.com/pr/367)")).toBe(
      "Staging deployed — feat(messaging): metadata"
    )
  })

  it("strips inline code fences but keeps the content", () => {
    expect(stripMarkdown("run `bun test`")).toBe("run bun test")
  })

  it("strips fenced code blocks but keeps inner content", () => {
    expect(stripMarkdown("```ts\nconst x = 1\n```")).toBe("const x = 1")
  })

  it("strips headers", () => {
    expect(stripMarkdown("# Heading\nbody")).toBe("Heading\nbody")
  })

  it("strips blockquote markers", () => {
    expect(stripMarkdown("> quoted line")).toBe("quoted line")
  })
})
