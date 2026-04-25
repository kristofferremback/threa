import { describe, it, expect, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import {
  resetWorkspaceStoreCache,
  seedWorkspaceCache,
  useWorkspaceMetadata,
  useWorkspaceUsers,
} from "./workspace-store"

describe("workspace store cache subscriptions", () => {
  beforeEach(() => {
    resetWorkspaceStoreCache()
  })

  it("rerenders existing array readers when the workspace cache is seeded", () => {
    const { result } = renderHook(() => useWorkspaceUsers("workspace_1"))

    expect(result.current).toEqual([])

    act(() => {
      seedWorkspaceCache("workspace_1", {
        workspace: {
          id: "workspace_1",
          name: "Workspace",
          slug: "workspace",
          createdAt: "2026-03-01T10:00:00Z",
          updatedAt: "2026-03-01T10:00:00Z",
          _cachedAt: Date.now(),
        },
        users: [
          {
            id: "user_1",
            workspaceId: "workspace_1",
            workosUserId: "workos_1",
            email: "kris@example.com",
            role: "owner",
            slug: "kris",
            name: "Kris",
            description: null,
            avatarUrl: null,
            timezone: null,
            locale: null,
            pronouns: null,
            phone: null,
            githubUsername: null,
            setupCompleted: true,
            joinedAt: "2026-03-01T10:00:00Z",
            _cachedAt: Date.now(),
          },
        ],
        streams: [],
        memberships: [],
        dmPeers: [],
        personas: [],
        bots: [],
      })
    })

    expect(result.current.map((user) => user.slug)).toEqual(["kris"])
  })

  it("rerenders existing singleton readers when the workspace cache is seeded", () => {
    const { result } = renderHook(() => useWorkspaceMetadata("workspace_1"))

    expect(result.current).toBeUndefined()

    act(() => {
      seedWorkspaceCache("workspace_1", {
        workspace: {
          id: "workspace_1",
          name: "Workspace",
          slug: "workspace",
          createdAt: "2026-03-01T10:00:00Z",
          updatedAt: "2026-03-01T10:00:00Z",
          _cachedAt: Date.now(),
        },
        users: [],
        streams: [],
        memberships: [],
        dmPeers: [],
        personas: [],
        bots: [],
        metadata: {
          id: "workspace_1",
          workspaceId: "workspace_1",
          emojis: [{ shortcode: "wave", emoji: "👋", type: "native", group: "people", order: 0, aliases: [] }],
          emojiWeights: {},
          commands: [],
          viewerPermissions: ["streams:read"],
          _cachedAt: Date.now(),
        },
      })
    })

    expect(result.current?.emojis.map((emoji) => emoji.shortcode)).toEqual(["wave"])
  })
})
