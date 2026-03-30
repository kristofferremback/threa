import { describe, it, expect, beforeEach } from "vitest"
import { db } from "@/db"
import { applyWorkspaceBootstrap } from "./workspace-sync"
import type { WorkspaceBootstrap } from "@threa/types"

function makeBootstrap(overrides: Partial<WorkspaceBootstrap> = {}): WorkspaceBootstrap {
  return {
    workspace: {
      id: "ws_1",
      name: "Test",
      slug: "test",
      createdBy: "user_1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    users: [],
    streams: [],
    streamMemberships: [],
    dmPeers: [],
    personas: [],
    bots: [],
    emojis: [],
    emojiWeights: {},
    commands: [],
    unreadCounts: {},
    mentionCounts: {},
    activityCounts: {},
    unreadActivityCount: 0,
    mutedStreamIds: [],
    userPreferences: {
      workspaceId: "ws_1",
      userId: "user_1",
      theme: "system",
      messageSendMode: "enter",
      messageDisplay: "default",
      accessibility: {
        fontSize: "medium",
        fontFamily: "default",
        reducedMotion: false,
        highContrast: false,
      },
      keyboardShortcuts: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    ...overrides,
  } as WorkspaceBootstrap
}

describe("applyWorkspaceBootstrap (real IndexedDB)", () => {
  beforeEach(async () => {
    await Promise.all([
      db.workspaces.clear(),
      db.workspaceUsers.clear(),
      db.streams.clear(),
      db.streamMemberships.clear(),
      db.dmPeers.clear(),
      db.personas.clear(),
      db.bots.clear(),
      db.unreadState.clear(),
      db.userPreferences.clear(),
      db.workspaceMetadata.clear(),
    ])
  })

  it("removes stale streams not in bootstrap", async () => {
    const fetchStartedAt = Date.now() - 1000 // fetch started 1s ago

    // Pre-existing stale stream from a previous environment (before fetch started)
    await db.streams.put({
      id: "stream_stale",
      workspaceId: "ws_1",
      type: "channel",
      displayName: "Gone",
      slug: null,
      description: null,
      visibility: "public",
      parentStreamId: null,
      parentMessageId: null,
      rootStreamId: null,
      companionMode: "off",
      companionPersonaId: null,
      createdBy: "user_1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      archivedAt: null,
      _cachedAt: fetchStartedAt - 86400000, // well before fetch started
    })

    const bootstrap = makeBootstrap({
      streams: [
        {
          id: "stream_current",
          workspaceId: "ws_1",
          type: "channel",
          displayName: "Current",
          slug: null,
          description: null,
          visibility: "public",
          parentStreamId: null,
          parentMessageId: null,
          rootStreamId: null,
          companionMode: "off",
          companionPersonaId: null,
          createdBy: "user_1",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          archivedAt: null,
          lastMessagePreview: null,
        },
      ] as WorkspaceBootstrap["streams"],
    })

    await applyWorkspaceBootstrap("ws_1", bootstrap, fetchStartedAt)

    // Stale stream should be gone
    expect(await db.streams.get("stream_stale")).toBeUndefined()
    // Current stream should exist
    expect(await db.streams.get("stream_current")).toBeDefined()
  })

  it("preserves streams written by socket handlers DURING the fetch (race condition)", async () => {
    const fetchStartedAt = Date.now() - 500 // fetch started 500ms ago

    // Stream created via socket AFTER fetch started (during the fetch window)
    await db.streams.put({
      id: "stream_socket",
      workspaceId: "ws_1",
      type: "channel",
      displayName: "New via socket",
      slug: null,
      description: null,
      visibility: "public",
      parentStreamId: null,
      parentMessageId: null,
      rootStreamId: null,
      companionMode: "off",
      companionPersonaId: null,
      createdBy: "user_1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      archivedAt: null,
      _cachedAt: fetchStartedAt + 100, // written 100ms after fetch started
    })

    // Bootstrap doesn't include this stream (snapshot taken before it existed)
    await applyWorkspaceBootstrap("ws_1", makeBootstrap(), fetchStartedAt)

    // Socket-handler stream MUST survive — _cachedAt > fetchStartedAt
    expect(await db.streams.get("stream_socket")).toBeDefined()
  })

  it("removes stale users not in bootstrap", async () => {
    const fetchStartedAt = Date.now() - 1000

    await db.workspaceUsers.put({
      id: "user_gone",
      workspaceId: "ws_1",
      workosUserId: "workos_gone",
      email: "gone@test.com",
      role: "user",
      slug: "gone",
      name: "Gone User",
      description: null,
      avatarUrl: null,
      timezone: null,
      locale: null,
      pronouns: null,
      phone: null,
      githubUsername: null,
      setupCompleted: true,
      joinedAt: new Date().toISOString(),
      _cachedAt: fetchStartedAt - 86400000,
    })

    await applyWorkspaceBootstrap("ws_1", makeBootstrap(), fetchStartedAt)

    expect(await db.workspaceUsers.get("user_gone")).toBeUndefined()
  })

  it("skips cleanup when fetchStartedAt is not provided", async () => {
    // Pre-existing stream
    await db.streams.put({
      id: "stream_keep",
      workspaceId: "ws_1",
      type: "channel",
      displayName: "Keep",
      slug: null,
      description: null,
      visibility: "public",
      parentStreamId: null,
      parentMessageId: null,
      rootStreamId: null,
      companionMode: "off",
      companionPersonaId: null,
      createdBy: "user_1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      archivedAt: null,
      _cachedAt: Date.now() - 86400000,
    })

    // No fetchStartedAt → no cleanup (e.g., cache-seed path)
    await applyWorkspaceBootstrap("ws_1", makeBootstrap())

    expect(await db.streams.get("stream_keep")).toBeDefined()
  })
})
