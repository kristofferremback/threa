import { MemoryRouter, Route, Routes } from "react-router-dom"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@/test"
import { AttachmentExplorer } from "./attachment-explorer"
import * as attachmentsApiModule from "@/api/attachments"
import * as workspaceStoreModule from "@/stores/workspace-store"
import * as preferencesModule from "@/contexts/preferences-context"

function makeItem(
  overrides: Partial<attachmentsApiModule.AttachmentSearchItem> = {}
): attachmentsApiModule.AttachmentSearchItem {
  return {
    id: "attach_a",
    workspaceId: "ws_1",
    streamId: "str_design",
    messageId: "msg_1",
    uploadedBy: "usr_1",
    filename: "logo.png",
    mimeType: "image/png",
    sizeBytes: 1024,
    storageProvider: "s3",
    storagePath: "ws_1/attach_a/logo.png",
    processingStatus: "completed",
    safetyStatus: "clean",
    createdAt: new Date("2026-05-01T10:00:00.000Z").toISOString() as unknown as Date,
    extraction: null,
    streamSlug: "design",
    streamName: "Design",
    streamType: "channel",
    uploaderSlug: "mira",
    uploaderName: "Mira",
    referenceCount: 0,
    ...overrides,
  } as attachmentsApiModule.AttachmentSearchItem
}

function renderExplorer(initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/w/:workspaceId/*" element={<AttachmentExplorer workspaceId="ws_1" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe("AttachmentExplorer", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(workspaceStoreModule, "useWorkspaceStreams").mockReturnValue([])
    vi.spyOn(workspaceStoreModule, "useWorkspaceUsers").mockReturnValue([])
    vi.spyOn(preferencesModule, "usePreferences").mockReturnValue({
      preferences: { dateFormat: "YYYY-MM-DD", timeFormat: "24h", timezone: "UTC" } as never,
    } as unknown as ReturnType<typeof preferencesModule.usePreferences>)
    vi.spyOn(attachmentsApiModule.attachmentsApi, "getDownloadUrl").mockResolvedValue("https://example.test/blob")
  })

  it("does not render the dialog when the explorer URL marker is absent", () => {
    vi.spyOn(attachmentsApiModule.attachmentsApi, "search").mockResolvedValue({ items: [], nextCursor: null })
    renderExplorer("/w/ws_1")
    expect(screen.queryByTestId("attachment-explorer")).not.toBeInTheDocument()
  })

  it("renders the dialog and issues a workspace-scoped search when the URL marker is present", async () => {
    const searchSpy = vi
      .spyOn(attachmentsApiModule.attachmentsApi, "search")
      .mockResolvedValue({ items: [makeItem()], nextCursor: null })

    renderExplorer("/w/ws_1?explorer=")

    await waitFor(() => expect(screen.getByTestId("attachment-explorer")).toBeInTheDocument())
    await waitFor(() => expect(searchSpy).toHaveBeenCalled())

    const args = searchSpy.mock.calls[0]
    expect(args[0]).toBe("ws_1")
    expect(args[1]).toMatchObject({ limit: 30 })
    expect(args[1]).not.toHaveProperty("streamIds")

    expect(await screen.findByText("logo.png")).toBeInTheDocument()
  })

  it("forwards a stream scope from the URL into the search request", async () => {
    const searchSpy = vi
      .spyOn(attachmentsApiModule.attachmentsApi, "search")
      .mockResolvedValue({ items: [], nextCursor: null })

    renderExplorer("/w/ws_1?explorer=&streams=str_design")

    await waitFor(() => expect(searchSpy).toHaveBeenCalled())
    expect(searchSpy.mock.calls[0]![1]).toMatchObject({ streamIds: ["str_design"], limit: 30 })
  })

  it("treats a quoted free-text query as exact substring", async () => {
    const searchSpy = vi
      .spyOn(attachmentsApiModule.attachmentsApi, "search")
      .mockResolvedValue({ items: [], nextCursor: null })

    renderExplorer(`/w/ws_1?explorer=&q=${encodeURIComponent('"q2 roadmap"')}`)

    await waitFor(() => expect(searchSpy).toHaveBeenCalled())
    expect(searchSpy.mock.calls[0]![1]).toMatchObject({ queryText: "q2 roadmap", exact: true })
  })

  it("renders the filtered-empty state when filters are active and results are empty", async () => {
    vi.spyOn(attachmentsApiModule.attachmentsApi, "search").mockResolvedValue({ items: [], nextCursor: null })

    renderExplorer("/w/ws_1?explorer=&type=pdf")

    expect(await screen.findByText("Nothing in this scope")).toBeInTheDocument()
  })
})
