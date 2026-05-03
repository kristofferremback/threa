import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { AssetKinds } from "@threa/types"
import { AssetExplorerService } from "./service"
import { AssetExplorerRepository, type AssetSearchRepoResult } from "./repository"
import { encodeCursor } from "./cursor"

function makeRepoRow(overrides: Partial<AssetSearchRepoResult> = {}): AssetSearchRepoResult {
  return {
    id: "attach_1",
    filename: "file.png",
    mimeType: "image/png",
    sizeBytes: 1024,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    uploadedBy: "usr_1",
    streamId: "stream_1",
    messageId: "msg_1",
    processingStatus: "completed",
    extractionSummary: null,
    hasVideoThumbnail: false,
    rank: 0,
    ...overrides,
  }
}

describe("AssetExplorerService", () => {
  afterEach(() => mock.restore())

  it("returns an empty page when no streams are accessible", async () => {
    const repoSpy = spyOn(AssetExplorerRepository, "search").mockResolvedValue([])
    const service = new AssetExplorerService({} as any)

    const result = await service.search({
      workspaceId: "ws_1",
      permissions: { accessibleStreamIds: [] },
      scope: { type: "stream", streamId: "stream_1" },
      query: "",
      exact: false,
      filters: {},
      cursor: null,
      limit: 30,
    })

    expect(result).toEqual({ results: [], nextCursor: null })
    expect(repoSpy).not.toHaveBeenCalled()
  })

  it("maps repo rows into wire shape with classified kind and thumbnail flag", async () => {
    spyOn(AssetExplorerRepository, "search").mockResolvedValue([
      makeRepoRow({ id: "a", mimeType: "image/png" }),
      makeRepoRow({ id: "b", mimeType: "video/mp4", hasVideoThumbnail: true }),
      makeRepoRow({ id: "c", mimeType: "video/mp4", hasVideoThumbnail: false }),
      makeRepoRow({ id: "d", mimeType: "application/pdf" }),
    ])
    const service = new AssetExplorerService({} as any)

    const { results } = await service.search({
      workspaceId: "ws_1",
      permissions: { accessibleStreamIds: ["stream_1"] },
      scope: { type: "stream", streamId: "stream_1" },
      query: "",
      exact: false,
      filters: {},
      cursor: null,
      limit: 30,
    })

    expect(results.map((r) => [r.id, r.kind, r.hasThumbnail])).toEqual([
      ["a", AssetKinds.IMAGE, true],
      ["b", AssetKinds.VIDEO, true],
      ["c", AssetKinds.VIDEO, false],
      ["d", AssetKinds.PDF, false],
    ])
  })

  it("emits a time cursor in browse mode when more results exist", async () => {
    const last = makeRepoRow({
      id: "attach_last",
      createdAt: new Date("2026-04-20T10:00:00.000Z"),
    })
    // Service requests `limit + 1` to detect overflow → 3 rows with limit=2 ⇒ hasMore.
    spyOn(AssetExplorerRepository, "search").mockResolvedValue([
      makeRepoRow({ id: "a" }),
      last,
      makeRepoRow({ id: "extra" }),
    ])

    const service = new AssetExplorerService({} as any)
    const { results, nextCursor } = await service.search({
      workspaceId: "ws_1",
      permissions: { accessibleStreamIds: ["stream_1"] },
      scope: { type: "stream", streamId: "stream_1" },
      query: "",
      exact: false,
      filters: {},
      cursor: null,
      limit: 2,
    })

    expect(results).toHaveLength(2)
    expect(nextCursor).toBe(encodeCursor({ kind: "time", createdAt: last.createdAt.toISOString(), id: last.id }))
  })

  it("emits an offset cursor when querying with overflow", async () => {
    spyOn(AssetExplorerRepository, "search").mockResolvedValue([
      makeRepoRow({ id: "a", rank: 1.0 }),
      makeRepoRow({ id: "b", rank: 0.5 }),
      makeRepoRow({ id: "extra", rank: 0.3 }),
    ])

    const service = new AssetExplorerService({} as any)
    const { nextCursor } = await service.search({
      workspaceId: "ws_1",
      permissions: { accessibleStreamIds: ["stream_1"] },
      scope: { type: "stream", streamId: "stream_1" },
      query: "report",
      exact: false,
      filters: {},
      cursor: null,
      limit: 2,
    })

    expect(nextCursor).toBe(encodeCursor({ kind: "offset", offset: 2 }))
  })

  it("returns null cursor when results fit within the limit", async () => {
    spyOn(AssetExplorerRepository, "search").mockResolvedValue([makeRepoRow({ id: "a" })])
    const service = new AssetExplorerService({} as any)

    const { nextCursor } = await service.search({
      workspaceId: "ws_1",
      permissions: { accessibleStreamIds: ["stream_1"] },
      scope: { type: "stream", streamId: "stream_1" },
      query: "",
      exact: false,
      filters: {},
      cursor: null,
      limit: 30,
    })

    expect(nextCursor).toBeNull()
  })

  it("forwards exact mode to the repository", async () => {
    const repoSpy = spyOn(AssetExplorerRepository, "search").mockResolvedValue([])
    const service = new AssetExplorerService({} as any)

    await service.search({
      workspaceId: "ws_1",
      permissions: { accessibleStreamIds: ["stream_1"] },
      scope: { type: "stream", streamId: "stream_1" },
      query: "ERR_TIMEOUT",
      exact: true,
      filters: {},
      cursor: null,
      limit: 30,
    })

    expect(repoSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ exact: true, query: "ERR_TIMEOUT" })
    )
  })
})
