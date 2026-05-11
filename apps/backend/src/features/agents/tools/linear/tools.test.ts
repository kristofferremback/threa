import { describe, expect, test } from "bun:test"
import { createLinearGetIssueTool, createLinearGetProjectTool, createLinearListIssuesTool } from "./index"
import type { LinearToolDeps } from "./deps"

function deps(handler: (query: string, variables: Record<string, unknown>) => unknown): LinearToolDeps {
  return {
    workspaceId: "ws_123",
    async getClient() {
      return {
        async request(query: string, variables: Record<string, unknown> = {}) {
          return handler(query, variables)
        },
      } as any
    },
  }
}

describe("linear_get_issue", () => {
  test("returns issue detail with truncated description and comments", async () => {
    const tool = createLinearGetIssueTool(
      deps((_query, variables) => {
        expect(variables).toEqual({ id: "ENG-123", commentsFirst: 20 })
        return {
          issue: {
            identifier: "ENG-123",
            title: "Ship Linear tools",
            url: "https://linear.app/threa/issue/ENG-123/ship-linear-tools",
            description: "x".repeat(9_000),
            priority: 2,
            priorityLabel: "High",
            estimate: 3,
            dueDate: "2026-06-01",
            createdAt: "2026-05-01T10:00:00Z",
            updatedAt: "2026-05-02T10:00:00Z",
            state: { name: "In Progress", type: "started", color: "#5E6AD2" },
            assignee: { id: "u_1", name: "Kris", displayName: "Kris", email: "kris@example.com" },
            creator: { id: "u_2", name: "Ariadne", displayName: "Ariadne", email: null },
            team: { key: "ENG", name: "Engineering" },
            project: { id: "prj_1", name: "Integrations", url: "https://linear.app/threa/project/integrations" },
            labels: { nodes: [{ name: "integration", color: "#5E6AD2" }] },
            comments: {
              nodes: [
                {
                  id: "c_1",
                  url: "https://linear.app/threa/issue/ENG-123/title#comment-c1",
                  body: "Looks good",
                  createdAt: "2026-05-02T11:00:00Z",
                  updatedAt: "2026-05-02T11:00:00Z",
                  user: { id: "u_3", name: "Reviewer", displayName: "Reviewer", email: null },
                },
              ],
            },
          },
        }
      })
    )

    const result = await tool.config.execute({ id: "ENG-123", includeComments: true }, { toolCallId: "call_1" })
    const output = JSON.parse(result.output)
    expect(output.issue.identifier).toBe("ENG-123")
    expect(output.issue.description.truncated).toBe(true)
    expect(output.issue.comments).toHaveLength(1)
    expect(result.sources).toEqual([
      {
        type: "web",
        title: "ENG-123: Ship Linear tools",
        url: "https://linear.app/threa/issue/ENG-123/ship-linear-tools",
      },
    ])
  })
})

describe("linear_list_issues", () => {
  test("lists recently updated issues", async () => {
    const tool = createLinearListIssuesTool(
      deps((_query, variables) => {
        expect(variables).toEqual({ first: 5 })
        return {
          issues: {
            nodes: [
              {
                identifier: "ENG-1",
                title: "One",
                url: "https://linear.app/threa/issue/ENG-1/one",
                createdAt: "2026-05-01T10:00:00Z",
                updatedAt: "2026-05-02T10:00:00Z",
                state: { name: "Todo", type: "unstarted", color: "#ccc" },
                team: { key: "ENG", name: "Engineering" },
                labels: { nodes: [] },
              },
            ],
          },
        }
      })
    )

    const result = await tool.config.execute({ first: 5 }, { toolCallId: "call_1" })
    const output = JSON.parse(result.output)
    expect(output).toMatchObject({ count: 1, issues: [{ identifier: "ENG-1", title: "One" }] })
  })
})

describe("linear_get_project", () => {
  test("falls back from URL slug to trailing short id", async () => {
    const calls: Record<string, unknown>[] = []
    const tool = createLinearGetProjectTool(
      deps((_query, variables) => {
        calls.push(variables)
        if (variables.id !== "623f5efd5685") return { project: null }
        return {
          project: {
            id: "prj_1",
            name: "Smaller improvements 2026 H1",
            url: "https://linear.app/threa/project/smaller-improvements-2026-h1-623f5efd5685",
            description: "Project work",
            state: "started",
            progress: 0.5,
            startDate: null,
            targetDate: null,
            updatedAt: "2026-05-02T10:00:00Z",
            lead: null,
            initiative: { id: "init_1", name: "Bugs" },
            issues: { nodes: [] },
          },
        }
      })
    )

    const result = await tool.config.execute(
      { id: "smaller-improvements-2026-h1-623f5efd5685" },
      { toolCallId: "call_1" }
    )
    const output = JSON.parse(result.output)
    expect(calls).toEqual([{ id: "smaller-improvements-2026-h1-623f5efd5685" }, { id: "623f5efd5685" }])
    expect(output.project.name).toBe("Smaller improvements 2026 H1")
  })
})
