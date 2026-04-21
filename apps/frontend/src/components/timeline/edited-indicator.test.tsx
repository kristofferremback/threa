import { beforeEach, describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TooltipProvider } from "@/components/ui/tooltip"
import * as contextsModule from "@/contexts"
import { EditedIndicator } from "./edited-indicator"

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(contextsModule, "usePreferences").mockReturnValue({
    preferences: { timezone: "UTC", locale: "en-US" },
  } as unknown as ReturnType<typeof contextsModule.usePreferences>)
})

function renderWithTooltip(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

describe("EditedIndicator", () => {
  it("should render '(edited)' text", () => {
    renderWithTooltip(<EditedIndicator editedAt="2026-02-17T12:00:00Z" onShowHistory={vi.fn()} />)

    expect(screen.getByText("(edited)")).toBeInTheDocument()
  })

  it("should call onShowHistory when clicked", async () => {
    const user = userEvent.setup()
    const onShowHistory = vi.fn()

    renderWithTooltip(<EditedIndicator editedAt="2026-02-17T12:00:00Z" onShowHistory={onShowHistory} />)

    await user.click(screen.getByText("(edited)"))

    expect(onShowHistory).toHaveBeenCalledOnce()
  })

  it("should render as a button element", () => {
    renderWithTooltip(<EditedIndicator editedAt="2026-02-17T12:00:00Z" onShowHistory={vi.fn()} />)

    const button = screen.getByText("(edited)")
    expect(button.tagName).toBe("BUTTON")
  })
})
