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

    expect(screen.getByText(/Conflicts with Bold/i)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Override" }))

    expect(updatePreference).toHaveBeenCalledTimes(1)
    expect(updatePreference).toHaveBeenCalledWith("keyboardShortcuts", {
      formatBold: "none",
      toggleSidebar: "mod+b",
    })
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
