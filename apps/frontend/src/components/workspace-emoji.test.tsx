import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement, type ReactNode } from "react"
import { WorkspaceEmoji } from "./workspace-emoji"
// eslint-disable-next-line no-restricted-imports -- test file needs DB type for mock data
import type { CachedWorkspaceMetadata } from "@/db"

let mockMetadata: CachedWorkspaceMetadata | undefined

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceMetadata: () => mockMetadata,
}))

function createTestWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

function makeMetadata(
  emojis: CachedWorkspaceMetadata["emojis"],
  emojiWeights: Record<string, number> = {}
): CachedWorkspaceMetadata {
  return { id: "ws_123", workspaceId: "ws_123", emojis, emojiWeights, commands: [], _cachedAt: Date.now() }
}

describe("WorkspaceEmoji", () => {
  const workspaceId = "ws_123"
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mockMetadata = undefined
  })

  it("should render emoji for known shortcode", () => {
    mockMetadata = makeMetadata([
      { shortcode: "thumbsup", emoji: "👍", type: "native", group: "people", order: 0, aliases: ["thumbsup", "+1"] },
    ])

    render(<WorkspaceEmoji workspaceId={workspaceId} shortcode=":thumbsup:" />, {
      wrapper: createTestWrapper(queryClient),
    })
    expect(screen.getByText("👍")).toBeInTheDocument()
  })

  it("should render emoji without colons in shortcode", () => {
    mockMetadata = makeMetadata([
      { shortcode: "fire", emoji: "🔥", type: "native", group: "smileys", order: 0, aliases: ["fire"] },
    ])

    render(<WorkspaceEmoji workspaceId={workspaceId} shortcode="fire" />, {
      wrapper: createTestWrapper(queryClient),
    })
    expect(screen.getByText("🔥")).toBeInTheDocument()
  })

  it("should render shortcode when emoji not found", () => {
    mockMetadata = makeMetadata([])

    render(<WorkspaceEmoji workspaceId={workspaceId} shortcode=":unknown:" />, {
      wrapper: createTestWrapper(queryClient),
    })
    expect(screen.getByText(":unknown:")).toBeInTheDocument()
  })

  it("should render fallback when emoji not found and fallback provided", () => {
    mockMetadata = makeMetadata([])

    render(<WorkspaceEmoji workspaceId={workspaceId} shortcode=":unknown:" fallback="❓" />, {
      wrapper: createTestWrapper(queryClient),
    })
    expect(screen.getByText("❓")).toBeInTheDocument()
  })

  it("should render thread emoji correctly", () => {
    mockMetadata = makeMetadata([
      { shortcode: "thread", emoji: "🧵", type: "native", group: "objects", order: 0, aliases: ["thread"] },
    ])

    render(<WorkspaceEmoji workspaceId={workspaceId} shortcode=":thread:" />, {
      wrapper: createTestWrapper(queryClient),
    })
    expect(screen.getByText("🧵")).toBeInTheDocument()
  })
})
