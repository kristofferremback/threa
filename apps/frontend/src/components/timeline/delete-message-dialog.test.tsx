import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { DeleteMessageDialog } from "./delete-message-dialog"

describe("DeleteMessageDialog", () => {
  it("should render confirmation text when open", () => {
    render(<DeleteMessageDialog open={true} onOpenChange={vi.fn()} onConfirm={vi.fn()} isDeleting={false} />)

    expect(screen.getByText("Delete message")).toBeInTheDocument()
    expect(screen.getByText(/Are you sure you want to delete this message/)).toBeInTheDocument()
  })

  it("should call onConfirm when delete button is clicked", async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    render(<DeleteMessageDialog open={true} onOpenChange={vi.fn()} onConfirm={onConfirm} isDeleting={false} />)

    await user.click(screen.getByRole("button", { name: "Delete" }))

    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it("should show loading state while deleting", () => {
    render(<DeleteMessageDialog open={true} onOpenChange={vi.fn()} onConfirm={vi.fn()} isDeleting={true} />)

    expect(screen.getByRole("button", { name: "Deleting..." })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled()
  })

  it("should not render content when closed", () => {
    render(<DeleteMessageDialog open={false} onOpenChange={vi.fn()} onConfirm={vi.fn()} isDeleting={false} />)

    expect(screen.queryByText("Delete message")).not.toBeInTheDocument()
  })
})
