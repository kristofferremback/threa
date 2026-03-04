import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Toaster } from "./sonner"

interface MockToast {
  id: string
  position?: string
  dismissible?: boolean
  toasterId?: string
}

const mockState = vi.hoisted(() => ({
  dismissToast: vi.fn(),
  isMobile: false,
  toasts: [] as MockToast[],
}))

vi.mock("@/contexts", () => ({
  usePreferences: () => ({ resolvedTheme: "light" }),
}))

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mockState.isMobile,
}))

vi.mock("sonner", async () => {
  const React = await import("react")

  const MockSonner = React.forwardRef<HTMLElement, { id?: string; position?: string; className?: string }>(
    function MockSonner(props, ref) {
      const defaultPosition = props.position ?? "bottom-right"
      const visibleToasts = props.id
        ? mockState.toasts.filter((activeToast) => activeToast.toasterId === props.id)
        : mockState.toasts.filter((activeToast) => !activeToast.toasterId)

      return (
        <section ref={ref} data-testid="sonner-root" data-position={props.position} className={props.className}>
          <ol
            data-sonner-toaster=""
            data-y-position={defaultPosition.split("-")[0]}
            data-x-position={defaultPosition.split("-")[1]}
          >
            {visibleToasts.map((activeToast, index) => {
              const position = activeToast.position ?? defaultPosition
              const [y, x] = position.split("-")
              return (
                <li
                  key={activeToast.id}
                  data-sonner-toast=""
                  data-index={index}
                  data-y-position={y}
                  data-x-position={x}
                  data-dismissible={activeToast.dismissible === false ? "false" : "true"}
                >
                  <span>{activeToast.id}</span>
                  <button type="button">Action</button>
                </li>
              )
            })}
          </ol>
        </section>
      )
    }
  )

  return {
    Toaster: MockSonner,
    useSonner: () => ({ toasts: mockState.toasts }),
    toast: {
      dismiss: mockState.dismissToast,
    },
  }
})

describe("Toaster", () => {
  beforeEach(() => {
    mockState.dismissToast.mockReset()
    mockState.isMobile = false
    mockState.toasts = []
  })

  it("uses top-center placement on mobile", () => {
    mockState.isMobile = true

    render(<Toaster />)

    expect(screen.getByTestId("sonner-root")).toHaveAttribute("data-position", "top-center")
  })

  it("uses bottom-right placement on desktop", () => {
    render(<Toaster />)

    expect(screen.getByTestId("sonner-root")).toHaveAttribute("data-position", "bottom-right")
  })

  it("dismisses a toast when tapping its body", async () => {
    const user = userEvent.setup()
    mockState.toasts = [{ id: "toast_1" }, { id: "toast_2" }]

    render(<Toaster />)
    await user.click(screen.getByText("toast_2"))

    expect(mockState.dismissToast).toHaveBeenCalledWith("toast_2")
  })

  it("does not dismiss when tapping toast action controls", async () => {
    const user = userEvent.setup()
    mockState.toasts = [{ id: "toast_1" }]

    render(<Toaster />)
    await user.click(screen.getByRole("button", { name: "Action" }))

    expect(mockState.dismissToast).not.toHaveBeenCalled()
  })

  it("does not dismiss non-dismissible toasts", async () => {
    const user = userEvent.setup()
    mockState.toasts = [{ id: "toast_1", dismissible: false }]

    render(<Toaster />)
    await user.click(screen.getByText("toast_1"))

    expect(mockState.dismissToast).not.toHaveBeenCalled()
  })
})
