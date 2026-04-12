import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { KeyboardSettings } from "./keyboard-settings"

const mockPreferences = {
  keyboardShortcuts: {} as Record<string, string>,
  messageSendMode: "enter" as const,
}

const updatePreference = vi.fn()
const resetKeyboardShortcut = vi.fn()
const resetAllKeyboardShortcuts = vi.fn()

vi.mock("@/contexts", () => ({
  usePreferences: () => ({
    preferences: mockPreferences,
    updatePreference,
    resetKeyboardShortcut,
    resetAllKeyboardShortcuts,
  }),
}))

describe("KeyboardSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPreferences.keyboardShortcuts = {}
  })

  it("saves conflict overrides as a single keyboardShortcuts update", async () => {
    const user = userEvent.setup()
    render(<KeyboardSettings />)

    const row = screen.getByText("Toggle Sidebar").closest("[data-shortcut-row]")
    expect(row).not.toBeNull()

    const badge = within(row! as HTMLElement).getByRole("button")
    await user.click(badge)
    fireEvent.keyDown(document, { key: "b", ctrlKey: true })

    expect(screen.getByText("Move shortcut?")).toBeInTheDocument()
    expect(screen.getByText(/is currently used by Bold/i)).toBeInTheDocument()
    expect(screen.getByText("New owner")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Move to Toggle Sidebar" }))

    expect(updatePreference).toHaveBeenCalledTimes(1)
    expect(updatePreference).toHaveBeenCalledWith("keyboardShortcuts", {
      formatBold: "none",
      toggleSidebar: "mod+b",
    })
  })

  it("shows the capture popover before a shortcut is chosen", async () => {
    const user = userEvent.setup()
    render(<KeyboardSettings />)

    const row = screen.getByText("Toggle Sidebar").closest("[data-shortcut-row]")
    expect(row).not.toBeNull()

    const badge = within(row! as HTMLElement).getByRole("button")
    await user.click(badge)

    expect(screen.getByText("Press shortcut keys")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Bind Escape" })).toBeInTheDocument()
  })

  it("ignores unsafe bare keys during capture", async () => {
    const user = userEvent.setup()
    render(<KeyboardSettings />)

    const row = screen.getByText("Toggle Sidebar").closest("[data-shortcut-row]")
    expect(row).not.toBeNull()

    const badge = within(row! as HTMLElement).getByRole("button")
    await user.click(badge)
    fireEvent.keyDown(document, { key: "b" })

    expect(updatePreference).not.toHaveBeenCalled()
    expect(screen.queryByText(/Conflicts with/i)).not.toBeInTheDocument()
  })

  it("shows a tooltip for the reset icon button", async () => {
    const user = userEvent.setup()
    mockPreferences.keyboardShortcuts = { toggleSidebar: "mod+b" }
    render(<KeyboardSettings />)

    const resetButton = screen.getByRole("button", { name: "Reset to default" })
    await user.hover(resetButton)

    expect((await screen.findAllByText("Reset to default")).length).toBeGreaterThan(0)
  })

  it("lets the user bind Escape explicitly", async () => {
    const user = userEvent.setup()
    render(<KeyboardSettings />)

    const row = screen.getByText("Toggle Sidebar").closest("[data-shortcut-row]")
    expect(row).not.toBeNull()

    const badge = within(row! as HTMLElement).getByRole("button")
    await user.click(badge)
    await user.click(screen.getByRole("button", { name: "Bind Escape" }))

    expect(screen.getByText("Move shortcut?")).toBeInTheDocument()
    expect(screen.getByText(/is currently used by Close/i)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Move to Toggle Sidebar" }))

    expect(updatePreference).toHaveBeenCalledTimes(1)
    expect(updatePreference).toHaveBeenCalledWith("keyboardShortcuts", {
      closeModal: "none",
      toggleSidebar: "escape",
    })
  })

  it("reports capture state changes and cancels capture on Escape", async () => {
    const user = userEvent.setup()
    const onCaptureStateChange = vi.fn()
    render(<KeyboardSettings onCaptureStateChange={onCaptureStateChange} />)

    const row = screen.getByText("Toggle Sidebar").closest("[data-shortcut-row]")
    expect(row).not.toBeNull()

    const badge = within(row! as HTMLElement).getByRole("button")
    await user.click(badge)
    fireEvent.keyDown(document, { key: "Escape" })
    fireEvent.keyDown(document, { key: "b", ctrlKey: true })

    expect(onCaptureStateChange).toHaveBeenCalledWith(true)
    expect(onCaptureStateChange).toHaveBeenCalledWith(false)
    expect(updatePreference).not.toHaveBeenCalled()
  })
})
