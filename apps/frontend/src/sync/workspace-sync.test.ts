import { describe, it, expect, beforeEach, vi } from "vitest"
import { db } from "@/db"
import { QueryClient } from "@tanstack/react-query"
import { workspaceKeys } from "@/hooks/use-workspaces"
import { applyWorkspaceBootstrap, registerWorkspaceSocketHandlers } from "./workspace-sync"
import type { WorkspaceBootstrap } from "@threa/types"
import type { Socket } from "socket.io-client"

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

function createTestSocket() {
  const handlers = new Map<string, Set<(payload: unknown) => void>>()

  const socket = {
    on(event: string, handler: (payload: unknown) => void) {
      const set = handlers.get(event) ?? new Set()
      set.add(handler)
      handlers.set(event, set)
      return this
    },
    off(event: string, handler: (payload: unknown) => void) {
      handlers.get(event)?.delete(handler)
      return this
    },
  } as unknown as Socket

  return {
    socket,
    emit(event: string, payload: unknown) {
      handlers.get(event)?.forEach((handler) => handler(payload))
    },
  }
}

function makeWorkspaceUser() {
  return {
    id: "member_1",
    workspaceId: "ws_1",
    workosUserId: "workos_1",
    email: "kris@example.com",
    role: "owner" as const,
    slug: "kris",
    name: "Kris",
    description: null,
    avatarUrl: null,
    timezone: "Europe/Stockholm",
    locale: "en",
    pronouns: null,
    phone: null,
    githubUsername: null,
    setupCompleted: true,
    joinedAt: new Date().toISOString(),
  }
}

describe("registerWorkspaceSocketHandlers", () => {
  beforeEach(async () => {
    await Promise.all([db.streams.clear(), db.streamMemberships.clear(), db.unreadState.clear()])
  })

  it("subscribes the creator when a new stream is created at runtime", async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(
      workspaceKeys.bootstrap("ws_1"),
      makeBootstrap({
        users: [makeWorkspaceUser()],
        streams: [],
        streamMemberships: [],
      })
    )

    const subscribeStream = vi.fn()
    const { socket, emit } = createTestSocket()
    const cleanup = registerWorkspaceSocketHandlers(socket, "ws_1", queryClient, {
      getCurrentStreamId: () => undefined,
      getCurrentUser: () => ({ id: "workos_1" }),
      subscribeStream,
    })

    emit("stream:created", {
      workspaceId: "ws_1",
      streamId: "stream_new",
      stream: {
        id: "stream_new",
        workspaceId: "ws_1",
        type: "channel",
        displayName: "Engineering",
        slug: "engineering",
        description: null,
        visibility: "public",
        parentStreamId: null,
        parentMessageId: null,
        rootStreamId: null,
        companionMode: "off",
        companionPersonaId: null,
        createdBy: "member_1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        archivedAt: null,
      },
    })

    await Promise.resolve()

    expect(subscribeStream).toHaveBeenCalledWith("stream_new")
    expect(await db.streamMemberships.get("ws_1:stream_new")).toBeDefined()

    cleanup()
  })

  it("subscribes the current user when they are added to a stream at runtime", async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(
      workspaceKeys.bootstrap("ws_1"),
      makeBootstrap({
        users: [makeWorkspaceUser()],
        streams: [],
        streamMemberships: [],
      })
    )

    const subscribeStream = vi.fn()
    const { socket, emit } = createTestSocket()
    const cleanup = registerWorkspaceSocketHandlers(socket, "ws_1", queryClient, {
      getCurrentStreamId: () => undefined,
      getCurrentUser: () => ({ id: "workos_1" }),
      subscribeStream,
    })

    emit("stream:member_added", {
      workspaceId: "ws_1",
      streamId: "stream_added",
      memberId: "member_1",
      stream: {
        id: "stream_added",
        workspaceId: "ws_1",
        type: "channel",
        displayName: "Added",
        slug: "added",
        description: null,
        visibility: "public",
        parentStreamId: null,
        parentMessageId: null,
        rootStreamId: null,
        companionMode: "off",
        companionPersonaId: null,
        createdBy: "member_2",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        archivedAt: null,
      },
    })

    await Promise.resolve()

    expect(subscribeStream).toHaveBeenCalledWith("stream_added")
    expect(await db.streamMemberships.get("ws_1:stream_added")).toBeDefined()

    cleanup()
  })

  it("updates the membership read pointer when a stream:read socket event arrives", async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(
      workspaceKeys.bootstrap("ws_1"),
      makeBootstrap({
        users: [makeWorkspaceUser()],
        streams: [
          {
            id: "stream_1",
            workspaceId: "ws_1",
            type: "channel",
            displayName: "Engineering",
            slug: "engineering",
            description: null,
            visibility: "public",
            parentStreamId: null,
            parentMessageId: null,
            rootStreamId: null,
            companionMode: "off",
            companionPersonaId: null,
            createdBy: "member_1",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            archivedAt: null,
            lastMessagePreview: null,
          },
        ],
        streamMemberships: [
          {
            streamId: "stream_1",
            memberId: "member_1",
            pinned: false,
            pinnedAt: null,
            notificationLevel: "everything",
            lastReadEventId: "event_old",
            lastReadAt: null,
            joinedAt: new Date().toISOString(),
          },
        ],
        unreadCounts: { stream_1: 1 },
        mentionCounts: { stream_1: 0 },
        activityCounts: { stream_1: 0 },
      })
    )

    await db.streams.put({
      id: "stream_1",
      workspaceId: "ws_1",
      type: "channel",
      displayName: "Engineering",
      slug: "engineering",
      description: null,
      visibility: "public",
      parentStreamId: null,
      parentMessageId: null,
      rootStreamId: null,
      companionMode: "off",
      companionPersonaId: null,
      createdBy: "member_1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      archivedAt: null,
      lastReadEventId: "event_old",
      _cachedAt: Date.now(),
    })
    await db.streamMemberships.put({
      id: "ws_1:stream_1",
      workspaceId: "ws_1",
      streamId: "stream_1",
      memberId: "member_1",
      pinned: false,
      pinnedAt: null,
      notificationLevel: "everything",
      lastReadEventId: "event_old",
      lastReadAt: null,
      joinedAt: new Date().toISOString(),
      _cachedAt: Date.now(),
    })
    await db.unreadState.put({
      id: "ws_1",
      workspaceId: "ws_1",
      unreadCounts: { stream_1: 1 },
      mentionCounts: { stream_1: 0 },
      activityCounts: { stream_1: 0 },
      unreadActivityCount: 0,
      mutedStreamIds: [],
      _cachedAt: Date.now(),
    })

    const subscribeStream = vi.fn()
    const { socket, emit } = createTestSocket()
    const cleanup = registerWorkspaceSocketHandlers(socket, "ws_1", queryClient, {
      getCurrentStreamId: () => "stream_1",
      getCurrentUser: () => ({ id: "workos_1" }),
      subscribeStream,
    })

    emit("stream:read", {
      workspaceId: "ws_1",
      authorId: "member_1",
      streamId: "stream_1",
      lastReadEventId: "event_new",
    })

    await Promise.resolve()

    expect(await db.streamMemberships.get("ws_1:stream_1")).toMatchObject({
      lastReadEventId: "event_new",
    })
    expect(await db.streams.get("stream_1")).toMatchObject({
      lastReadEventId: "event_new",
    })

    cleanup()
  })
})
