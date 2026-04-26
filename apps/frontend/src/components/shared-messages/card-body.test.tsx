import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import type { ReactNode } from "react"
import { SharedMessageCardBody } from "./card-body"
import type { SharedMessageSource } from "@/hooks/use-shared-message-source"

function renderUnderRoute(node: ReactNode, initialPath = "/w/ws_1/s/current") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/w/:workspaceId/s/:streamId" element={node} />
      </Routes>
    </MemoryRouter>
  )
}

describe("SharedMessageCardBody — Slice 2 placeholders", () => {
  it("renders the privacy stub for the private state, leaking only kind + visibility", () => {
    const source: SharedMessageSource = {
      status: "private",
      sourceStreamKind: "channel",
      sourceVisibility: "private",
    }
    renderUnderRoute(<SharedMessageCardBody source={source} fallbackAuthor="Should not appear" />)

    // The stub must NOT surface the cached fallback author (privacy leak).
    expect(screen.queryByText("Should not appear")).not.toBeInTheDocument()
    expect(screen.getByText("Private message")).toBeInTheDocument()
    expect(screen.getByText(/references content in a private channel you don't have access to/i)).toBeInTheDocument()
  })

  it("uses 'DM' wording for dm sources", () => {
    const source: SharedMessageSource = {
      status: "private",
      sourceStreamKind: "dm",
      sourceVisibility: "private",
    }
    renderUnderRoute(<SharedMessageCardBody source={source} fallbackAuthor="" />)
    expect(screen.getByText(/private DM you don't have access to/i)).toBeInTheDocument()
  })

  it("renders a navigable link for the truncated state", () => {
    const source: SharedMessageSource = {
      status: "truncated",
      streamId: "stream_deep",
      messageId: "msg_deep",
    }
    renderUnderRoute(<SharedMessageCardBody source={source} fallbackAuthor="" />)

    const link = screen.getByRole("link", { name: /open in source stream/i })
    expect(link.getAttribute("href")).toBe("/w/ws_1/s/stream_deep?m=msg_deep")
  })
})
