import { describe, expect, it } from "vitest"
import {
  isExplorerOpen,
  readExplorerFiltersFromParams,
  writeExplorerFiltersToParams,
  EXPLORER_PARAM,
} from "./use-explorer-url-state"

describe("isExplorerOpen", () => {
  it("returns true when the marker param is present", () => {
    expect(isExplorerOpen(new URLSearchParams("explorer="))).toBe(true)
    expect(isExplorerOpen(new URLSearchParams("explorer=open"))).toBe(true)
  })

  it("returns false when the marker is absent", () => {
    expect(isExplorerOpen(new URLSearchParams(""))).toBe(false)
    expect(isExplorerOpen(new URLSearchParams("scope=stream-str_1"))).toBe(false)
  })
})

describe("readExplorerFiltersFromParams", () => {
  it("returns workspace-scoped defaults for an empty URL", () => {
    const filters = readExplorerFiltersFromParams(new URLSearchParams(""))
    expect(filters).toEqual({
      scope: { kind: "workspace" },
      queryText: "",
      categories: [],
      uploadedBy: null,
      nameSubstring: null,
      before: null,
      after: null,
      view: "list",
      selectedAttachmentId: null,
    })
  })

  it("parses a stream scope and explicit filters", () => {
    const params = new URLSearchParams(
      "explorer=&scope=stream-str_design&q=invoice&type=image,pdf&from=usr_1&name=q2&before=2026-04-01T00:00:00.000Z&after=2026-01-01T00:00:00.000Z&view=grid&selected=attach_1"
    )
    expect(readExplorerFiltersFromParams(params)).toEqual({
      scope: { kind: "stream", streamId: "str_design" },
      queryText: "invoice",
      categories: ["image", "pdf"],
      uploadedBy: "usr_1",
      nameSubstring: "q2",
      before: "2026-04-01T00:00:00.000Z",
      after: "2026-01-01T00:00:00.000Z",
      view: "grid",
      selectedAttachmentId: "attach_1",
    })
  })

  it("ignores unknown category values rather than throwing", () => {
    const filters = readExplorerFiltersFromParams(new URLSearchParams("type=image,bogus,pdf"))
    expect(filters.categories).toEqual(["image", "pdf"])
  })

  it("falls back to a workspace scope when the scope token is malformed", () => {
    expect(readExplorerFiltersFromParams(new URLSearchParams("scope=stream-")).scope).toEqual({ kind: "workspace" })
    expect(readExplorerFiltersFromParams(new URLSearchParams("scope=garbage")).scope).toEqual({ kind: "workspace" })
  })
})

describe("writeExplorerFiltersToParams", () => {
  it("round-trips a full filter object back through the params parser", () => {
    const start = new URLSearchParams()
    const written = writeExplorerFiltersToParams(start, {
      scope: { kind: "stream", streamId: "str_design" },
      queryText: "invoice",
      categories: ["image", "pdf"],
      uploadedBy: "usr_1",
      nameSubstring: "q2",
      before: "2026-04-01T00:00:00.000Z",
      after: "2026-01-01T00:00:00.000Z",
      view: "grid",
      selectedAttachmentId: "attach_1",
    })
    written.set(EXPLORER_PARAM, "")

    const round = readExplorerFiltersFromParams(written)
    expect(round).toEqual({
      scope: { kind: "stream", streamId: "str_design" },
      queryText: "invoice",
      categories: ["image", "pdf"],
      uploadedBy: "usr_1",
      nameSubstring: "q2",
      before: "2026-04-01T00:00:00.000Z",
      after: "2026-01-01T00:00:00.000Z",
      view: "grid",
      selectedAttachmentId: "attach_1",
    })
  })

  it("clears params when filters are reset to their defaults", () => {
    const initial = new URLSearchParams(
      "scope=stream-str_design&q=invoice&type=image&from=usr_1&name=q2&before=x&after=y&view=grid&selected=attach_1"
    )
    const cleared = writeExplorerFiltersToParams(initial, {
      scope: { kind: "workspace" },
      queryText: "",
      categories: [],
      uploadedBy: null,
      nameSubstring: null,
      before: null,
      after: null,
      view: "list",
      selectedAttachmentId: null,
    })
    expect(cleared.toString()).toBe("")
  })

  it("preserves non-explorer params when narrowing the scope", () => {
    const initial = new URLSearchParams("panel=str_other&explorer=")
    const updated = writeExplorerFiltersToParams(initial, {
      scope: { kind: "stream", streamId: "str_design" },
    })
    expect(updated.get("panel")).toBe("str_other")
    expect(updated.get("scope")).toBe("stream-str_design")
    expect(updated.has("explorer")).toBe(true)
  })
})
