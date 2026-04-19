import { describe, expect, it } from "vitest"
import {
  computeTimelineLoadState,
  filterEventsForDisplay,
  getCachedWindowFloor,
  getDisplayFloor,
  getMinimumSequence,
  getNextBootstrapFloorState,
  getOldestSequence,
} from "./use-events"

describe("useEvents helpers", () => {
  it("uses the lower older-page floor when scrollback extends past bootstrap", () => {
    const bootstrapFloor = getMinimumSequence([{ sequence: "100" }, { sequence: "120" }, { sequence: "150" }])
    const olderFloor = getMinimumSequence([{ sequence: "50" }, { sequence: "75" }])

    expect(getDisplayFloor(bootstrapFloor, olderFloor)).toBe(50n)
  })

  it("widens the visible window when older pages have been fetched", () => {
    const displayFloor = getDisplayFloor(100n, 50n)
    const displayed = filterEventsForDisplay(
      [{ sequence: "10" }, { sequence: "50" }, { sequence: "75" }, { sequence: "100" }, { sequence: "150" }],
      displayFloor
    )

    expect(displayed.map((event) => event.sequence)).toEqual(["50", "75", "100", "150"])
  })

  it("limits pre-bootstrap cached history to a bootstrap-sized window", () => {
    const cachedWindowFloor = getCachedWindowFloor(
      [{ sequence: "10" }, { sequence: "20" }, { sequence: "30" }, { sequence: "40" }, { sequence: "50" }],
      3
    )

    const displayed = filterEventsForDisplay(
      [{ sequence: "10" }, { sequence: "20" }, { sequence: "30" }, { sequence: "40" }, { sequence: "50" }],
      cachedWindowFloor
    )

    expect(cachedWindowFloor).toBe(30n)
    expect(displayed.map((event) => event.sequence)).toEqual(["30", "40", "50"])
  })

  it("shows the full cached timeline when it already fits within one bootstrap-sized page", () => {
    expect(getCachedWindowFloor([{ sequence: "10" }, { sequence: "20" }, { sequence: "30" }], 3)).toBeNull()
  })

  it("keeps optimistic events visible regardless of floor", () => {
    const displayed = filterEventsForDisplay(
      [
        { sequence: "10" },
        { sequence: "20", _status: "pending" },
        { sequence: "30", _status: "failed" },
        { sequence: "100" },
      ],
      100n
    )

    expect(displayed.map((event) => [event.sequence, event._status ?? null])).toEqual([
      ["20", "pending"],
      ["30", "failed"],
      ["100", null],
    ])
  })

  it("anchors older-page fetches from the visible window, not hidden stale cache", () => {
    expect(getOldestSequence([{ sequence: "100" }, { sequence: "120" }, { sequence: "150" }])).toBe("100")
  })

  it("resets the bootstrap floor when reconnect replace increments windowVersion", () => {
    const initial = getNextBootstrapFloorState(null, "stream_1", 100n, 0)
    const appendRefetch = getNextBootstrapFloorState(initial.state, "stream_1", 140n, 0)
    const replaceRefetch = getNextBootstrapFloorState(appendRefetch.state, "stream_1", 200n, 1)

    expect(initial.floor).toBe(100n)
    expect(appendRefetch.floor).toBe(100n)
    expect(replaceRefetch.floor).toBe(200n)
  })
})

describe("computeTimelineLoadState", () => {
  it("stays blank while IDB is resolving within the grace window", () => {
    expect(
      computeTimelineLoadState({
        idbResolved: false,
        hasAnyEvents: false,
        isBootstrapLoading: true,
        idbResolveTimedOut: false,
      })
    ).toEqual({ isLoading: false, isConfirmedEmpty: false })
  })

  it("flips to skeleton once IDB resolution exceeds the grace window", () => {
    expect(
      computeTimelineLoadState({
        idbResolved: false,
        hasAnyEvents: false,
        isBootstrapLoading: false,
        idbResolveTimedOut: true,
      })
    ).toEqual({ isLoading: true, isConfirmedEmpty: false })
  })

  it("shows skeleton when IDB resolves empty and bootstrap is still fetching", () => {
    expect(
      computeTimelineLoadState({
        idbResolved: true,
        hasAnyEvents: false,
        isBootstrapLoading: true,
        idbResolveTimedOut: false,
      })
    ).toEqual({ isLoading: true, isConfirmedEmpty: false })
  })

  it("shows confirmed-empty once IDB is resolved and bootstrap has settled", () => {
    expect(
      computeTimelineLoadState({
        idbResolved: true,
        hasAnyEvents: false,
        isBootstrapLoading: false,
        idbResolveTimedOut: false,
      })
    ).toEqual({ isLoading: false, isConfirmedEmpty: true })
  })

  it("renders neither skeleton nor empty state when events are available", () => {
    expect(
      computeTimelineLoadState({
        idbResolved: true,
        hasAnyEvents: true,
        isBootstrapLoading: true,
        idbResolveTimedOut: false,
      })
    ).toEqual({ isLoading: false, isConfirmedEmpty: false })
  })

  it("does not claim confirmed-empty once events are present after bootstrap settles", () => {
    expect(
      computeTimelineLoadState({
        idbResolved: true,
        hasAnyEvents: true,
        isBootstrapLoading: false,
        idbResolveTimedOut: false,
      })
    ).toEqual({ isLoading: false, isConfirmedEmpty: false })
  })
})
