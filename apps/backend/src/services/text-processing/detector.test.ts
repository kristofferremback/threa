import { describe, test, expect } from "bun:test"
import { isBinaryFile, normalizeEncoding, inferFormat } from "./detector"
import { isTextAttachment } from "./config"

describe("isBinaryFile", () => {
  test("should detect text files as non-binary", () => {
    const textContent = Buffer.from("Hello, this is plain text content.\nWith multiple lines.\n")
    expect(isBinaryFile(textContent)).toBe(false)
  })

  test("should detect files with null bytes as binary", () => {
    const binaryContent = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x00, 0x00, 0x57, 0x6f, 0x72, 0x6c, 0x64])
    expect(isBinaryFile(binaryContent)).toBe(true)
  })

  test("should detect PNG header as binary", () => {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(isBinaryFile(pngHeader)).toBe(true)
  })

  test("should handle empty buffer", () => {
    const empty = Buffer.from([])
    expect(isBinaryFile(empty)).toBe(false)
  })

  test("should handle JSON content as text", () => {
    const json = Buffer.from('{"key": "value", "number": 123}')
    expect(isBinaryFile(json)).toBe(false)
  })
})

describe("normalizeEncoding", () => {
  test("should handle UTF-8 without BOM", () => {
    const content = Buffer.from("Hello World")
    const result = normalizeEncoding(content)
    expect(result.text).toBe("Hello World")
    expect(result.encoding).toBe("utf-8")
  })

  test("should handle UTF-8 with BOM", () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf])
    const content = Buffer.concat([bom, Buffer.from("Hello World")])
    const result = normalizeEncoding(content)
    expect(result.text).toBe("Hello World")
    expect(result.encoding).toBe("utf-8-bom")
  })

  test("should handle UTF-16 LE with BOM", () => {
    const bom = Buffer.from([0xff, 0xfe])
    // "Hi" in UTF-16 LE
    const content = Buffer.concat([bom, Buffer.from([0x48, 0x00, 0x69, 0x00])])
    const result = normalizeEncoding(content)
    expect(result.text).toBe("Hi")
    expect(result.encoding).toBe("utf-16le")
  })
})

describe("inferFormat", () => {
  test("should detect markdown from extension", () => {
    expect(inferFormat("readme.md", "# Hello")).toBe("markdown")
    expect(inferFormat("docs.markdown", "# Hello")).toBe("markdown")
  })

  test("should detect JSON from extension", () => {
    expect(inferFormat("config.json", '{"key": "value"}')).toBe("json")
  })

  test("should detect YAML from extension", () => {
    expect(inferFormat("config.yaml", "key: value")).toBe("yaml")
    expect(inferFormat("config.yml", "key: value")).toBe("yaml")
  })

  test("should detect CSV from extension", () => {
    expect(inferFormat("data.csv", "a,b,c\n1,2,3")).toBe("csv")
  })

  test("should detect code from extension", () => {
    expect(inferFormat("app.ts", "export function foo() {}")).toBe("code")
    expect(inferFormat("main.py", "def foo(): pass")).toBe("code")
    expect(inferFormat("server.go", "package main")).toBe("code")
  })

  test("should fall back to content heuristics for JSON", () => {
    expect(inferFormat("unknown.txt", '{"key": "value"}')).toBe("json")
    expect(inferFormat("data", '[{"id": 1}]')).toBe("json")
  })

  test("should fall back to content heuristics for YAML", () => {
    expect(inferFormat("unknown.txt", "---\nkey: value\nother: data")).toBe("yaml")
  })

  test("should fall back to content heuristics for markdown", () => {
    expect(inferFormat("unknown.txt", "# Title\n\nSome content")).toBe("markdown")
  })

  test("should default to plain for unknown format", () => {
    expect(inferFormat("unknown.txt", "Just some random text")).toBe("plain")
    expect(inferFormat("file.xyz", "Random content")).toBe("plain")
  })
})

describe("isTextAttachment", () => {
  test("should identify text mime types", () => {
    expect(isTextAttachment("text/plain", "file.txt")).toBe(true)
    expect(isTextAttachment("text/markdown", "file.md")).toBe(true)
    expect(isTextAttachment("text/csv", "data.csv")).toBe(true)
  })

  test("should identify application/json as text", () => {
    expect(isTextAttachment("application/json", "config.json")).toBe(true)
  })

  test("should identify code files by extension", () => {
    expect(isTextAttachment("application/octet-stream", "app.ts")).toBe(true)
    expect(isTextAttachment("application/octet-stream", "main.py")).toBe(true)
    expect(isTextAttachment("application/octet-stream", "server.go")).toBe(true)
  })

  test("should identify config files by extension", () => {
    expect(isTextAttachment("application/octet-stream", ".env")).toBe(true)
    expect(isTextAttachment("application/octet-stream", "config.toml")).toBe(true)
  })

  test("should identify README and similar files without extension", () => {
    expect(isTextAttachment("application/octet-stream", "README")).toBe(true)
    expect(isTextAttachment("application/octet-stream", "LICENSE")).toBe(true)
    expect(isTextAttachment("application/octet-stream", "Makefile")).toBe(true)
  })

  test("should reject obvious binary types", () => {
    expect(isTextAttachment("image/png", "photo.png")).toBe(false)
    expect(isTextAttachment("application/pdf", "doc.pdf")).toBe(false)
  })

  test("should reject unknown binary files", () => {
    expect(isTextAttachment("application/octet-stream", "unknown.exe")).toBe(false)
    expect(isTextAttachment("application/octet-stream", "archive.zip")).toBe(false)
  })
})
