import { describe, it, expect, vi, beforeEach } from "vitest"
import { spyOnExport } from "@/test/spy"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import React from "react"
import { Toaster } from "./sonner"
import * as contextsModule from "@/contexts"
import * as useMobileModule from "@/hooks/use-mobile"
import * as sonnerModule from "@/lib/sonner-module"

interface MockToast {
  id: string
  position?: string
  dismissible?: boolean
  toasterId?: string
}

const mockState = {
  dismissToast: vi.fn(),
  isMobile: false,
  toasts: [] as MockToast[],
}

describe("Toaster", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockState.dismissToast.mockReset()
    mockState.isMobile = false
    mockState.toasts = []

    vi.spyOn(contextsModule, "usePreferences").mockReturnValue({ resolvedTheme: "light" } as unknown as ReturnType<
      typeof contextsModule.usePreferences
    >)

    vi.spyOn(useMobileModule, "useIsMobile").mockImplementation(() => mockState.isMobile)

    // Replace the Toaster from sonner with a mock that renders a structured
    // DOM we can interact with, using the current mockState.toasts snapshot.
    const MockSonner = React.forwardRef<HTMLElement, { id?: string; position?: string; className?: string }>(
      function MockSonner(props, ref) {
        const defaultPosition = props.position ?? "bottom-right"
        const visibleToasts = props.id
          ? mockState.toasts.filter((activeToast) => activeToast.toasterId === props.id)
          : mockState.toasts.filter((activeToast) => !activeToast.toasterId)
        const possiblePositions = Array.from(
          new Set([
            defaultPosition,
            ...visibleToasts.filter((activeToast) => activeToast.position).map((activeToast) => activeToast.position!),
          ])
        )

        return (
          <section ref={ref} data-testid="sonner-root" data-position={props.position} className={props.className}>
            {possiblePositions.map((position, positionIndex) => {
              const [y, x] = position.split("-")
              const toastsAtPosition = visibleToasts.filter(
                (activeToast) => (!activeToast.position && positionIndex === 0) || activeToast.position === position
              )

              return (
                <ol key={position} data-sonner-toaster="" data-y-position={y} data-x-position={x}>
                  {toastsAtPosition.map((activeToast, index) => (
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
                  ))}
                </ol>
              )
            })}
          </section>
        )
      }
    )

    spyOnExport(sonnerModule, "SonnerRoot").mockReturnValue(MockSonner as unknown as typeof sonnerModule.SonnerRoot)
    spyOnExport(sonnerModule, "useSonner").mockReturnValue((() => ({
      toasts: mockState.toasts,
    })) as unknown as typeof sonnerModule.useSonner)

    // `toast` is a callable with methods — we only need dismiss() for these tests.
    // Replace the getter with an object shaped like the minimum sonner API we use.
    const mockToast = {
      dismiss: mockState.dismissToast,
    } as unknown as typeof sonnerModule.toast
    spyOnExport(sonnerModule, "toast").mockReturnValue(mockToast)
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

  it("dismisses the correct toast when multiple positions are active", async () => {
    const user = userEvent.setup()
    mockState.toasts = [
      { id: "top_1", position: "top-center" },
      { id: "bottom_1", position: "bottom-right" },
      { id: "top_2", position: "top-center" },
    ]

    render(<Toaster />)
    await user.click(screen.getByText("top_2"))

    expect(mockState.dismissToast).toHaveBeenCalledWith("top_2")
    expect(mockState.dismissToast).not.toHaveBeenCalledWith("top_1")
  })
})
