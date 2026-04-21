import { describe, it, expect } from "bun:test"
import { createGithubListCommitsTool, createGithubGetCommitTool } from "./commits"
import { createGithubGetFileContentsTool } from "./content"
import { createGithubGetPullRequestTool, createGithubListPrFilesTool } from "./pull-requests"
import { createGithubGetWorkflowRunTool } from "./workflows"
import type { GitHubToolDeps } from "./deps"
import type { WorkspaceIntegrationService } from "../../../workspace-integrations"

type RequestFn = (route: string, params?: Record<string, unknown>) => Promise<unknown>

function makeDeps(request: RequestFn | null): GitHubToolDeps {
  const workspaceIntegrationService = {
    async getGithubClient() {
      if (!request) return null
      return { request }
    },
  } as unknown as WorkspaceIntegrationService

  return { workspaceId: "ws_test", workspaceIntegrationService }
}

const toolOpts = { toolCallId: "test" }

describe("github_list_commits", () => {
  it("returns the not-connected error when GitHub is not installed", async () => {
    const tool = createGithubListCommitsTool(makeDeps(null))
    const { output } = await tool.config.execute({ owner: "o", repo: "r", page: 1, perPage: 20 }, toolOpts)
    const parsed = JSON.parse(output)
    expect(parsed.code).toBe("GITHUB_NOT_CONNECTED")
  })

  it("maps commit responses and builds github sources", async () => {
    const request: RequestFn = async (route) => {
      expect(route).toBe("GET /repos/{owner}/{repo}/commits")
      return [
        {
          sha: "abc1234def",
          commit: {
            message: "Fix authentication bug\n\nDetails follow",
            author: { date: "2026-04-20T10:00:00Z" },
          },
          author: { login: "octocat", html_url: "https://github.com/octocat" },
          html_url: "https://github.com/o/r/commit/abc1234def",
        },
      ]
    }
    const tool = createGithubListCommitsTool(makeDeps(request))
    const result = await tool.config.execute({ owner: "o", repo: "r", page: 1, perPage: 20 }, toolOpts)
    const parsed = JSON.parse(result.output)
    expect(parsed.count).toBe(1)
    expect(parsed.commits[0].shortSha).toBe("abc1234")
    expect(parsed.commits[0].message).toBe("Fix authentication bug")
    expect(parsed.commits[0].author.login).toBe("octocat")
    expect(result.sources?.[0].type).toBe("github")
    expect(result.sources?.[0].url).toContain("abc1234")
  })

  it("maps 404 responses to GITHUB_NOT_FOUND", async () => {
    const request: RequestFn = async () => {
      const err = new Error("Not Found") as Error & { status: number }
      err.status = 404
      throw err
    }
    const tool = createGithubListCommitsTool(makeDeps(request))
    const { output } = await tool.config.execute({ owner: "o", repo: "r", page: 1, perPage: 20 }, toolOpts)
    const parsed = JSON.parse(output)
    expect(parsed.code).toBe("GITHUB_NOT_FOUND")
  })
})

describe("github_get_commit", () => {
  it("truncates large file patches and reports sizes", async () => {
    const bigPatch = "+".repeat(50_000)
    const request: RequestFn = async (route) => {
      expect(route).toBe("GET /repos/{owner}/{repo}/commits/{ref}")
      return {
        sha: "abc1234def",
        commit: { message: "big commit", author: { date: "2026-04-20T10:00:00Z" } },
        html_url: "https://github.com/o/r/commit/abc1234def",
        files: [{ filename: "a.ts", status: "modified", additions: 100, deletions: 0, patch: bigPatch }],
        stats: { additions: 100, deletions: 0, total: 100 },
      }
    }
    const tool = createGithubGetCommitTool(makeDeps(request))
    const result = await tool.config.execute({ owner: "o", repo: "r", ref: "abc1234", includeFiles: true }, toolOpts)
    const parsed = JSON.parse(result.output)
    const patch = parsed.commit.files.items[0].patch
    expect(patch.truncated).toBe(true)
    expect(patch.totalBytes).toBe(50_000)
    expect(patch.text.length).toBeLessThan(50_000)
  })
})

describe("github_get_file_contents", () => {
  it("decodes base64 content and honors line ranges", async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n")
    const base64 = Buffer.from(lines, "utf8").toString("base64")
    const request: RequestFn = async (route) => {
      expect(route).toBe("GET /repos/{owner}/{repo}/contents/{path}")
      return {
        type: "file",
        path: "src/auth.ts",
        content: base64,
        sha: "file-sha",
        size: lines.length,
        html_url: "https://github.com/o/r/blob/main/src/auth.ts",
      }
    }
    const tool = createGithubGetFileContentsTool(makeDeps(request))
    const result = await tool.config.execute(
      { owner: "o", repo: "r", path: "src/auth.ts", fromLine: 3, toLine: 5 },
      toolOpts
    )
    const parsed = JSON.parse(result.output)
    expect(parsed.file.startLine).toBe(3)
    expect(parsed.file.endLine).toBe(5)
    expect(parsed.file.content).toBe("line 3\nline 4\nline 5")
    expect(parsed.file.totalLines).toBe(10)
    expect(result.sources?.[0].type).toBe("github")
  })

  it("reports binary files without returning content", async () => {
    const binary = "\x00\x01\x02hello"
    const base64 = Buffer.from(binary, "utf8").toString("base64")
    const request: RequestFn = async () => ({ type: "file", path: "x", content: base64 })
    const tool = createGithubGetFileContentsTool(makeDeps(request))
    const result = await tool.config.execute({ owner: "o", repo: "r", path: "x" }, toolOpts)
    const parsed = JSON.parse(result.output)
    expect(parsed.code).toBe("BINARY")
  })
})

