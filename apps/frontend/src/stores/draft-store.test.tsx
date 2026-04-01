import { describe, it, expect, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import {
  resetDraftStoreCache,
  seedDraftCache,
  useDraftMessagesFromStore,
  useDraftScratchpadsFromStore,
} from "./draft-store"

describe("draft store cache subscriptions", () => {
  beforeEach(() => {
    resetDraftStoreCache()
  })

  it("rerenders existing message readers when the draft cache is seeded", () => {
    const { result } = renderHook(() => useDraftMessagesFromStore("workspace_1"))

    expect(result.current).toEqual([])

    act(() => {
      seedDraftCache("workspace_1", {
        scratchpads: [],
        messages: [
          {
            id: "stream:stream_1",
            workspaceId: "workspace_1",
            contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] },
            attachments: [],
            updatedAt: Date.now(),
          },
        ],
      })
    })

    expect(result.current.map((draft) => draft.id)).toEqual(["stream:stream_1"])
  })

  it("rerenders existing scratchpad readers when the draft cache is seeded", () => {
    const { result } = renderHook(() => useDraftScratchpadsFromStore("workspace_1"))

    expect(result.current).toEqual([])

    act(() => {
      seedDraftCache("workspace_1", {
        scratchpads: [
          {
            id: "draft_1",
            workspaceId: "workspace_1",
            displayName: "Scratchpad",
            companionMode: "off",
            createdAt: Date.now(),
          },
        ],
        messages: [],
      })
    })

    expect(result.current.map((draft) => draft.id)).toEqual(["draft_1"])
  })
})
