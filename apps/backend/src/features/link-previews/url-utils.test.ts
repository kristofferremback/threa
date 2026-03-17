import { describe, test, expect } from "bun:test"
import { normalizeUrl, extractUrls, detectContentType } from "./url-utils"

describe("normalizeUrl", () => {
  test("lowercases hostname", () => {
    expect(normalizeUrl("https://Example.COM/path")).toBe("https://example.com/path")
  })

  test("strips tracking parameters", () => {
    expect(normalizeUrl("https://example.com/page?utm_source=twitter&utm_medium=social&key=val")).toBe(
      "https://example.com/page?key=val"
    )
  })

  test("strips all tracking params when no other params remain", () => {
    expect(normalizeUrl("https://example.com/page?fbclid=abc&gclid=def")).toBe("https://example.com/page")
  })

  test("removes trailing slash from pathname", () => {
    expect(normalizeUrl("https://example.com/path/")).toBe("https://example.com/path")
  })

  test("keeps root slash", () => {
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/")
  })

  test("removes default HTTPS port", () => {
    expect(normalizeUrl("https://example.com:443/path")).toBe("https://example.com/path")
  })

  test("removes default HTTP port", () => {
    expect(normalizeUrl("http://example.com:80/path")).toBe("http://example.com/path")
  })

  test("keeps non-default ports", () => {
    expect(normalizeUrl("https://example.com:8080/path")).toBe("https://example.com:8080/path")
  })

  test("removes fragment", () => {
    expect(normalizeUrl("https://example.com/page#section")).toBe("https://example.com/page")
  })

  test("sorts remaining query params", () => {
    expect(normalizeUrl("https://example.com/page?z=1&a=2")).toBe("https://example.com/page?a=2&z=1")
  })

  test("returns lowercased input for invalid URLs", () => {
    expect(normalizeUrl("not-a-url")).toBe("not-a-url")
  })
})

describe("extractUrls", () => {
  test("extracts URLs from markdown links", () => {
    const md = "Check out [Google](https://google.com) and [GitHub](https://github.com)"
    expect(extractUrls(md)).toEqual(["https://google.com", "https://github.com"])
  })

  test("extracts bare URLs", () => {
    const md = "Visit https://example.com for more info"
    expect(extractUrls(md)).toEqual(["https://example.com"])
  })

  test("handles bare URLs with balanced parentheses (Wikipedia-style)", () => {
    const md = "See https://en.wikipedia.org/wiki/Foo_(bar) for details"
    expect(extractUrls(md)).toEqual(["https://en.wikipedia.org/wiki/Foo_(bar)"])
  })

  test("strips unbalanced trailing paren from bare URL in prose", () => {
    const md = "(see https://example.com/page)"
    expect(extractUrls(md)).toEqual(["https://example.com/page"])
  })

  test("handles nested balanced parens in bare URLs", () => {
    const md = "Check https://en.wikipedia.org/wiki/Foo_(bar_(baz)) now"
    expect(extractUrls(md)).toEqual(["https://en.wikipedia.org/wiki/Foo_(bar_(baz))"])
  })

  test("deduplicates by normalized URL", () => {
    const md = "Check [link](https://example.com/page?utm_source=twitter) and https://example.com/page"
    expect(extractUrls(md)).toEqual(["https://example.com/page?utm_source=twitter"])
  })

  test("skips attachment: links", () => {
    const md = "[file](attachment:abc123)"
    expect(extractUrls(md)).toEqual([])
  })

  test("skips mailto: and tel: links", () => {
    const md = "[email](mailto:foo@bar.com) [phone](tel:123)"
    expect(extractUrls(md)).toEqual([])
  })

  test("skips relative paths", () => {
    const md = "[local](/path/to/page)"
    expect(extractUrls(md)).toEqual([])
  })

  test("returns empty for no URLs", () => {
    expect(extractUrls("just plain text")).toEqual([])
  })

  test("handles mixed content", () => {
    const md = `
# Title
Some text with [a link](https://example.com/article) and more text.
Also see https://docs.example.com/guide for details.
[file](attachment:file_123)
    `
    expect(extractUrls(md)).toEqual(["https://example.com/article", "https://docs.example.com/guide"])
  })
})

describe("detectContentType", () => {
  test("detects image extensions", () => {
    expect(detectContentType("https://example.com/photo.jpg")).toBe("image")
    expect(detectContentType("https://example.com/photo.png")).toBe("image")
    expect(detectContentType("https://example.com/photo.gif")).toBe("image")
    expect(detectContentType("https://example.com/photo.webp")).toBe("image")
    expect(detectContentType("https://example.com/photo.svg")).toBe("image")
    expect(detectContentType("https://example.com/photo.avif")).toBe("image")
  })

  test("detects PDF", () => {
    expect(detectContentType("https://example.com/document.pdf")).toBe("pdf")
  })

  test("returns website for HTML and unknown extensions", () => {
    expect(detectContentType("https://example.com/page.html")).toBe("website")
    expect(detectContentType("https://example.com/page")).toBe("website")
    expect(detectContentType("https://example.com/")).toBe("website")
  })

  test("is case-insensitive", () => {
    expect(detectContentType("https://example.com/Photo.JPG")).toBe("image")
    expect(detectContentType("https://example.com/Doc.PDF")).toBe("pdf")
  })

  test("returns website for invalid URLs", () => {
    expect(detectContentType("not-a-url")).toBe("website")
  })
})
