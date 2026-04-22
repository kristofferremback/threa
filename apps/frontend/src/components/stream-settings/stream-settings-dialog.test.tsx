import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { StreamTypes, type Stream, type StreamBootstrap } from "@threa/types"
import { streamKeys } from "@/hooks"
import { StreamSettingsDialog } from "./stream-settings-dialog"
import * as useStreamSettingsModule from "./use-stream-settings"
import * as workspaceStoreModule from "@/stores/workspace-store"
import * as generalTabModule from "./general-tab"
import * as companionTabModule from "./companion-tab"
import * as membersTabModule from "./members-tab"

const useStreamSettingsMock = vi.fn()
const useWorkspaceStreamsMock = vi.fn()
const useWorkspaceStreamMembershipsMock = vi.fn()
const closeStreamSettings = vi.fn()
const setTab = vi.fn()

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
    vi.restoreAllMocks()
    useStreamSettingsMock.mockReset()
    useWorkspaceStreamsMock.mockReset()
    useWorkspaceStreamMembershipsMock.mockReset()
    closeStreamSettings.mockReset()
    setTab.mockReset()

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })

    useStreamSettingsMock.mockReturnValue({
      isOpen: true,
      activeTab: "general",
      streamId: "stream_dm",
      closeStreamSettings,
      setTab,
    })

    const stream = makeStream()
    const bootstrap: StreamBootstrap = {
      stream,
      events: [],
      members: [],
      botMemberIds: [],
      membership: null,
      latestSequence: "0",
      hasOlderEvents: false,
      syncMode: "replace",
      unreadCount: 0,
      mentionCount: 0,
      activityCount: 0,
    }

    queryClient.setQueryData(streamKeys.bootstrap("ws_1", "stream_dm"), bootstrap)

    useWorkspaceStreamsMock.mockReturnValue([])
    useWorkspaceStreamMembershipsMock.mockReturnValue([
      {
        streamId: "stream_dm",
        memberId: "user_1",
        notificationLevel: "activity",
      },
    ])

    vi.spyOn(useStreamSettingsModule, "useStreamSettings").mockImplementation((() =>
      useStreamSettingsMock()) as unknown as typeof useStreamSettingsModule.useStreamSettings)
    vi.spyOn(workspaceStoreModule, "useWorkspaceStreams").mockImplementation(((...args: unknown[]) =>
      useWorkspaceStreamsMock(...args)) as unknown as typeof workspaceStoreModule.useWorkspaceStreams)
    vi.spyOn(workspaceStoreModule, "useWorkspaceStreamMemberships").mockImplementation(((...args: unknown[]) =>
      useWorkspaceStreamMembershipsMock(
        ...args
      )) as unknown as typeof workspaceStoreModule.useWorkspaceStreamMemberships)

    vi.spyOn(generalTabModule, "GeneralTab").mockImplementation((() => (
      <div>General panel</div>
    )) as unknown as typeof generalTabModule.GeneralTab)
    vi.spyOn(companionTabModule, "CompanionTab").mockImplementation((() => (
      <div>Companion panel</div>
    )) as unknown as typeof companionTabModule.CompanionTab)
    vi.spyOn(membersTabModule, "MembersTab").mockImplementation((() => (
      <div>Members panel</div>
    )) as unknown as typeof membersTabModule.MembersTab)
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
