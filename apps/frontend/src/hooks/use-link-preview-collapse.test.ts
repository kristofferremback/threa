import { describe, it, expect, beforeEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { useLinkPreviewCollapse } from "./use-link-preview-collapse"
import { db } from "@/db"

describe("useLinkPreviewCollapse", () => {
  beforeEach(async () => {
    await db.linkPreviewCollapse.clear()
  })

  it("defaults to collapsed when no row is persisted", () => {
    const { result } = renderHook(() => useLinkPreviewCollapse("msg_1", "preview_1"))

    expect(result.current.expanded).toBe(false)
    expect(result.current.canToggle).toBe(true)
  })

  it("persists expansion per `(messageId, previewId)` and survives remount", async () => {
    const { result, unmount } = renderHook(() => useLinkPreviewCollapse("msg_1", "preview_1"))

    act(() => {
      result.current.toggle()
    })

    await waitFor(() => {
      expect(result.current.expanded).toBe(true)
    })

    const stored = await db.linkPreviewCollapse.get("msg_1:preview_1")
    expect(stored?.expanded).toBe(true)
    expect(stored?.messageId).toBe("msg_1")
    expect(stored?.previewId).toBe("preview_1")

    unmount()

    const { result: remounted } = renderHook(() => useLinkPreviewCollapse("msg_1", "preview_1"))
    await waitFor(() => {
      expect(remounted.current.expanded).toBe(true)
    })
  })

  it("scopes state per preview so sibling previews are independent", async () => {
    const { result: a } = renderHook(() => useLinkPreviewCollapse("msg_1", "preview_a"))
    const { result: b } = renderHook(() => useLinkPreviewCollapse("msg_1", "preview_b"))

    act(() => {
      a.current.toggle()
    })

    await waitFor(() => {
      expect(a.current.expanded).toBe(true)
    })
    expect(b.current.expanded).toBe(false)
  })

  it("disables toggling and persistence when messageId is absent", () => {
    const { result } = renderHook(() => useLinkPreviewCollapse(undefined, "preview_1"))

    expect(result.current.canToggle).toBe(false)

    act(() => {
      result.current.toggle()
    })

    expect(result.current.expanded).toBe(false)
  })
})
