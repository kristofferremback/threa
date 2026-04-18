import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"
import { render, screen, userEvent } from "@/test"
import * as Contexts from "@/contexts"
import type { CollapseState } from "@/contexts"
import { SidebarQuickLinks } from "./quick-links"

type SidebarValue = ReturnType<typeof Contexts.useSidebar>

function stubSidebar(quickLinksState: CollapseState = "auto"): { cycleSectionState: ReturnType<typeof vi.fn> } {
  const cycleSectionState = vi.fn()
  const value = {
    collapseOnMobile: vi.fn(),
    getSectionState: (section: string, defaultState: CollapseState = "open") =>
      section === "quick-links" ? quickLinksState : defaultState,
    cycleSectionState,
  } as unknown as SidebarValue
  vi.spyOn(Contexts, "useSidebar").mockReturnValue(value)
  return { cycleSectionState }
}

function renderQuickLinks(props: Partial<Parameters<typeof SidebarQuickLinks>[0]> = {}) {
  return render(
    <MemoryRouter>
      <SidebarQuickLinks
        workspaceId="workspace_1"
        isDraftsPage={false}
        draftCount={0}
        isSavedPage={false}
        savedCount={0}
        isActivityPage={false}
        isMemoryPage={false}
        unreadActivityCount={0}
        {...props}
      />
    </MemoryRouter>
  )
}

describe("SidebarQuickLinks", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("renders all four links in open mode", () => {
    stubSidebar("open")
    renderQuickLinks()

    expect(screen.getByText("Drafts")).toBeInTheDocument()
    expect(screen.getByText("Threads")).toBeInTheDocument()
    expect(screen.getByText("Memory")).toBeInTheDocument()
    expect(screen.getByText("Activity")).toBeInTheDocument()
  })

  it("in auto mode shows only items with a signal", () => {
    stubSidebar("auto")
    renderQuickLinks({ draftCount: 3 })

    expect(screen.getByText("Drafts")).toBeInTheDocument()
    expect(screen.queryByText("Threads")).not.toBeInTheDocument()
    expect(screen.queryByText("Memory")).not.toBeInTheDocument()
    expect(screen.queryByText("Activity")).not.toBeInTheDocument()
  })

  it("in auto mode with no signals renders no items but keeps the header", () => {
    stubSidebar("auto")
    renderQuickLinks()

    expect(screen.queryByText("Drafts")).not.toBeInTheDocument()
    expect(screen.queryByText("Threads")).not.toBeInTheDocument()
    expect(screen.queryByText("Memory")).not.toBeInTheDocument()
    expect(screen.queryByText("Activity")).not.toBeInTheDocument()
    expect(screen.getByText("Quick Links")).toBeInTheDocument()
  })

  it("in collapsed mode renders only the header", () => {
    stubSidebar("collapsed")
    renderQuickLinks({ draftCount: 2, unreadActivityCount: 5 })

    expect(screen.getByText("Quick Links")).toBeInTheDocument()
    expect(screen.queryByText("Drafts")).not.toBeInTheDocument()
    expect(screen.queryByText("Activity")).not.toBeInTheDocument()
  })

  it("shows a dot on the header in collapsed mode when something is signaling", () => {
    stubSidebar("collapsed")
    renderQuickLinks({ unreadActivityCount: 1 })

    expect(screen.getByLabelText("Unread activity")).toBeInTheDocument()
  })

  it("does not show the dot in collapsed mode when nothing is signaling", () => {
    stubSidebar("collapsed")
    renderQuickLinks()

    expect(screen.queryByLabelText("Unread activity")).not.toBeInTheDocument()
  })

  it("cycles state when the header is clicked", async () => {
    const user = userEvent.setup()
    const { cycleSectionState } = stubSidebar("open")
    renderQuickLinks()

    await user.click(screen.getByText("Quick Links"))
    expect(cycleSectionState).toHaveBeenCalledTimes(1)
    expect(cycleSectionState).toHaveBeenCalledWith("quick-links", "auto")
  })

  it("displays the activity unread badge in open mode", () => {
    stubSidebar("open")
    renderQuickLinks({ unreadActivityCount: 4 })

    expect(screen.getByText("4")).toBeInTheDocument()
  })

  it("displays the draft count in auto mode", () => {
    stubSidebar("auto")
    renderQuickLinks({ draftCount: 2 })

    expect(screen.getByText("(2)")).toBeInTheDocument()
  })
})
