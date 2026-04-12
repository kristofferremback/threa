import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { StreamTypes, type Stream, type StreamBootstrap } from "@threa/types"
import { streamKeys } from "@/hooks"
import { StreamSettingsDialog } from "./stream-settings-dialog"

const mocks = vi.hoisted(() => ({
  useStreamSettings: vi.fn(),
  useWorkspaceStreams: vi.fn(),
  useWorkspaceStreamMemberships: vi.fn(),
  closeStreamSettings: vi.fn(),
  setTab: vi.fn(),
}))

vi.mock("./use-stream-settings", () => ({
  STREAM_SETTINGS_TABS: ["general", "companion", "members"],
  useStreamSettings: () => mocks.useStreamSettings(),
}))

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStreams: (...args: unknown[]) => mocks.useWorkspaceStreams(...args),
  useWorkspaceStreamMemberships: (...args: unknown[]) => mocks.useWorkspaceStreamMemberships(...args),
}))

vi.mock("./general-tab", () => ({
  GeneralTab: () => <div>General panel</div>,
}))

vi.mock("./companion-tab", () => ({
  CompanionTab: () => <div>Companion panel</div>,
}))

vi.mock("./members-tab", () => ({
  MembersTab: () => <div>Members panel</div>,
}))

function makeStream(overrides: Partial<Stream> = {}): Stream {
  return {
    id: "stream_dm",
    workspaceId: "ws_1",
    type: StreamTypes.DM,
    displayName: "Direct chat",
    slug: null,
    description: null,
    visibility: "private",
    parentStreamId: null,
    parentMessageId: null,
    rootStreamId: null,
    companionMode: "off",
    companionPersonaId: null,
    createdBy: "user_1",
    createdAt: "2026-04-07T00:00:00.000Z",
    updatedAt: "2026-04-07T00:00:00.000Z",
    archivedAt: null,
    ...overrides,
  }
}

describe("StreamSettingsDialog", () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })

    mocks.useStreamSettings.mockReturnValue({
      isOpen: true,
      activeTab: "general",
      streamId: "stream_dm",
      closeStreamSettings: mocks.closeStreamSettings,
      setTab: mocks.setTab,
    })

    const stream = makeStream()
    const bootstrap: StreamBootstrap = {
      stream,
      events: [],
      members: [],
      membership: null,
      latestSequence: "0",
      hasOlderEvents: false,
      syncMode: "replace",
      unreadCount: 0,
      mentionCount: 0,
      activityCount: 0,
    }

    queryClient.setQueryData(streamKeys.bootstrap("ws_1", "stream_dm"), bootstrap)

    mocks.useWorkspaceStreams.mockReturnValue([])
    mocks.useWorkspaceStreamMemberships.mockReturnValue([
      {
        streamId: "stream_dm",
        memberId: "user_1",
        notificationLevel: "activity",
      },
    ])
  })

  it("shows only the available sidebar items for the resolved stream type", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <StreamSettingsDialog workspaceId="ws_1" />
      </QueryClientProvider>
    )

    expect(await screen.findByText("Direct chat Settings")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Members/i })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /General/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Companion/i })).not.toBeInTheDocument()
    expect(screen.getByText("People and bot access")).toBeInTheDocument()
    expect(screen.getByText("Members panel")).toBeVisible()

    const tabs = document.body.querySelector('[data-slot="settings-tabs"]')
    const panels = document.body.querySelector('[data-slot="settings-panels"]')
    const nav = document.body.querySelector('[data-slot="settings-nav"]')
    const content = document.body.querySelector('[data-slot="settings-content"]')

    expect(tabs).toHaveClass("flex", "flex-1", "min-h-0", "flex-col")
    expect(panels).toHaveClass("flex", "flex-1", "min-h-0", "overflow-hidden")
    expect(nav).toHaveClass("min-h-0", "overflow-y-auto")
    expect(content).toHaveClass("flex-1", "min-h-0", "overflow-y-auto")
  })
})
