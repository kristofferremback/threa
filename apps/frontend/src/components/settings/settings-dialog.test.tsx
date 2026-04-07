import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { SettingsDialog } from "./settings-dialog"

const mocks = vi.hoisted(() => ({
  useSettings: vi.fn(),
}))

vi.mock("@/contexts", () => ({
  useSettings: () => mocks.useSettings(),
}))

vi.mock("./profile-settings", () => ({
  ProfileSettings: () => <div>Profile panel</div>,
}))

vi.mock("./ai-settings", () => ({
  AISettings: () => <div>AI panel</div>,
}))

vi.mock("./appearance-settings", () => ({
  AppearanceSettings: () => <div>Appearance panel</div>,
}))

vi.mock("./datetime-settings", () => ({
  DateTimeSettings: () => <div>Date & Time panel</div>,
}))

vi.mock("./notifications-settings", () => ({
  NotificationsSettings: () => <div>Notifications panel</div>,
}))

vi.mock("./keyboard-settings", () => ({
  KeyboardSettings: () => <div>Keyboard panel</div>,
}))

vi.mock("./accessibility-settings", () => ({
  AccessibilitySettings: () => <div>Accessibility panel</div>,
}))

describe("SettingsDialog", () => {
  it("keeps the navigation and active panel in scrollable regions", async () => {
    mocks.useSettings.mockReturnValue({
      isOpen: true,
      activeTab: "profile",
      closeSettings: vi.fn(),
      setActiveTab: vi.fn(),
    })

    render(<SettingsDialog />)

    expect(await screen.findByText("Identity and account details")).toBeInTheDocument()
    expect(screen.getByText("Profile panel")).toBeVisible()

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
