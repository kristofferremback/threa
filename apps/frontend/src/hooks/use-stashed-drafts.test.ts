import { describe, it, expect, vi, beforeEach } from "vitest"
import { generateStashId, createStashedDraft, popStashedDraft, deleteStashedDraftById } from "./use-stashed-drafts"
import type { JSONContent } from "@threa/types"
import * as dbModule from "@/db"

const makeDoc = (text: string): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : undefined }],
})
const EMPTY_DOC: JSONContent = { type: "doc", content: [{ type: "paragraph" }] }

const mockAdd = vi.fn()
const mockGet = vi.fn()
const mockDelete = vi.fn()

describe("generateStashId", () => {
  it("uses the stash_ prefix (distinct from draft_)", () => {
    const id = generateStashId()
    expect(id.startsWith("stash_")).toBe(true)
    expect(id.startsWith("draft_")).toBe(false)
  })

  it("produces unique ids across calls", () => {
    const ids = new Set([generateStashId(), generateStashId(), generateStashId()])
    expect(ids.size).toBe(3)
  })
})

describe("createStashedDraft", () => {
  const workspaceId = "ws_123"
  const scope = "stream:stream_456"

  beforeEach(() => {
    vi.restoreAllMocks()
    mockAdd.mockReset()
    mockAdd.mockResolvedValue(undefined)

    vi.spyOn(dbModule.db.stashedDrafts, "add").mockImplementation(((...args: unknown[]) =>
      mockAdd(...args)) as unknown as typeof dbModule.db.stashedDrafts.add)
  })

  it("persists a row with workspaceId, scope, and contentJson", async () => {
    const content = makeDoc("Hello saved world")

    const row = await createStashedDraft(workspaceId, scope, { contentJson: content })

    expect(row).not.toBeNull()
    expect(row!.workspaceId).toBe(workspaceId)
    expect(row!.scope).toBe(scope)
    expect(row!.contentJson).toEqual(content)
    expect(row!.id.startsWith("stash_")).toBe(true)
    expect(mockAdd).toHaveBeenCalledTimes(1)
    expect(mockAdd.mock.calls[0][0]).toMatchObject({
      workspaceId,
      scope,
      contentJson: content,
    })
  })

  it("no-ops on empty content with no attachments", async () => {
    const row = await createStashedDraft(workspaceId, scope, { contentJson: EMPTY_DOC })

    expect(row).toBeNull()
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it("stashes attachment-only drafts (empty body + attachments)", async () => {
    const attachments = [{ id: "attach_1", filename: "a.png", mimeType: "image/png", sizeBytes: 10 }]

    const row = await createStashedDraft(workspaceId, scope, { contentJson: EMPTY_DOC, attachments })

    expect(row).not.toBeNull()
    expect(row!.attachments).toEqual(attachments)
    expect(mockAdd).toHaveBeenCalledTimes(1)
  })

  it("no-ops when scope is undefined (host still resolving)", async () => {
    const row = await createStashedDraft(workspaceId, undefined, { contentJson: makeDoc("x") })

    expect(row).toBeNull()
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it("no-ops when workspaceId is empty", async () => {
    const row = await createStashedDraft("", scope, { contentJson: makeDoc("x") })

    expect(row).toBeNull()
    expect(mockAdd).not.toHaveBeenCalled()
  })
})

describe("popStashedDraft", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockGet.mockReset()
    mockDelete.mockReset()
    mockGet.mockResolvedValue(undefined)
    mockDelete.mockResolvedValue(undefined)

    vi.spyOn(dbModule.db.stashedDrafts, "get").mockImplementation(((...args: unknown[]) =>
      mockGet(...args)) as unknown as typeof dbModule.db.stashedDrafts.get)
    vi.spyOn(dbModule.db.stashedDrafts, "delete").mockImplementation(((...args: unknown[]) =>
      mockDelete(...args)) as unknown as typeof dbModule.db.stashedDrafts.delete)
  })

  it("returns the row and deletes it from the table", async () => {
    const existing = {
      id: "stash_abc",
      workspaceId: "ws_123",
      scope: "stream:stream_456",
      contentJson: makeDoc("Saved earlier"),
      createdAt: 1000,
    }
    mockGet.mockResolvedValue(existing)

    const restored = await popStashedDraft("stash_abc")

    expect(restored).toEqual(existing)
    expect(mockDelete).toHaveBeenCalledWith("stash_abc")
  })

  it("returns null when the row is missing (no-op delete)", async () => {
    mockGet.mockResolvedValue(undefined)

    const restored = await popStashedDraft("stash_missing")

    expect(restored).toBeNull()
    expect(mockDelete).not.toHaveBeenCalled()
  })
})

describe("deleteStashedDraftById", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockDelete.mockReset()
    mockDelete.mockResolvedValue(undefined)

    vi.spyOn(dbModule.db.stashedDrafts, "delete").mockImplementation(((...args: unknown[]) =>
      mockDelete(...args)) as unknown as typeof dbModule.db.stashedDrafts.delete)
  })

  it("deletes the row by id", async () => {
    await deleteStashedDraftById("stash_xyz")

    expect(mockDelete).toHaveBeenCalledWith("stash_xyz")
  })
})
