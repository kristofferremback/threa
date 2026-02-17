import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { TooltipProvider } from "@/components/ui/tooltip"
import { MessageEditForm } from "./message-edit-form"
import type { JSONContent } from "@threa/types"

vi.mock("@/components/editor", () => ({
  RichEditor: ({
    value,
    onChange,
    onSubmit,
    placeholder,
  }: {
    value: JSONContent
    onChange: (v: JSONContent) => void
    onSubmit: () => void
    placeholder?: string
  }) => (
    <textarea
      data-testid="rich-editor"
      defaultValue={JSON.stringify(value)}
      placeholder={placeholder}
      onChange={(e) => {
        try {
          onChange(JSON.parse(e.target.value))
        } catch {
          // ignore parse errors in test
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault()
          onSubmit()
        }
      }}
    />
  ),
  DocumentEditorModal: () => null,
}))

vi.mock("@threa/prosemirror", () => ({
  serializeToMarkdown: (json: JSONContent) => {
    const text = json.content?.[0]?.content?.[0]?.text
    return text ?? ""
  },
  parseMarkdown: (md: string) => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: md }] }],
  }),
}))

vi.mock("@/api/messages", () => ({
  messagesApi: {
    update: vi.fn().mockResolvedValue({}),
  },
}))

const initialContentJson: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }],
}

function renderForm(props: Partial<React.ComponentProps<typeof MessageEditForm>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MessageEditForm
          messageId="msg_1"
          workspaceId="ws_1"
          initialContentJson={initialContentJson}
          onSave={vi.fn()}
          onCancel={vi.fn()}
          {...props}
        />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

describe("MessageEditForm", () => {
  it("should render editor with save and cancel buttons", () => {
    renderForm()

    expect(screen.getByTestId("rich-editor")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument()
  })

  it("should call onCancel when cancel button is clicked", async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()

    renderForm({ onCancel })

    await user.click(screen.getByRole("button", { name: "Cancel" }))

    expect(onCancel).toHaveBeenCalledOnce()
  })

  it("should call onCancel when Escape is pressed", () => {
    const onCancel = vi.fn()

    renderForm({ onCancel })

    fireEvent.keyDown(document, { key: "Escape" })

    expect(onCancel).toHaveBeenCalledOnce()
  })

  it("should show hint text for keyboard shortcuts", () => {
    renderForm()

    expect(screen.getByText("Esc")).toBeInTheDocument()
    expect(screen.getByText("↵")).toBeInTheDocument()
  })
})
