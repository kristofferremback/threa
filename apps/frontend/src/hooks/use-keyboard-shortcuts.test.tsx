import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { useKeyboardShortcuts } from "./use-keyboard-shortcuts"

const mockPreferences = {
  keyboardShortcuts: {} as Record<string, string>,
}

vi.mock("@/contexts", () => ({
  usePreferences: () => ({
    preferences: mockPreferences,
  }),
}))

function TestShortcutHandler({
  onSearchInStream,
  enabled = true,
}: {
  onSearchInStream: () => void
  enabled?: boolean
}) {
  useKeyboardShortcuts(
    {
      searchInStream: onSearchInStream,
    },
    enabled
  )

  return <input aria-label="Editor" />
}

describe("useKeyboardShortcuts", () => {
  beforeEach(() => {
    mockPreferences.keyboardShortcuts = {}
  })

  it("triggers searchInStream on the default mod+f binding", () => {
    const onSearchInStream = vi.fn()

    render(<TestShortcutHandler onSearchInStream={onSearchInStream} />)

    fireEvent.keyDown(document, { key: "f", ctrlKey: true })

    expect(onSearchInStream).toHaveBeenCalledOnce()
  })

  it("respects custom searchInStream bindings", () => {
    const onSearchInStream = vi.fn()
    mockPreferences.keyboardShortcuts = { searchInStream: "mod+shift+f" }

    render(<TestShortcutHandler onSearchInStream={onSearchInStream} />)

    fireEvent.keyDown(document, { key: "f", ctrlKey: true })
    fireEvent.keyDown(document, { key: "f", ctrlKey: true, shiftKey: true })

    expect(onSearchInStream).toHaveBeenCalledOnce()
  })

  it("allows global searchInStream shortcuts while focus is in an input", () => {
    const onSearchInStream = vi.fn()

    render(<TestShortcutHandler onSearchInStream={onSearchInStream} />)

    const input = screen.getByRole("textbox", { name: "Editor" })
    input.focus()
    fireEvent.keyDown(input, { key: "f", ctrlKey: true })

    expect(onSearchInStream).toHaveBeenCalledOnce()
  })
})
