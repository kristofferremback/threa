import { describe, it, expect, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement, type ReactNode } from "react"
import { WorkspaceEmoji } from "./workspace-emoji"
import { workspaceKeys } from "@/hooks/use-workspaces"
import type { WorkspaceBootstrap } from "@threa/types"

function createTestWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

describe("WorkspaceEmoji", () => {
  const workspaceId = "ws_123"
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
  })

  it("should render emoji for known shortcode", () => {
    const bootstrap: Partial<WorkspaceBootstrap> = {
      emojis: [{ shortcode: "thumbsup", emoji: "👍", type: "native" as const }],
    }
    queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), bootstrap)

    render(<WorkspaceEmoji workspaceId={workspaceId} shortcode=":thumbsup:" />, {
      wrapper: createTestWrapper(queryClient),
    })

    expect(screen.getByText("👍")).toBeInTheDocument()
  })

  it("should render emoji without colons in shortcode", () => {
    const bootstrap: Partial<WorkspaceBootstrap> = {
      emojis: [{ shortcode: "fire", emoji: "🔥", type: "native" as const }],
    }
    queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), bootstrap)

    render(<WorkspaceEmoji workspaceId={workspaceId} shortcode="fire" />, {
      wrapper: createTestWrapper(queryClient),
    })

    expect(screen.getByText("🔥")).toBeInTheDocument()
  })

  it("should render shortcode when emoji not found", () => {
    const bootstrap: Partial<WorkspaceBootstrap> = {
      emojis: [],
    }
    queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), bootstrap)

    render(<WorkspaceEmoji workspaceId={workspaceId} shortcode=":unknown:" />, {
      wrapper: createTestWrapper(queryClient),
    })

    expect(screen.getByText(":unknown:")).toBeInTheDocument()
  })

  it("should render fallback when emoji not found and fallback provided", () => {
    const bootstrap: Partial<WorkspaceBootstrap> = {
      emojis: [],
    }
    queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), bootstrap)

    render(<WorkspaceEmoji workspaceId={workspaceId} shortcode=":unknown:" fallback="❓" />, {
      wrapper: createTestWrapper(queryClient),
    })

    expect(screen.getByText("❓")).toBeInTheDocument()
  })

  it("should render thread emoji correctly", () => {
    const bootstrap: Partial<WorkspaceBootstrap> = {
      emojis: [{ shortcode: "thread", emoji: "🧵", type: "native" as const }],
    }
    queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), bootstrap)

    render(<WorkspaceEmoji workspaceId={workspaceId} shortcode=":thread:" />, {
      wrapper: createTestWrapper(queryClient),
    })

    expect(screen.getByText("🧵")).toBeInTheDocument()
  })
})
