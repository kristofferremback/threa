import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, act, waitFor } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ServicesProvider, type MessageService, type StreamService } from "@/contexts"
import { PendingMessagesProvider } from "@/contexts/pending-messages-context"
import { clearAllCachedData, db } from "@/db"
import { AuthContext } from "@/auth/context"
import { streamKeys } from "./use-streams"
import { seedWorkspaceCache } from "@/stores/workspace-store"
import { useStreamOrDraft } from "./use-stream-or-draft"

vi.mock("@/auth", async () => {
  const actual = await vi.importActual<typeof import("@/auth")>("@/auth")
  return {
    ...actual,
    useUser: () => ({ id: "workos_1", email: "kris@example.com", name: "Kris" }),
  }
})

function createWrapper(queryClient: QueryClient) {
  const streamService = {} as StreamService
  const messageService = {} as MessageService

  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      MemoryRouter,
      undefined,
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(ServicesProvider, {
          services: {
            streams: streamService,
            messages: messageService,
          },
          children: createElement(
            AuthContext.Provider,
            {
              value: {
                user: { id: "workos_1", email: "kris@example.com", name: "Kris" },
                loading: false,
                error: null,
                login: vi.fn(),
                logout: vi.fn(),
                refetch: vi.fn(),
              },
            },
            createElement(PendingMessagesProvider, undefined, children)
          ),
        })
      )
    )
  }
}

describe("useStreamOrDraft real stream send", () => {
  beforeEach(async () => {
    await clearAllCachedData()
  })

  it("queues the optimistic event in IndexedDB without mutating an empty bootstrap window", async () => {
    const createdAt = "2026-03-31T10:00:00Z"
    const stream = {
      id: "stream_socket_seen",
      workspaceId: "ws_1",
      type: "channel" as const,
      displayName: "Engineering",
      slug: "engineering",
      description: null,
      visibility: "public" as const,
      parentStreamId: null,
      parentMessageId: null,
      rootStreamId: null,
      companionMode: "off" as const,
      companionPersonaId: null,
      createdBy: "member_1",
      createdAt,
      updatedAt: createdAt,
      archivedAt: null,
      lastMessagePreview: null,
    }

    seedWorkspaceCache("ws_1", {
      workspace: {
        id: "ws_1",
        name: "Workspace",
        slug: "workspace",
        createdAt,
        updatedAt: createdAt,
        _cachedAt: Date.now(),
      },
      users: [
        {
          id: "member_1",
          workspaceId: "ws_1",
          workosUserId: "workos_1",
          email: "kris@example.com",
          role: "owner",
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
          joinedAt: createdAt,
          _cachedAt: Date.now(),
        },
      ],
      streams: [{ ...stream, _cachedAt: Date.now() }],
      memberships: [
        {
          id: "ws_1:stream_socket_seen",
          workspaceId: "ws_1",
          streamId: "stream_socket_seen",
          memberId: "member_1",
          pinned: false,
          pinnedAt: null,
          notificationLevel: null,
          lastReadEventId: null,
          lastReadAt: null,
          joinedAt: createdAt,
          _cachedAt: Date.now(),
        },
      ],
      dmPeers: [],
      personas: [],
      bots: [],
      unreadState: {
        id: "ws_1",
        workspaceId: "ws_1",
        unreadCounts: {},
        mentionCounts: {},
        activityCounts: {},
        unreadActivityCount: 0,
        mutedStreamIds: [],
        _cachedAt: Date.now(),
      },
      userPreferences: {
        id: "ws_1",
        workspaceId: "ws_1",
        userId: "member_1",
        theme: "system",
        sendMode: "enter",
        _cachedAt: Date.now(),
      },
      metadata: {
        id: "ws_1",
        workspaceId: "ws_1",
        emojis: [],
        emojiWeights: {},
        commands: [],
        _cachedAt: Date.now(),
      },
    })

    const queryClient = new QueryClient()
    queryClient.setQueryData(streamKeys.bootstrap("ws_1", "stream_socket_seen"), {
      stream,
      events: [],
      members: [],
      membership: null,
      latestSequence: "0",
    })

    const { result } = renderHook(() => useStreamOrDraft("ws_1", "stream_socket_seen"), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => {
      expect(result.current.stream?.id).toBe("stream_socket_seen")
    })

    await act(async () => {
      await result.current.sendMessage({
        contentJson: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
        },
      })
    })

    const bootstrap = queryClient.getQueryData<{
      events: Array<{ id: string; sequence: string }>
    }>(streamKeys.bootstrap("ws_1", "stream_socket_seen"))
    expect(bootstrap?.events).toEqual([])

    const pendingMessages = await db.pendingMessages.toArray()
    expect(pendingMessages).toHaveLength(1)
    expect(pendingMessages[0]).toMatchObject({
      workspaceId: "ws_1",
      streamId: "stream_socket_seen",
      content: "hello",
    })

    const queuedEvents = await db.events.toArray()
    expect(queuedEvents).toHaveLength(1)
    expect(queuedEvents[0]).toMatchObject({
      streamId: "stream_socket_seen",
      actorId: "member_1",
      eventType: "message_created",
      _status: "pending",
    })
  })
})
