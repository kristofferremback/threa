import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { LinkPreviewCard } from "./link-preview-card"
import type { LinkPreviewSummary } from "@threa/types"

function makeGitHubPreview(overrides: Partial<LinkPreviewSummary> = {}): LinkPreviewSummary {
  return {
    id: "preview_1",
    url: "https://github.com/octocat/hello-world",
    title: null,
    description: null,
    imageUrl: null,
    faviconUrl: "https://github.com/favicon.ico",
    siteName: "GitHub",
    contentType: "website",
    previewType: null,
    previewData: null,
    position: 0,
    ...overrides,
  }
}

describe("LinkPreviewCard", () => {
  it("renders GitHub file preview snippets from structured preview data", () => {
    const preview = makeGitHubPreview({
      url: "https://github.com/octocat/hello-world/blob/main/README.md#L1-L2",
      title: "README.md",
      previewType: "github_file",
      previewData: {
        type: "github_file",
        url: "https://github.com/octocat/hello-world/blob/main/README.md#L1-L2",
        fetchedAt: "2026-04-08T10:00:00.000Z",
        repository: { owner: "octocat", name: "hello-world", fullName: "octocat/hello-world", private: true },
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
    })

    render(<LinkPreviewCard preview={preview} />)

    expect(screen.getByText("README.md")).toBeInTheDocument()
    expect(screen.getAllByText(/octocat\/hello-world/).length).toBeGreaterThan(0)
    expect(screen.getByText(/L1-L2/)).toBeInTheDocument()
    expect(screen.getAllByText((_, node) => node?.textContent === "# Hello\nworld").length).toBeGreaterThan(0)
  })

  it("renders GitHub tree README previews as markdown content", () => {
    const preview = makeGitHubPreview({
      url: "https://github.com/octocat/hello-world/tree/main",
      title: "README.md",
      previewType: "github_file",
      previewData: {
        type: "github_file",
        url: "https://github.com/octocat/hello-world/tree/main",
        fetchedAt: "2026-04-08T10:00:00.000Z",
        repository: { owner: "octocat", name: "hello-world", fullName: "octocat/hello-world", private: true },
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
    })

    render(<LinkPreviewCard preview={preview} />)

    expect(screen.getByRole("heading", { name: "Hello" })).toBeInTheDocument()
    expect(screen.getByText("world")).toBeInTheDocument()
  })

  it("renders GitHub PR preview with state badge and diff stats", () => {
    const preview = makeGitHubPreview({
      url: "https://github.com/octocat/hello-world/pull/42",
      title: "Add feature",
      previewType: "github_pr",
      previewData: {
        type: "github_pr",
        url: "https://github.com/octocat/hello-world/pull/42",
        fetchedAt: "2026-04-08T10:00:00.000Z",
        repository: { owner: "octocat", name: "hello-world", fullName: "octocat/hello-world", private: false },
        data: {
          title: "Add feature",
          number: 42,
          state: "open",
          author: { login: "octocat", avatarUrl: null },
          baseBranch: "main",
          headBranch: "feature-branch",
          additions: 120,
          deletions: 30,
          reviewStatusSummary: { approvals: 1, changesRequested: 0, comments: 2, pendingReviewers: 0 },
          createdAt: "2026-04-01T10:00:00.000Z",
          updatedAt: "2026-04-08T10:00:00.000Z",
        },
      },
    })

    render(<LinkPreviewCard preview={preview} />)

    expect(screen.getByText(/Add feature/)).toBeInTheDocument()
    expect(screen.getByText("#42")).toBeInTheDocument()
    expect(screen.getByText("Open")).toBeInTheDocument()
    expect(screen.getByText("+120")).toBeInTheDocument()
    expect(screen.getByText("-30")).toBeInTheDocument()
    expect(screen.getByText("1 approved")).toBeInTheDocument()
    expect(screen.getByText(/octocat\/hello-world/)).toBeInTheDocument()
  })

  it("renders GitHub issue preview with labels", () => {
    const preview = makeGitHubPreview({
      url: "https://github.com/octocat/hello-world/issues/7",
      title: "Bug report",
      previewType: "github_issue",
      previewData: {
        type: "github_issue",
        url: "https://github.com/octocat/hello-world/issues/7",
        fetchedAt: "2026-04-08T10:00:00.000Z",
        repository: { owner: "octocat", name: "hello-world", fullName: "octocat/hello-world", private: false },
        data: {
          title: "Bug report",
          number: 7,
          state: "open",
          author: { login: "dev", avatarUrl: null },
          labels: [{ name: "bug", color: "d73a4a", description: null }],
          assignees: [],
          commentCount: 3,
          createdAt: "2026-04-01T10:00:00.000Z",
          updatedAt: "2026-04-08T10:00:00.000Z",
        },
      },
    })

    render(<LinkPreviewCard preview={preview} />)

    expect(screen.getByText(/Bug report/)).toBeInTheDocument()
    expect(screen.getByText("#7")).toBeInTheDocument()
    expect(screen.getByText("Open")).toBeInTheDocument()
    expect(screen.getByText("bug")).toBeInTheDocument()
    expect(screen.getByText("3")).toBeInTheDocument()
  })

  it("renders GitHub commit preview with SHA and diff stats", () => {
    const preview = makeGitHubPreview({
      url: "https://github.com/octocat/hello-world/commit/abc1234",
      title: "Fix typo in README",
      previewType: "github_commit",
      previewData: {
        type: "github_commit",
        url: "https://github.com/octocat/hello-world/commit/abc1234",
        fetchedAt: "2026-04-08T10:00:00.000Z",
        repository: { owner: "octocat", name: "hello-world", fullName: "octocat/hello-world", private: false },
        data: {
          message: "Fix typo in README\n\nCorrected a spelling mistake",
          shortSha: "abc1234",
          author: { login: "octocat", avatarUrl: null },
          committedAt: "2026-04-07T10:00:00.000Z",
          filesChanged: 1,
          additions: 1,
          deletions: 1,
        },
      },
    })

    render(<LinkPreviewCard preview={preview} />)

    expect(screen.getByText("Fix typo in README")).toBeInTheDocument()
    expect(screen.getByText("abc1234")).toBeInTheDocument()
    expect(screen.getByText("1 file")).toBeInTheDocument()
    expect(screen.getByText("+1")).toBeInTheDocument()
    expect(screen.getByText("-1")).toBeInTheDocument()
  })

  it("renders GitHub comment preview with parent context", () => {
    const preview = makeGitHubPreview({
      url: "https://github.com/octocat/hello-world/issues/7#issuecomment-123",
      title: "Comment on #7",
      previewType: "github_comment",
      previewData: {
        type: "github_comment",
        url: "https://github.com/octocat/hello-world/issues/7#issuecomment-123",
        fetchedAt: "2026-04-08T10:00:00.000Z",
        repository: { owner: "octocat", name: "hello-world", fullName: "octocat/hello-world", private: false },
        data: {
          body: "Looks good to me!",
          truncated: false,
          author: { login: "reviewer", avatarUrl: null },
          createdAt: "2026-04-08T10:00:00.000Z",
          parent: { kind: "issue", title: "Bug report", number: 7 },
        },
      },
    })

    render(<LinkPreviewCard preview={preview} />)

    expect(screen.getByText("reviewer")).toBeInTheDocument()
    expect(screen.getByText(/commented on/)).toBeInTheDocument()
    expect(screen.getByText(/Issue #7/)).toBeInTheDocument()
    expect(screen.getByText("Looks good to me!")).toBeInTheDocument()
  })
})
