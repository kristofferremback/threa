import { describe, it, expect } from "vitest"
import {
  SHORTCUT_ACTIONS,
  getShortcutAction,
  matchesKeyBinding,
  detectConflicts,
  getEffectiveKeyBinding,
  keyEventToBinding,
  getEffectiveEditorBindings,
  EDITOR_SHORTCUT_IDS,
} from "./keyboard-shortcuts"

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

describe("editor formatting shortcuts", () => {
  it("registers all 5 editor formatting actions in the editing category", () => {
    for (const id of EDITOR_SHORTCUT_IDS) {
      const action = getShortcutAction(id)
      expect(action).toBeDefined()
      expect(action?.category).toBe("editing")
      expect(action?.global).toBeUndefined()
    }
  })

  it("has correct default keys", () => {
    expect(getShortcutAction("formatBold")?.defaultKey).toBe("mod+b")
    expect(getShortcutAction("formatItalic")?.defaultKey).toBe("mod+i")
    expect(getShortcutAction("formatStrike")?.defaultKey).toBe("mod+shift+s")
    expect(getShortcutAction("formatCode")?.defaultKey).toBe("mod+e")
    expect(getShortcutAction("formatCodeBlock")?.defaultKey).toBe("mod+shift+c")
  })

  it("no default editor shortcuts conflict with each other", () => {
    const conflicts = detectConflicts()
    for (const id of EDITOR_SHORTCUT_IDS) {
      const action = getShortcutAction(id)!
      const conflicting = conflicts.get(action.defaultKey)
      expect(conflicting).toBeUndefined()
    }
  })
})

describe("getEffectiveKeyBinding", () => {
  it("returns default key when no custom bindings", () => {
    expect(getEffectiveKeyBinding("formatBold")).toBe("mod+b")
  })

  it("returns custom binding when set", () => {
    expect(getEffectiveKeyBinding("formatBold", { formatBold: "mod+shift+b" })).toBe("mod+shift+b")
  })

  it("returns undefined when set to 'none' (disabled)", () => {
    expect(getEffectiveKeyBinding("formatBold", { formatBold: "none" })).toBeUndefined()
  })

  it("returns undefined for unknown action IDs", () => {
    expect(getEffectiveKeyBinding("nonexistent")).toBeUndefined()
  })
})

describe("detectConflicts", () => {
  it("detects conflict when two actions share the same binding", () => {
    const conflicts = detectConflicts({ toggleSidebar: "mod+b" })
    const conflicting = conflicts.get("mod+b")
    expect(conflicting).toBeDefined()
    expect(conflicting).toContain("toggleSidebar")
    expect(conflicting).toContain("formatBold")
  })

  it("excludes disabled shortcuts from conflict detection", () => {
    const conflicts = detectConflicts({ formatBold: "none", toggleSidebar: "mod+b" })
    // formatBold is disabled, so mod+b is only used by toggleSidebar — no conflict
    expect(conflicts.get("mod+b")).toBeUndefined()
  })
})

describe("keyEventToBinding", () => {
  it("converts Ctrl+B to mod+b", () => {
    const event = new KeyboardEvent("keydown", { key: "b", ctrlKey: true })
    expect(keyEventToBinding(event)).toBe("mod+b")
  })

  it("converts Cmd+Shift+F to mod+shift+f", () => {
    const event = new KeyboardEvent("keydown", { key: "f", metaKey: true, shiftKey: true })
    expect(keyEventToBinding(event)).toBe("mod+shift+f")
  })

  it("converts Alt+K to alt+k", () => {
    const event = new KeyboardEvent("keydown", { key: "k", altKey: true })
    expect(keyEventToBinding(event)).toBe("alt+k")
  })

  it("returns bare key for unmodified key", () => {
    const event = new KeyboardEvent("keydown", { key: "Escape" })
    expect(keyEventToBinding(event)).toBe("escape")
  })

  it("returns null for lone modifier presses", () => {
    expect(keyEventToBinding(new KeyboardEvent("keydown", { key: "Control" }))).toBeNull()
    expect(keyEventToBinding(new KeyboardEvent("keydown", { key: "Shift" }))).toBeNull()
    expect(keyEventToBinding(new KeyboardEvent("keydown", { key: "Alt" }))).toBeNull()
    expect(keyEventToBinding(new KeyboardEvent("keydown", { key: "Meta" }))).toBeNull()
  })
})

describe("getEffectiveEditorBindings", () => {
  it("returns all default editor bindings when no custom bindings", () => {
    const bindings = getEffectiveEditorBindings()
    expect(bindings).toEqual({
      formatBold: "mod+b",
      formatItalic: "mod+i",
      formatStrike: "mod+shift+s",
      formatCode: "mod+e",
      formatCodeBlock: "mod+shift+c",
    })
  })

  it("excludes editor bindings that conflict with global app shortcuts", () => {
    // User binds toggleSidebar to mod+b — formatBold should be excluded
    const bindings = getEffectiveEditorBindings({ toggleSidebar: "mod+b" })
    expect(bindings.formatBold).toBeUndefined()
    // Other editor shortcuts unaffected
    expect(bindings.formatItalic).toBe("mod+i")
  })

  it("respects custom editor bindings", () => {
    const bindings = getEffectiveEditorBindings({ formatBold: "mod+shift+b" })
    expect(bindings.formatBold).toBe("mod+shift+b")
  })

  it("excludes disabled editor shortcuts", () => {
    const bindings = getEffectiveEditorBindings({ formatBold: "none" })
    expect(bindings.formatBold).toBeUndefined()
  })
})
