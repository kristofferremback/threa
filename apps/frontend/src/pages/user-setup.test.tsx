import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "../test"
import { UserSetupPage } from "./user-setup"

const mockCheckSlugAvailable = vi.fn()
const mockCompleteUserSetup = vi.fn()
const SLUG_CHECK_DEBOUNCE_MS = 500

vi.mock("@/auth", () => ({
  useUser: () => ({
    id: "user_1",
    email: "kris@example.com",
    name: "Taken Name",
    workosUserId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }),
}))

vi.mock("@/api/workspaces", () => ({
  workspacesApi: {
    checkSlugAvailable: (...args: unknown[]) => mockCheckSlugAvailable(...args),
    completeUserSetup: (...args: unknown[]) => mockCompleteUserSetup(...args),
  },
}))

vi.mock("@/components/ui/timezone-picker", () => ({
  TimezonePicker: () => <div data-testid="timezone-picker" />,
}))

vi.mock("@/components/ui/locale-picker", () => ({
  LocalePicker: () => <div data-testid="locale-picker" />,
}))

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/w/ws_1/setup"]}>
        <Routes>
          <Route path="/w/:workspaceId/setup" element={<UserSetupPage />} />
          <Route path="/w/:workspaceId" element={<div data-testid="workspace-route" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

async function advanceSlugDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SLUG_CHECK_DEBOUNCE_MS)
  })
}

describe("UserSetupPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockCompleteUserSetup.mockResolvedValue({
      id: "user_1",
      email: "kris@example.com",
      name: "Taken Name",
      workosUserId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it("should keep submit enabled while the initial slug check is still pending", async () => {
    mockCheckSlugAvailable.mockImplementation(() => new Promise(() => {}))

    renderPage()
    await advanceSlugDebounce()

    expect(mockCheckSlugAvailable).toHaveBeenCalledWith("ws_1", "taken-name", expect.any(AbortSignal))
    expect(screen.getByRole("button", { name: "Complete Setup" })).toBeEnabled()
  })

  it("should disable submit when the auto-generated slug is known to be taken", async () => {
    mockCheckSlugAvailable.mockResolvedValue(false)

    renderPage()
    await advanceSlugDebounce()

    expect(screen.getByText("This slug is already taken in this workspace.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Complete Setup" })).toBeDisabled()
  })
})
