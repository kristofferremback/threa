import { afterEach, describe, expect, mock, test } from "bun:test"
import { createLinkPreviewWorker, parseHtmlMeta } from "./worker"
import { GitHubPreviewTypes } from "@threa/types"

describe("parseHtmlMeta", () => {
  const baseUrl = "https://example.com/page"

  test("extracts OpenGraph tags", async () => {
    const html = `
      <html><head>
        <meta property="og:title" content="Test Title">
        <meta property="og:description" content="Test description text">
        <meta property="og:image" content="https://example.com/image.jpg">
        <meta property="og:site_name" content="Example Site">
      </head></html>
    `
    const result = await parseHtmlMeta(html, baseUrl)
    expect(result).toMatchObject({
      title: "Test Title",
      description: "Test description text",
      imageUrl: "https://example.com/image.jpg",
      siteName: "Example Site",
      contentType: "website",
      status: "completed",
    })
  })

  test("falls back to twitter:* tags", async () => {
    const html = `
      <html><head>
        <meta name="twitter:title" content="Twitter Title">
        <meta name="twitter:description" content="Twitter description">
        <meta name="twitter:image" content="https://example.com/tw.jpg">
      </head></html>
    `
    const result = await parseHtmlMeta(html, baseUrl)
    expect(result).toMatchObject({
      title: "Twitter Title",
      description: "Twitter description",
      imageUrl: "https://example.com/tw.jpg",
    })
  })

  test("falls back to <title> tag", async () => {
    const html = `
      <html><head>
        <title>Page Title</title>
      </head></html>
    `
    const result = await parseHtmlMeta(html, baseUrl)
    expect(result.title).toBe("Page Title")
  })

  test("falls back to meta description", async () => {
    const html = `
      <html><head>
        <meta name="description" content="Meta description">
      </head></html>
    `
    const result = await parseHtmlMeta(html, baseUrl)
    expect(result.description).toBe("Meta description")
  })

  test("resolves relative image URLs", async () => {
    const html = `
      <html><head>
        <meta property="og:image" content="/images/preview.jpg">
      </head></html>
    `
    const result = await parseHtmlMeta(html, baseUrl)
    expect(result.imageUrl).toBe("https://example.com/images/preview.jpg")
  })

  test("extracts favicon from link tag", async () => {
    const html = `
      <html><head>
        <link rel="icon" href="/custom-favicon.png">
      </head></html>
    `
    const result = await parseHtmlMeta(html, baseUrl)
    expect(result.faviconUrl).toBe("https://example.com/custom-favicon.png")
  })

  test("defaults favicon to /favicon.ico", async () => {
    const html = `<html><head></head></html>`
    const result = await parseHtmlMeta(html, baseUrl)
    expect(result.faviconUrl).toBe("https://example.com/favicon.ico")
  })

  test("handles apostrophes in double-quoted content attributes", async () => {
    const html = `
      <html><head>
        <meta property="og:title" content="McDonald's Restaurant Guide">
        <meta property="og:description" content="Tom's favorite spot">
      </head></html>
    `
    const result = await parseHtmlMeta(html, baseUrl)
    expect(result.title).toBe("McDonald's Restaurant Guide")
    expect(result.description).toBe("Tom's favorite spot")
  })

  test("handles double quotes in single-quoted content attributes", async () => {
    const html = `
      <html><head>
        <meta property='og:title' content='She said "hello"'>
      </head></html>
    `
    const result = await parseHtmlMeta(html, baseUrl)
    expect(result.title).toBe('She said "hello"')
  })

  test("decodes HTML entities", async () => {
    const html = `
      <html><head>
        <meta property="og:title" content="Tom &amp; Jerry&#039;s &quot;Show&quot;">
      </head></html>
    `
    const result = await parseHtmlMeta(html, baseUrl)
    expect(result.title).toBe('Tom & Jerry\'s "Show"')
  })

  test("truncates long titles", async () => {
    const longTitle = "A".repeat(500)
    const html = `
      <html><head>
        <meta property="og:title" content="${longTitle}">
      </head></html>
    `
    const result = await parseHtmlMeta(html, baseUrl)
    expect(result.title!.length).toBe(300)
  })

  test("truncates long descriptions", async () => {
    const longDesc = "B".repeat(1000)
    const html = `
      <html><head>
        <meta property="og:description" content="${longDesc}">
      </head></html>
    `
    const result = await parseHtmlMeta(html, baseUrl)
    expect(result.description!.length).toBe(500)
  })

  test("handles content before property in meta tag", async () => {
    const html = `
      <html><head>
        <meta content="Reversed Order" property="og:title">
      </head></html>
    `
    const result = await parseHtmlMeta(html, baseUrl)
    expect(result.title).toBe("Reversed Order")
  })

  test("returns null fields when no metadata found", async () => {
    const html = `<html><head></head></html>`
    const result = await parseHtmlMeta(html, baseUrl)
    expect(result.title).toBeNull()
    expect(result.description).toBeNull()
    expect(result.imageUrl).toBeNull()
    expect(result.siteName).toBeNull()
    expect(result.status).toBe("completed")
  })

  test("og:* tags take priority over twitter:* tags", async () => {
    const html = `
      <html><head>
        <meta property="og:title" content="OG Title">
        <meta name="twitter:title" content="Twitter Title">
        <meta property="og:description" content="OG Description">
        <meta name="twitter:description" content="Twitter Description">
      </head></html>
    `
    const result = await parseHtmlMeta(html, baseUrl)
    expect(result.title).toBe("OG Title")
    expect(result.description).toBe("OG Description")
  })
})

