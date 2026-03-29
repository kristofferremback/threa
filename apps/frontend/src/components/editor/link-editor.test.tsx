import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { LinkEditor } from "./link-editor"

function createEditorStub() {
  const chain = {
    focus: vi.fn(() => chain),
    setTextSelection: vi.fn(() => chain),
    extendMarkRange: vi.fn(() => chain),
    setLink: vi.fn(() => chain),
    unsetLink: vi.fn(() => chain),
    run: vi.fn(() => true),
  }

  return {
    getAttributes: vi.fn(() => ({ href: "https://example.com" })),
    chain: vi.fn(() => chain),
    commands: {
      focus: vi.fn(),
    },
    __chainState: chain,
  }
}

describe("LinkEditor", () => {
  it("restores the captured selection before updating a link", async () => {
    const user = userEvent.setup()
    const editor = createEditorStub()
    const onClose = vi.fn()

    render(
      <LinkEditor
        editor={editor as never}
        isActive
        initialUrl="https://example.com"
        selectionRange={{ from: 1, to: 4 }}
        onClose={onClose}
      />
    )

    await user.clear(screen.getByPlaceholderText("https://example.com"))
    await user.type(screen.getByPlaceholderText("https://example.com"), "threa.dev")
    await user.click(screen.getByRole("button", { name: "Update" }))

    expect(editor.__chainState.focus).toHaveBeenCalled()
    expect(editor.__chainState.setTextSelection).toHaveBeenCalledWith({ from: 1, to: 4 })
    expect(editor.__chainState.extendMarkRange).toHaveBeenCalledWith("link")
    expect(editor.__chainState.setLink).toHaveBeenCalledWith({ href: "https://threa.dev" })
    expect(editor.__chainState.run).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it("restores the captured selection when closing without changes", async () => {
    const user = userEvent.setup()
    const editor = createEditorStub()
    const onClose = vi.fn()

    render(
      <LinkEditor
        editor={editor as never}
        isActive
        initialUrl="https://example.com"
        selectionRange={{ from: 1, to: 4 }}
        onClose={onClose}
      />
    )

    await user.click(screen.getByRole("button", { name: /close/i }))

    expect(editor.__chainState.focus).toHaveBeenCalled()
    expect(editor.__chainState.setTextSelection).toHaveBeenCalledWith({ from: 1, to: 4 })
    expect(editor.__chainState.run).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
