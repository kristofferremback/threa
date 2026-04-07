import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { forwardRef, useImperativeHandle } from "react"
import { AISettings } from "./ai-settings"
import type { JSONContent } from "@threa/types"

const updatePreferenceMock = vi.fn().mockResolvedValue(undefined)

let mockPreferences: { scratchpadCustomPrompt: string | null } = {
  scratchpadCustomPrompt: "Current instructions",
}

function extractText(node: JSONContent | undefined): string {
  if (!node) return ""
  if (node.type === "text") return node.text ?? ""
  return (node.content ?? []).map((child) => extractText(child)).join("")
}

function createDoc(text: string): JSONContent {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : undefined }],
  }
}

vi.mock("@/contexts", () => ({
  usePreferences: () => ({
    preferences: mockPreferences,
    updatePreference: updatePreferenceMock,
    isLoading: false,
  }),
}))

vi.mock("@/components/editor", () => {
  const RichEditor = forwardRef<
    {
      focus: () => void
      insertMention: () => void
      insertSlash: () => void
      insertEmoji: () => void
      getEditor: () => null
    },
    {
      value: JSONContent
      onChange: (value: JSONContent) => void
      onSubmit: () => void
      ariaLabel: string
    }
  >(function MockRichEditor({ value, onChange, onSubmit, ariaLabel }, ref) {
    useImperativeHandle(ref, () => ({
      focus: () => undefined,
      insertMention: () => undefined,
      insertSlash: () => undefined,
      insertEmoji: () => undefined,
      getEditor: () => null,
    }))

    return (
      <textarea
        aria-label={ariaLabel}
        value={extractText(value)}
        onChange={(event) => onChange(createDoc(event.target.value))}
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.metaKey) {
            event.preventDefault()
            onSubmit()
          }
        }}
      />
    )
  })

  const EditorActionBar = ({ onFormatOpenChange, formatOpen, trailingContent }: Record<string, any>) => (
    <div>
      <button type="button" onClick={() => onFormatOpenChange(!formatOpen)}>
        Formatting
      </button>
      {trailingContent}
    </div>
  )

  return { RichEditor, EditorActionBar }
})

describe("AISettings", () => {
  beforeEach(() => {
    mockPreferences = { scratchpadCustomPrompt: "Current instructions" }
    updatePreferenceMock.mockClear()
  })

  it("saves updated scratchpad instructions", async () => {
    const user = userEvent.setup()
    render(<AISettings />)

    const editor = screen.getByLabelText("Scratchpad custom prompt editor")
    await user.clear(editor)
    await user.type(editor, "Be concise and practical.")
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(updatePreferenceMock).toHaveBeenCalledWith("scratchpadCustomPrompt", "Be concise and practical.")
  })

  it("clears the saved prompt when saving an empty editor", async () => {
    const user = userEvent.setup()
    render(<AISettings />)

    const editor = screen.getByLabelText("Scratchpad custom prompt editor")
    await user.clear(editor)
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(updatePreferenceMock).toHaveBeenCalledWith("scratchpadCustomPrompt", null)
  })

  it("resets unsaved edits back to the saved prompt", async () => {
    const user = userEvent.setup()
    render(<AISettings />)

    const editor = screen.getByLabelText("Scratchpad custom prompt editor") as HTMLTextAreaElement
    await user.clear(editor)
    await user.type(editor, "Temporary draft")
    await user.click(screen.getByRole("button", { name: "Reset" }))

    expect(editor.value).toBe("Current instructions")
  })
})