describe("createLinkPreviewWorker", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    mock.restore()
  })

  test("keeps existing rich GitHub previews when refresh falls back from GitHub", async () => {
    const fetchMock = mock(async () => {
      throw new Error("generic fetch should not run when rich preview data already exists")
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const completePreviewsAndPublish = mock(async () => {})
    const worker = createLinkPreviewWorker({
      linkPreviewService: {
        extractAndCreatePending: mock(async () => [
          { id: "lp_123", url: "https://github.com/octocat/hello-world/pull/42" },
        ]),
        getPreviewById: mock(async () => ({
          id: "lp_123",
          workspaceId: "ws_123",
          url: "https://github.com/octocat/hello-world/pull/42",
          normalizedUrl: "https://github.com/octocat/hello-world/pull/42",
          title: "PR #42: Ship the thing",
          description: "Open",
          imageUrl: null,
          faviconUrl: "https://github.com/favicon.ico",
          siteName: "GitHub",
          contentType: "website",
          status: "completed",
          previewType: GitHubPreviewTypes.PR,
          previewData: {
            type: GitHubPreviewTypes.PR,
            url: "https://github.com/octocat/hello-world/pull/42",
            repository: {
              owner: "octocat",
              name: "hello-world",
              fullName: "octocat/hello-world",
              private: true,
            },
            data: {
              title: "Ship the thing",
              number: 42,
              state: "open",
              author: { login: "kris", avatarUrl: null },
              baseBranch: "main",
              headBranch: "feature",
              additions: 1,
              deletions: 1,
              reviewStatusSummary: {
                approvals: 0,
                changesRequested: 0,
                comments: 0,
                pendingReviewers: 0,
              },
              createdAt: "2026-04-07T10:00:00.000Z",
              updatedAt: "2026-04-07T10:00:00.000Z",
            },
            fetchedAt: "2026-04-07T10:00:00.000Z",
          },
          targetWorkspaceId: null,
          targetStreamId: null,
          targetMessageId: null,
          fetchedAt: new Date("2026-04-07T10:00:00.000Z"),
          expiresAt: new Date("2026-04-07T10:05:00.000Z"),
          createdAt: new Date("2026-04-07T10:00:00.000Z"),
        })),
        completePreviewsAndPublish,
        replacePreviewsForMessage: mock(async () => []),
        publishEmptyPreviews: mock(async () => {}),
      } as any,
      workspaceIntegrationService: {
        getGithubPreviewClient: mock(async () => null),
      } as any,
    })

    await worker({
      id: "job_123",
      name: "link_preview.extract",
      data: {
        workspaceId: "ws_123",
        streamId: "stream_123",
        messageId: "msg_123",
        contentMarkdown: "https://github.com/octocat/hello-world/pull/42",
      },
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(completePreviewsAndPublish).toHaveBeenCalledWith(
      "ws_123",
      "stream_123",
      "msg_123",
      [{ id: "lp_123", skipped: true }],
      { forcePublish: undefined }
    )
  })

  test("upgrades cached generic GitHub previews to rich previews when integration is available", async () => {
    const completePreviewsAndPublish = mock(async () => {})
    const worker = createLinkPreviewWorker({
      linkPreviewService: {
        extractAndCreatePending: mock(async () => [
          { id: "lp_123", url: "https://github.com/octocat/hello-world/tree/main" },
        ]),
        getPreviewById: mock(async () => ({
          id: "lp_123",
          workspaceId: "ws_123",
          url: "https://github.com/octocat/hello-world/tree/main",
          normalizedUrl: "https://github.com/octocat/hello-world/tree/main",
          title: "Build software better, together",
          description: "Generic GitHub OGP",
          imageUrl: "https://github.com/image.png",
          faviconUrl: "https://github.com/favicon.ico",
          siteName: "GitHub",
          contentType: "website",
          status: "completed",
          previewType: null,
          previewData: null,
          targetWorkspaceId: null,
          targetStreamId: null,
          targetMessageId: null,
          fetchedAt: new Date("2026-04-07T10:00:00.000Z"),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          createdAt: new Date("2026-04-07T10:00:00.000Z"),
        })),
        completePreviewsAndPublish,
        replacePreviewsForMessage: mock(async () => []),
        publishEmptyPreviews: mock(async () => {}),
      } as any,
      workspaceIntegrationService: {
        getGithubPreviewClient: mock(async () => ({
          async request(route: string, params?: Record<string, unknown>) {
            if (route === "GET /repos/{owner}/{repo}") {
              return {
                owner: { login: "octocat" },
                name: "hello-world",
                full_name: "octocat/hello-world",
                private: true,
              }
            }

            if (route === "GET /repos/{owner}/{repo}/contents/{path}") {
              if (params?.path === "README.md" && params?.ref === "main") {
                return {
                  type: "file",
                  content: Buffer.from("# Hello\nworld").toString("base64"),
                }
              }
            }

            throw new Error(`Unexpected route: ${route}`)
          },
        })),
      } as any,
    })

    await worker({
      id: "job_123",
      name: "link_preview.extract",
      data: {
        workspaceId: "ws_123",
        streamId: "stream_123",
        messageId: "msg_123",
        contentMarkdown: "https://github.com/octocat/hello-world/tree/main",
      },
    })

    expect(completePreviewsAndPublish).toHaveBeenCalledWith(
      "ws_123",
      "stream_123",
      "msg_123",
      [
        expect.objectContaining({
          id: "lp_123",
          skipped: false,
          overwrite: true,
          metadata: expect.objectContaining({
            previewType: GitHubPreviewTypes.FILE,
            title: "README.md",
          }),
        }),
      ],
      { forcePublish: undefined }
    )
  })
})
