import { describe, it, expect, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement, type ReactNode } from "react"
import { useActors } from "./use-actors"
import { workspaceKeys } from "./use-workspaces"
import type { WorkspaceBootstrap, User, WorkspaceMember, Persona } from "@threa/types"

function createTestWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

function createUser(overrides: Partial<User> = {}): User {
  return {
    id: "usr_123",
    email: "test@example.com",
    name: "Test User",
    workosUserId: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  }
}

function createMember(overrides: Partial<WorkspaceMember> = {}): WorkspaceMember {
  return {
    id: "mem_123",
    workspaceId: "ws_123",
    userId: "usr_123",
    role: "member",
    slug: "test-user",
    name: "Test User",
    description: null,
    avatarUrl: null,
    timezone: null,
    locale: null,
    setupCompleted: true,
    joinedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  }
}

function createPersona(overrides: Partial<Persona> = {}): Persona {
  return {
    id: "persona_123",
    workspaceId: null,
    slug: "test-persona",
    name: "Test Persona",
    description: null,
    avatarEmoji: null,
    systemPrompt: null,
    model: "claude-sonnet-4-20250514",
    temperature: null,
    maxTokens: null,
    enabledTools: null,
    managedBy: "system",
    status: "active",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("useActors", () => {
  const workspaceId = "ws_123"
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
  })

  describe("getActorName", () => {
    it("should return 'Unknown' for null actorId", () => {
      const { result } = renderHook(() => useActors(workspaceId), {
        wrapper: createTestWrapper(queryClient),
      })

      expect(result.current.getActorName(null, null)).toBe("Unknown")
    })

    it("should return member display name when found in cache", () => {
      const bootstrap: Partial<WorkspaceBootstrap> = {
        members: [createMember({ id: "mem_123", userId: "usr_123", name: "John Doe" })],
        users: [createUser({ id: "usr_123", name: "John Doe", email: "john@example.com" })],
        personas: [],
      }
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), bootstrap)

      const { result } = renderHook(() => useActors(workspaceId), {
        wrapper: createTestWrapper(queryClient),
      })

      expect(result.current.getActorName("mem_123", "member")).toBe("John Doe")
    })

    it("should return truncated ID when member not in cache", () => {
      const bootstrap: Partial<WorkspaceBootstrap> = {
        members: [],
        users: [],
        personas: [],
      }
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), bootstrap)

      const { result } = renderHook(() => useActors(workspaceId), {
        wrapper: createTestWrapper(queryClient),
      })

      expect(result.current.getActorName("mem_12345678", "member")).toBe("mem_1234")
    })

    it("should return persona name for persona actor type", () => {
      const bootstrap: Partial<WorkspaceBootstrap> = {
        users: [],
        personas: [createPersona({ id: "persona_123", slug: "ariadne", name: "Ariadne", avatarEmoji: "🧵" })],
      }
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), bootstrap)

      const { result } = renderHook(() => useActors(workspaceId), {
        wrapper: createTestWrapper(queryClient),
      })

      expect(result.current.getActorName("persona_123", "persona")).toBe("Ariadne")
    })

    it("should return 'AI Companion' when persona not found", () => {
      const bootstrap: Partial<WorkspaceBootstrap> = {
        users: [],
        personas: [],
      }
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), bootstrap)

      const { result } = renderHook(() => useActors(workspaceId), {
        wrapper: createTestWrapper(queryClient),
      })

      expect(result.current.getActorName("persona_unknown", "persona")).toBe("AI Companion")
    })

    it("should return 'Threa' for system actor type", () => {
      const { result } = renderHook(() => useActors(workspaceId), {
        wrapper: createTestWrapper(queryClient),
      })

      expect(result.current.getActorName("system", "system")).toBe("Threa")
    })
  })

  describe("getActorInitials", () => {
    it("should return '?' for null actorId", () => {
      const { result } = renderHook(() => useActors(workspaceId), {
        wrapper: createTestWrapper(queryClient),
      })

      expect(result.current.getActorInitials(null, null)).toBe("?")
    })

    it("should return initials from member display name", () => {
      const bootstrap: Partial<WorkspaceBootstrap> = {
        members: [createMember({ id: "mem_123", userId: "usr_123", name: "John Doe" })],
        users: [createUser({ id: "usr_123", name: "John Doe", email: "john@example.com" })],
        personas: [],
      }
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), bootstrap)

      const { result } = renderHook(() => useActors(workspaceId), {
        wrapper: createTestWrapper(queryClient),
      })

      expect(result.current.getActorInitials("mem_123", "member")).toBe("JD")
    })

    it("should return avatar emoji for persona", () => {
      const bootstrap: Partial<WorkspaceBootstrap> = {
        users: [],
        // avatarEmoji is stored as shortcode format in the database
        personas: [createPersona({ id: "persona_123", slug: "ariadne", name: "Ariadne", avatarEmoji: ":thread:" })],
        emojis: [
          { shortcode: "thread", emoji: "🧵", type: "native" as const, group: "objects", order: 0, aliases: [] },
        ],
      }
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), bootstrap)

      const { result } = renderHook(() => useActors(workspaceId), {
        wrapper: createTestWrapper(queryClient),
      })

      expect(result.current.getActorInitials("persona_123", "persona")).toBe("🧵")
    })

    it("should return persona initials when no avatar emoji", () => {
      const bootstrap: Partial<WorkspaceBootstrap> = {
        users: [],
        personas: [
          createPersona({
            id: "persona_456",
            workspaceId: "ws_123",
            slug: "custom-bot",
            name: "Custom Bot",
            avatarEmoji: null,
            managedBy: "workspace",
          }),
        ],
      }
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), bootstrap)

      const { result } = renderHook(() => useActors(workspaceId), {
        wrapper: createTestWrapper(queryClient),
      })

      expect(result.current.getActorInitials("persona_456", "persona")).toBe("CB")
    })

    it("should return truncated ID when member not found", () => {
      const bootstrap: Partial<WorkspaceBootstrap> = {
        members: [],
        users: [],
        personas: [],
      }
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), bootstrap)

      const { result } = renderHook(() => useActors(workspaceId), {
        wrapper: createTestWrapper(queryClient),
      })

      expect(result.current.getActorInitials("ab_12345678", "member")).toBe("AB")
    })

    it("should return 'T' for system actor type", () => {
      const { result } = renderHook(() => useActors(workspaceId), {
        wrapper: createTestWrapper(queryClient),
      })

      expect(result.current.getActorInitials("system", "system")).toBe("T")
    })
  })

  describe("getUser", () => {
    it("should return user when found", () => {
      const user = createUser({ id: "usr_123", name: "Jane Doe", email: "jane@example.com" })
      const bootstrap: Partial<WorkspaceBootstrap> = {
        users: [user],
        personas: [],
      }
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), bootstrap)

      const { result } = renderHook(() => useActors(workspaceId), {
        wrapper: createTestWrapper(queryClient),
      })

      const foundUser = result.current.getUser("usr_123")
      expect(foundUser?.id).toBe("usr_123")
      expect(foundUser?.name).toBe("Jane Doe")
    })

    it("should return undefined when user not found", () => {
      const bootstrap: Partial<WorkspaceBootstrap> = {
        users: [],
        personas: [],
      }
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), bootstrap)

      const { result } = renderHook(() => useActors(workspaceId), {
        wrapper: createTestWrapper(queryClient),
      })

      expect(result.current.getUser("usr_nonexistent")).toBeUndefined()
    })
  })

  describe("getPersona", () => {
    it("should return persona when found", () => {
      const persona = createPersona({ id: "persona_123", slug: "ariadne", name: "Ariadne", avatarEmoji: "🧵" })
      const bootstrap: Partial<WorkspaceBootstrap> = {
        users: [],
        personas: [persona],
      }
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), bootstrap)

      const { result } = renderHook(() => useActors(workspaceId), {
        wrapper: createTestWrapper(queryClient),
      })

      const foundPersona = result.current.getPersona("persona_123")
      expect(foundPersona?.id).toBe("persona_123")
      expect(foundPersona?.name).toBe("Ariadne")
    })

    it("should return undefined when persona not found", () => {
      const bootstrap: Partial<WorkspaceBootstrap> = {
        users: [],
        personas: [],
      }
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), bootstrap)

      const { result } = renderHook(() => useActors(workspaceId), {
        wrapper: createTestWrapper(queryClient),
      })

      expect(result.current.getPersona("persona_nonexistent")).toBeUndefined()
    })
  })

  describe("getActorAvatar", () => {
    it("should return fallback 'T' with no slug for system actor type", () => {
      const { result } = renderHook(() => useActors(workspaceId), {
        wrapper: createTestWrapper(queryClient),
      })

      expect(result.current.getActorAvatar("system", "system")).toEqual({ fallback: "T" })
    })
  })
})