describe("github_get_pull_request", () => {
  it("fetches PR, reviews, and commits concurrently and summarizes reviews", async () => {
    const calls: string[] = []
    const request: RequestFn = async (route) => {
      calls.push(route)
      switch (route) {
        case "GET /repos/{owner}/{repo}/pulls/{pull_number}":
          return {
            number: 42,
            title: "Refactor auth",
            state: "open",
            body: "This touches AuthService and SessionRepo.",
            user: { login: "octocat", html_url: "https://github.com/octocat" },
            base: { ref: "main" },
            head: { ref: "refactor-auth" },
            additions: 100,
            deletions: 40,
            changed_files: 5,
            commits: 3,
            html_url: "https://github.com/o/r/pull/42",
            requested_reviewers: [{}],
            requested_teams: [],
          }
        case "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews":
          return [
            { user: { login: "alice" }, state: "APPROVED" },
            { user: { login: "bob" }, state: "CHANGES_REQUESTED" },
            { user: { login: "alice" }, state: "APPROVED" },
          ]
        case "GET /repos/{owner}/{repo}/pulls/{pull_number}/commits":
          return [{ sha: "aaa1111222", commit: { message: "one", author: { date: "2026-04-20T10:00:00Z" } } }]
        default:
          throw new Error(`unexpected route: ${route}`)
      }
    }
    const tool = createGithubGetPullRequestTool(makeDeps(request))
    const result = await tool.config.execute({ owner: "o", repo: "r", number: 42 }, toolOpts)
    const parsed = JSON.parse(result.output)
    expect(calls).toHaveLength(3)
    expect(parsed.pullRequest.number).toBe(42)
    expect(parsed.pullRequest.reviews.approvals).toBe(1)
    expect(parsed.pullRequest.reviews.changesRequested).toBe(1)
    expect(parsed.pullRequest.reviews.pendingReviewers).toBe(1)
    expect(result.sources?.[0].url).toBe("https://github.com/o/r/pull/42")
  })
})

describe("github_list_pr_files", () => {
  it("truncates per-file patches over the byte cap", async () => {
    const bigPatch = "+".repeat(30_000)
    const request: RequestFn = async () => [
      { filename: "a.ts", status: "modified", additions: 1, deletions: 0, patch: bigPatch },
      { filename: "b.ts", status: "added", additions: 1, deletions: 0 },
    ]
    const tool = createGithubListPrFilesTool(makeDeps(request))
    const { output } = await tool.config.execute(
      { owner: "o", repo: "r", number: 1, includePatches: true, perPage: 30, page: 1 },
      toolOpts
    )
    const parsed = JSON.parse(output)
    expect(parsed.files[0].patch.truncated).toBe(true)
    expect(parsed.files[1].patch).toBeNull()
  })
})

describe("github_get_workflow_run", () => {
  it("fetches failed job logs only and returns tail", async () => {
    const longLog = "log line\n".repeat(5_000)
    const request: RequestFn = async (route, params) => {
      switch (route) {
        case "GET /repos/{owner}/{repo}/actions/runs/{run_id}":
          return {
            id: 1,
            name: "CI",
            workflow_id: 9,
            event: "push",
            status: "completed",
            conclusion: "failure",
            html_url: "https://github.com/o/r/actions/runs/1",
            run_number: 10,
          }
        case "GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs":
          return {
            jobs: [
              { id: 101, name: "build", status: "completed", conclusion: "success" },
              { id: 102, name: "test", status: "completed", conclusion: "failure" },
            ],
          }
        case "GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs": {
          expect(params?.job_id).toBe(102)
          return longLog
        }
        default:
          throw new Error(`unexpected route ${route}`)
      }
    }
    const tool = createGithubGetWorkflowRunTool(makeDeps(request))
    const result = await tool.config.execute({ owner: "o", repo: "r", runId: 1, includeFailedJobLogs: true }, toolOpts)
    const parsed = JSON.parse(result.output)
    const successJob = parsed.run.jobs.find((j: any) => j.name === "build")
    const failedJob = parsed.run.jobs.find((j: any) => j.name === "test")
    expect(successJob.logs).toBeNull()
    expect(failedJob.logs.truncated).toBe(true)
    expect(Buffer.byteLength(failedJob.logs.tail, "utf8")).toBeLessThanOrEqual(12_000)
    expect(failedJob.logs.totalBytes).toBe(Buffer.byteLength(longLog, "utf8"))
    expect(parsed.run.failedJobCount).toBe(1)
  })
})
