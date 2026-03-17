import { describe, test, expect } from "bun:test"
import { parseHtmlMeta } from "./worker"

describe("parseHtmlMeta", () => {
  const baseUrl = "https://example.com/page"

  test("extracts OpenGraph tags", () => {
    const html = `
      <html><head>
        <meta property="og:title" content="Test Title">
        <meta property="og:description" content="Test description text">
        <meta property="og:image" content="https://example.com/image.jpg">
        <meta property="og:site_name" content="Example Site">
      </head></html>
    `
    const result = parseHtmlMeta(html, baseUrl)
    expect(result).toMatchObject({
      title: "Test Title",
      description: "Test description text",
      imageUrl: "https://example.com/image.jpg",
      siteName: "Example Site",
      contentType: "website",
      status: "completed",
    })
  })

  test("falls back to twitter:* tags", () => {
    const html = `
      <html><head>
        <meta name="twitter:title" content="Twitter Title">
        <meta name="twitter:description" content="Twitter description">
        <meta name="twitter:image" content="https://example.com/tw.jpg">
      </head></html>
    `
    const result = parseHtmlMeta(html, baseUrl)
    expect(result).toMatchObject({
      title: "Twitter Title",
      description: "Twitter description",
      imageUrl: "https://example.com/tw.jpg",
    })
  })

  test("falls back to <title> tag", () => {
    const html = `
      <html><head>
        <title>Page Title</title>
      </head></html>
    `
    const result = parseHtmlMeta(html, baseUrl)
    expect(result.title).toBe("Page Title")
  })

  test("falls back to meta description", () => {
    const html = `
      <html><head>
        <meta name="description" content="Meta description">
      </head></html>
    `
    const result = parseHtmlMeta(html, baseUrl)
    expect(result.description).toBe("Meta description")
  })

  test("resolves relative image URLs", () => {
    const html = `
      <html><head>
        <meta property="og:image" content="/images/preview.jpg">
      </head></html>
    `
    const result = parseHtmlMeta(html, baseUrl)
    expect(result.imageUrl).toBe("https://example.com/images/preview.jpg")
  })

  test("extracts favicon from link tag", () => {
    const html = `
      <html><head>
        <link rel="icon" href="/custom-favicon.png">
      </head></html>
    `
    const result = parseHtmlMeta(html, baseUrl)
    expect(result.faviconUrl).toBe("https://example.com/custom-favicon.png")
  })

  test("defaults favicon to /favicon.ico", () => {
    const html = `<html><head></head></html>`
    const result = parseHtmlMeta(html, baseUrl)
    expect(result.faviconUrl).toBe("https://example.com/favicon.ico")
  })

  test("handles apostrophes in double-quoted content attributes", () => {
    const html = `
      <html><head>
        <meta property="og:title" content="McDonald's Restaurant Guide">
        <meta property="og:description" content="Tom's favorite spot">
      </head></html>
    `
    const result = parseHtmlMeta(html, baseUrl)
    expect(result.title).toBe("McDonald's Restaurant Guide")
    expect(result.description).toBe("Tom's favorite spot")
  })

  test("handles double quotes in single-quoted content attributes", () => {
    const html = `
      <html><head>
        <meta property='og:title' content='She said "hello"'>
      </head></html>
    `
    const result = parseHtmlMeta(html, baseUrl)
    expect(result.title).toBe('She said "hello"')
  })

  test("decodes HTML entities", () => {
    const html = `
      <html><head>
        <meta property="og:title" content="Tom &amp; Jerry&#039;s &quot;Show&quot;">
      </head></html>
    `
    const result = parseHtmlMeta(html, baseUrl)
    expect(result.title).toBe('Tom & Jerry\'s "Show"')
  })

  test("truncates long titles", () => {
    const longTitle = "A".repeat(500)
    const html = `
      <html><head>
        <meta property="og:title" content="${longTitle}">
      </head></html>
    `
    const result = parseHtmlMeta(html, baseUrl)
    expect(result.title!.length).toBe(300)
  })

  test("truncates long descriptions", () => {
    const longDesc = "B".repeat(1000)
    const html = `
      <html><head>
        <meta property="og:description" content="${longDesc}">
      </head></html>
    `
    const result = parseHtmlMeta(html, baseUrl)
    expect(result.description!.length).toBe(500)
  })

  test("handles content before property in meta tag", () => {
    const html = `
      <html><head>
        <meta content="Reversed Order" property="og:title">
      </head></html>
    `
    const result = parseHtmlMeta(html, baseUrl)
    expect(result.title).toBe("Reversed Order")
  })

  test("returns null fields when no metadata found", () => {
    const html = `<html><head></head></html>`
    const result = parseHtmlMeta(html, baseUrl)
    expect(result.title).toBeNull()
    expect(result.description).toBeNull()
    expect(result.imageUrl).toBeNull()
    expect(result.siteName).toBeNull()
    expect(result.status).toBe("completed")
  })
})
