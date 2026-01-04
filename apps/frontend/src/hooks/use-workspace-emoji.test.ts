import { describe, it, expect, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement, type ReactNode } from "react"
import { useWorkspaceEmoji } from "./use-workspace-emoji"
import { workspaceKeys } from "./use-workspaces"
import type { WorkspaceBootstrap, EmojiEntry } from "@threa/types"

function createTestWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

describe("useWorkspaceEmoji", () => {
  const workspaceId = "ws_123"
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
  })

  describe("toEmoji", () => {
    it("should return emoji for known shortcode", () => {
      const bootstrap: Partial<WorkspaceBootstrap> = {
        emojis: [
          { shortcode: "thumbsup", emoji: "👍", type: "native" as const, group: "people", order: 0, aliases: [] },
        ],
      }
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), bootstrap)

      const { result } = renderHook(() => useWorkspaceEmoji(workspaceId), {
        wrapper: createTestWrapper(queryClient),
      })

      expect(result.current.toEmoji("thumbsup")).toBe("👍")
    })

    it("should return emoji when shortcode has colons", () => {
      const bootstrap: Partial<WorkspaceBootstrap> = {
        emojis: [
          { shortcode: "thread", emoji: "🧵", type: "native" as const, group: "objects", order: 0, aliases: [] },
        ],
      }
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), bootstrap)

      const { result } = renderHook(() => useWorkspaceEmoji(workspaceId), {
        wrapper: createTestWrapper(queryClient),
      })

      expect(result.current.toEmoji(":thread:")).toBe("🧵")
    })

    it("should return null for unknown shortcode", () => {
      const bootstrap: Partial<WorkspaceBootstrap> = {
        emojis: [
          { shortcode: "thumbsup", emoji: "👍", type: "native" as const, group: "people", order: 0, aliases: [] },
        ],
      }
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), bootstrap)

      const { result } = renderHook(() => useWorkspaceEmoji(workspaceId), {
        wrapper: createTestWrapper(queryClient),
      })

      expect(result.current.toEmoji("nonexistent")).toBeNull()
    })

    it("should return null when no emojis in bootstrap", () => {
      const bootstrap: Partial<WorkspaceBootstrap> = {
        emojis: [],
      }
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), bootstrap)

      const { result } = renderHook(() => useWorkspaceEmoji(workspaceId), {
        wrapper: createTestWrapper(queryClient),
      })

      expect(result.current.toEmoji("thumbsup")).toBeNull()
    })

    it("should return null when bootstrap has no emoji data", () => {
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), {})

      const { result } = renderHook(() => useWorkspaceEmoji(workspaceId), {
        wrapper: createTestWrapper(queryClient),
      })

      expect(result.current.toEmoji("thumbsup")).toBeNull()
    })
  })

  describe("getEmoji", () => {
    it("should return full emoji entry for known shortcode", () => {
      const emojiEntry: EmojiEntry = {
        shortcode: "thumbsup",
        emoji: "👍",
        type: "native",
        group: "people",
        order: 0,
        aliases: [],
      }
      const bootstrap: Partial<WorkspaceBootstrap> = {
        emojis: [emojiEntry],
      }
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), bootstrap)

      const { result } = renderHook(() => useWorkspaceEmoji(workspaceId), {
        wrapper: createTestWrapper(queryClient),
      })

      const entry = result.current.getEmoji("thumbsup")
      expect(entry?.shortcode).toBe("thumbsup")
      expect(entry?.emoji).toBe("👍")
      expect(entry?.type).toBe("native")
    })

    it("should return undefined for unknown shortcode", () => {
      const bootstrap: Partial<WorkspaceBootstrap> = {
        emojis: [
          { shortcode: "thumbsup", emoji: "👍", type: "native" as const, group: "people", order: 0, aliases: [] },
        ],
      }
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), bootstrap)

      const { result } = renderHook(() => useWorkspaceEmoji(workspaceId), {
        wrapper: createTestWrapper(queryClient),
      })

      expect(result.current.getEmoji("nonexistent")).toBeUndefined()
    })

    it("should strip colons from shortcode when looking up", () => {
      const bootstrap: Partial<WorkspaceBootstrap> = {
        emojis: [{ shortcode: "fire", emoji: "🔥", type: "native" as const, group: "smileys", order: 0, aliases: [] }],
      }
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), bootstrap)

      const { result } = renderHook(() => useWorkspaceEmoji(workspaceId), {
        wrapper: createTestWrapper(queryClient),
      })

      expect(result.current.getEmoji(":fire:")).toBeDefined()
      expect(result.current.getEmoji(":fire:")?.emoji).toBe("🔥")
    })
  })

  describe("emojis and emojiWeights", () => {
    it("should return emojis list from bootstrap", () => {
      const emojiList: EmojiEntry[] = [
        { shortcode: "thumbsup", emoji: "👍", type: "native", group: "people", order: 0, aliases: [] },
        { shortcode: "fire", emoji: "🔥", type: "native", group: "smileys", order: 1, aliases: [] },
      ]
      const bootstrap: Partial<WorkspaceBootstrap> = {
        emojis: emojiList,
      }
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), bootstrap)

      const { result } = renderHook(() => useWorkspaceEmoji(workspaceId), {
        wrapper: createTestWrapper(queryClient),
      })

      expect(result.current.emojis).toHaveLength(2)
      expect(result.current.emojis[0].shortcode).toBe("thumbsup")
    })

    it("should return emojiWeights from bootstrap", () => {
      const bootstrap: Partial<WorkspaceBootstrap> = {
        emojis: [{ shortcode: "thumbsup", emoji: "👍", type: "native", group: "people", order: 0, aliases: [] }],
        emojiWeights: { thumbsup: 5, fire: 3 },
      }
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), bootstrap)

      const { result } = renderHook(() => useWorkspaceEmoji(workspaceId), {
        wrapper: createTestWrapper(queryClient),
      })

      expect(result.current.emojiWeights).toEqual({ thumbsup: 5, fire: 3 })
    })

    it("should return empty object when emojiWeights not in bootstrap", () => {
      const bootstrap: Partial<WorkspaceBootstrap> = {
        emojis: [],
      }
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), bootstrap)

      const { result } = renderHook(() => useWorkspaceEmoji(workspaceId), {
        wrapper: createTestWrapper(queryClient),
      })

      expect(result.current.emojiWeights).toEqual({})
    })
  })
})
