import { describe, expect, it, beforeEach, vi } from "vitest"
import { render, screen } from "@/test"
import { ConnectionStatus } from "./connection-status"
import * as contextsModule from "@/contexts"
import * as pageActivityModule from "@/hooks/use-page-activity"

const mockState = {
  phase: "ready" as "loading" | "skeleton" | "ready",
  socketStatus: "connected" as "connected" | "connecting" | "reconnecting" | "disconnected",
  online: true,
  visible: true,
}

describe("ConnectionStatus", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockState.phase = "ready"
    mockState.socketStatus = "connected"
    mockState.online = true
    mockState.visible = true
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    })
    vi.spyOn(contextsModule, "useCoordinatedLoading").mockImplementation(
      () => ({ phase: mockState.phase }) as unknown as ReturnType<typeof contextsModule.useCoordinatedLoading>
    )
    vi.spyOn(contextsModule, "useSocketStatus").mockImplementation(
      () => mockState.socketStatus as unknown as ReturnType<typeof contextsModule.useSocketStatus>
    )
    vi.spyOn(pageActivityModule, "usePageActivity").mockImplementation(
      () =>
        ({
          isVisible: mockState.visible,
          isFocused: true,
          isActive: mockState.visible,
        }) as unknown as ReturnType<typeof pageActivityModule.usePageActivity>
    )
  })

  it("does not render during the initial coordinated load", () => {
    mockState.phase = "loading"
    mockState.socketStatus = "disconnected"

    const { container } = render(<ConnectionStatus />)

    expect(container).toBeEmptyDOMElement()
  })

  it("does not render while the socket is still connecting", () => {
    mockState.socketStatus = "connecting"

    const { container } = render(<ConnectionStatus />)

    expect(container).toBeEmptyDOMElement()
  })

  it("renders the offline pill after the initial reveal when the browser is offline", () => {
    mockState.socketStatus = "disconnected"
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    })

    render(<ConnectionStatus />)

    expect(screen.getByText("Offline")).toBeInTheDocument()
  })

  it("does not render when the page is hidden during teardown", () => {
    mockState.socketStatus = "reconnecting"
    mockState.visible = false

    const { container } = render(<ConnectionStatus />)

    expect(container).toBeEmptyDOMElement()
  })
})
