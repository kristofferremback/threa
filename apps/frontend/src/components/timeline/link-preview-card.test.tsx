import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { LinkPreviewCard } from "./link-preview-card"
import type { LinkPreviewSummary } from "@threa/types"

describe("LinkPreviewCard", () => {
  it("renders GitHub file preview snippets from structured preview data", () => {
    const preview: LinkPreviewSummary = {
      id: "preview_1",
      url: "https://github.com/octocat/hello-world/blob/main/README.md#L1-L2",
      title: "README.md",
      description: "main · Markdown",
      imageUrl: null,
      faviconUrl: "https://github.com/favicon.ico",
      siteName: "GitHub",
      contentType: "website",
      previewType: "github_file",
      previewData: {
        type: "github_file",
        url: "https://github.com/octocat/hello-world/blob/main/README.md#L1-L2",
        fetchedAt: "2026-04-08T10:00:00.000Z",
        repository: {
          owner: "octocat",
          name: "hello-world",
          fullName: "octocat/hello-world",
          private: true,
        },
        data: {
          path: "README.md",
          language: "Markdown",
          ref: "main",
          renderMode: "snippet",
          markdownContent: null,
          startLine: 1,
          endLine: 2,
          truncated: false,
          lines: [
            { number: 1, text: "# Hello" },
            { number: 2, text: "world" },
          ],
        },
      },
      position: 0,
    }

    render(<LinkPreviewCard preview={preview} />)

    expect(screen.getByText("README.md")).toBeInTheDocument()
    expect(screen.getByText(/octocat\/hello-world/)).toBeInTheDocument()
    expect(screen.getByText(/L1-L2/)).toBeInTheDocument()
    expect(screen.getAllByText((_, node) => node?.textContent === "# Hello\nworld").length).toBeGreaterThan(0)
  })

  it("renders GitHub tree README previews as markdown content", () => {
    const preview: LinkPreviewSummary = {
      id: "preview_2",
      url: "https://github.com/octocat/hello-world/tree/main",
      title: "README.md",
      description: "main · Markdown",
      imageUrl: null,
      faviconUrl: "https://github.com/favicon.ico",
      siteName: "GitHub",
      contentType: "website",
      previewType: "github_file",
      previewData: {
        type: "github_file",
        url: "https://github.com/octocat/hello-world/tree/main",
        fetchedAt: "2026-04-08T10:00:00.000Z",
        repository: {
          owner: "octocat",
          name: "hello-world",
          fullName: "octocat/hello-world",
          private: true,
        },
        data: {
          path: "README.md",
          language: "Markdown",
          ref: "main",
          renderMode: "markdown",
          markdownContent: "# Hello\n\nworld",
          startLine: 1,
          endLine: 3,
          truncated: false,
          lines: [
            { number: 1, text: "# Hello" },
            { number: 2, text: "" },
            { number: 3, text: "world" },
          ],
        },
      },
      position: 0,
    }

    render(<LinkPreviewCard preview={preview} />)

    expect(screen.getByRole("heading", { name: "Hello" })).toBeInTheDocument()
    expect(screen.getByText("world")).toBeInTheDocument()
  })
})
