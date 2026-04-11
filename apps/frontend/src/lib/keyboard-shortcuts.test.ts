import { describe, it, expect } from "vitest"
import { SHORTCUT_ACTIONS, getShortcutAction, matchesKeyBinding, detectConflicts } from "./keyboard-shortcuts"

describe("toggleSidebar shortcut", () => {
  it("is registered as a view-category action with mod+§ default", () => {
    const action = getShortcutAction("toggleSidebar")
    expect(action).toBeDefined()
    expect(action?.defaultKey).toBe("mod+§")
    expect(action?.category).toBe("view")
    expect(action?.global).toBe(true)
  })

  it("matches a Ctrl+§ keydown event", () => {
    const event = new KeyboardEvent("keydown", {
      key: "§",
      ctrlKey: true,
    })
    expect(matchesKeyBinding(event, "mod+§")).toBe(true)
  })

  it("matches a Cmd+§ keydown event on Mac", () => {
    const event = new KeyboardEvent("keydown", {
      key: "§",
      metaKey: true,
    })
    expect(matchesKeyBinding(event, "mod+§")).toBe(true)
  })

  it("does not match a bare § keydown event", () => {
    const event = new KeyboardEvent("keydown", { key: "§" })
    expect(matchesKeyBinding(event, "mod+§")).toBe(false)
  })

  it("does not conflict with any other default binding", () => {
    const conflicts = detectConflicts()
    expect(conflicts.get("mod+§")).toBeUndefined()
  })

  it("is included in SHORTCUT_ACTIONS exactly once", () => {
    const matches = SHORTCUT_ACTIONS.filter((a) => a.id === "toggleSidebar")
    expect(matches).toHaveLength(1)
  })
})
