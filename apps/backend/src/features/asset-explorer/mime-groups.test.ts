import { describe, expect, it } from "bun:test"
import { AssetKinds } from "@threa/types"
import { classifyAssetKind, mimePatternsForKinds } from "./mime-groups"

describe("classifyAssetKind", () => {
  it("buckets common mime prefixes", () => {
    expect(classifyAssetKind("image/png")).toBe(AssetKinds.IMAGE)
    expect(classifyAssetKind("image/svg+xml")).toBe(AssetKinds.IMAGE)
    expect(classifyAssetKind("video/mp4")).toBe(AssetKinds.VIDEO)
    expect(classifyAssetKind("application/pdf")).toBe(AssetKinds.PDF)
    expect(classifyAssetKind("text/plain")).toBe(AssetKinds.TEXT)
    expect(classifyAssetKind("application/json")).toBe(AssetKinds.TEXT)
    expect(classifyAssetKind("text/csv")).toBe(AssetKinds.SPREADSHEET)
  })

  it("classifies office formats", () => {
    expect(classifyAssetKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(
      AssetKinds.DOCUMENT
    )
    expect(classifyAssetKind("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe(
      AssetKinds.SPREADSHEET
    )
  })

  it("treats octet-stream with video extension as video", () => {
    expect(classifyAssetKind("application/octet-stream", "clip.mp4")).toBe(AssetKinds.VIDEO)
    expect(classifyAssetKind("application/octet-stream", "noise.bin")).toBe(AssetKinds.OTHER)
  })

  it("falls back to other for unknown mime types", () => {
    expect(classifyAssetKind("application/zip")).toBe(AssetKinds.OTHER)
    expect(classifyAssetKind("application/octet-stream")).toBe(AssetKinds.OTHER)
  })
})

describe("mimePatternsForKinds", () => {
  it("returns prefixes for prefix-based kinds and exacts for fixed kinds", () => {
    const { prefixes, exact } = mimePatternsForKinds([AssetKinds.IMAGE, AssetKinds.PDF])
    expect(prefixes).toContain("image/%")
    expect(exact).toContain("application/pdf")
  })

  it("includes csv as a spreadsheet exact match", () => {
    const { exact } = mimePatternsForKinds([AssetKinds.SPREADSHEET])
    expect(exact).toContain("text/csv")
    expect(exact).toContain("application/vnd.ms-excel")
  })

  it("returns empty arrays when no kinds requested", () => {
    expect(mimePatternsForKinds([])).toEqual({ prefixes: [], exact: [] })
  })
})
