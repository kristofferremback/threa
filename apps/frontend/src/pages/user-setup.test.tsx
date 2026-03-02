import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { render, screen, waitFor } from "@/test"
import { UserSetupPage } from "./user-setup"

const mockCheckSlugAvailable = vi.fn()
const mockCompleteUserSetup = vi.fn()

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

describe("UserSetupPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCompleteUserSetup.mockResolvedValue({
      id: "user_1",
      email: "kris@example.com",
      name: "Taken Name",
      workosUserId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    })
  })

  it("should keep submit enabled while the initial slug check is still pending", async () => {
    mockCheckSlugAvailable.mockImplementation(() => new Promise(() => {}))

    renderPage()

    await waitFor(() => {
      expect(mockCheckSlugAvailable).toHaveBeenCalledWith("ws_1", "taken-name", expect.any(AbortSignal))
    })

    expect(screen.getByRole("button", { name: "Complete Setup" })).toBeEnabled()
  })

  it("should disable submit when the auto-generated slug is known to be taken", async () => {
    mockCheckSlugAvailable.mockResolvedValue(false)

    renderPage()

    await waitFor(() => {
      expect(screen.getByText("This slug is already taken in this workspace.")).toBeInTheDocument()
    })

    expect(screen.getByRole("button", { name: "Complete Setup" })).toBeDisabled()
  })
})
