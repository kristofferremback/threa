import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { WorkspaceSettingsDialog } from "./workspace-settings-dialog"
import * as generalTabModule from "./general-tab"
import * as usersTabModule from "./users-tab"
import * as botsTabModule from "./bots-tab"
import * as apiKeysTabModule from "./api-keys-tab"

function SearchEcho() {
  const location = useLocation()
  return <div data-testid="search">{location.search}</div>
}

function WorkspaceSettingsRoute() {
  return (
    <>
      <WorkspaceSettingsDialog workspaceId="ws_1" />
      <SearchEcho />
    </>
  )
}

describe("WorkspaceSettingsDialog", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(generalTabModule, "GeneralTab").mockImplementation(() => <div>General panel</div>)
    vi.spyOn(usersTabModule, "UsersTab").mockImplementation(() => <div>Users panel</div>)
    vi.spyOn(botsTabModule, "BotsTab").mockImplementation(() => <div>Bots panel</div>)
    vi.spyOn(apiKeysTabModule, "ApiKeysTab").mockImplementation(() => <div>API keys panel</div>)
  })

  it("uses the sidebar navigation and keeps URL tab state in sync", async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter initialEntries={["/w/ws_1?ws-settings=general"]}>
        <Routes>
          <Route path="/w/:workspaceId" element={<WorkspaceSettingsRoute />} />
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findByText("Workspace identity and region")).toBeInTheDocument()
    expect(screen.getByText("General panel")).toBeVisible()

    const tabs = document.body.querySelector('[data-slot="settings-tabs"]')
    const panels = document.body.querySelector('[data-slot="settings-panels"]')
    const nav = document.body.querySelector('[data-slot="settings-nav"]')
    const content = document.body.querySelector('[data-slot="settings-content"]')

    expect(tabs).toHaveClass("flex", "flex-1", "min-h-0", "flex-col")
    expect(panels).toHaveClass("flex", "flex-1", "min-h-0", "overflow-hidden")
    expect(nav).toHaveClass("min-h-0", "overflow-y-auto")
    expect(content).toHaveClass("flex-1", "min-h-0", "overflow-y-auto")

    await user.click(screen.getByRole("button", { name: /Bots/i }))

    await waitFor(() => {
      expect(screen.getByTestId("search")).toHaveTextContent("?ws-settings=bots")
    })
    expect(screen.getByText("Bots panel")).toBeVisible()
    expect(screen.getByText("Members and pending invites")).toBeInTheDocument()
  })
})
