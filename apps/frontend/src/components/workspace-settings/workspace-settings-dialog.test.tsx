import { describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { WorkspaceSettingsDialog } from "./workspace-settings-dialog"

vi.mock("./general-tab", () => ({
  GeneralTab: () => <div>General panel</div>,
}))

vi.mock("./users-tab", () => ({
  UsersTab: () => <div>Users panel</div>,
}))

vi.mock("./bots-tab", () => ({
  BotsTab: () => <div>Bots panel</div>,
}))

vi.mock("./api-keys-tab", () => ({
  ApiKeysTab: () => <div>API keys panel</div>,
}))

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

    await user.click(screen.getByRole("button", { name: /Bots/i }))

    await waitFor(() => {
      expect(screen.getByTestId("search")).toHaveTextContent("?ws-settings=bots")
    })
    expect(screen.getByText("Bots panel")).toBeVisible()
    expect(screen.getByText("Members and pending invites")).toBeInTheDocument()
  })
})
