import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { StreamTypes } from "@threa/types"
import { StreamSettingsDialog } from "./stream-settings-dialog"

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  queryClient: {
    getQueryData: vi.fn(),
  },
  useStreamSettings: vi.fn(),
  useWorkspaceStreams: vi.fn(),
  useWorkspaceStreamMemberships: vi.fn(),
  closeStreamSettings: vi.fn(),
  setTab: vi.fn(),
}))

vi.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => mocks.useQuery(...args),
  useQueryClient: () => mocks.queryClient,
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

describe("StreamSettingsDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.useQuery.mockReturnValue({ data: null })
    mocks.useStreamSettings.mockReturnValue({
      isOpen: true,
      activeTab: "general",
      streamId: "stream_dm",
      closeStreamSettings: mocks.closeStreamSettings,
      setTab: mocks.setTab,
    })
    mocks.useWorkspaceStreams.mockReturnValue([
      {
        id: "stream_dm",
        type: StreamTypes.DM,
        displayName: "Direct chat",
      },
    ])
    mocks.useWorkspaceStreamMemberships.mockReturnValue([
      {
        streamId: "stream_dm",
        memberId: "user_1",
        notificationLevel: "activity",
      },
    ])
  })

  it("shows only the available sidebar items for the resolved stream type", async () => {
    render(<StreamSettingsDialog workspaceId="ws_1" />)

    expect(await screen.findByText("Direct chat Settings")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Members/i })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /General/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Companion/i })).not.toBeInTheDocument()
    expect(screen.getByText("People and bot access")).toBeInTheDocument()
    expect(screen.getByText("Members panel")).toBeVisible()
  })
})
