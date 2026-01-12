/**
 * Keyboard shortcuts registry and utilities.
 *
 * This module defines available keyboard shortcuts and their defaults.
 * Users can customize shortcuts via preferences.
 */

export interface ShortcutAction {
  id: string
  label: string
  description: string
  defaultKey: string
  category: "navigation" | "editing" | "view"
  /** If true, shortcut works even when focus is in an input field */
  global?: boolean
}

/**
 * All available shortcut actions with their defaults.
 * Key format uses "mod" as a platform-agnostic modifier (Cmd on Mac, Ctrl elsewhere).
 */
export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  {
    id: "openQuickSwitcher",
    label: "Quick Switcher",
    description: "Open stream picker",
    defaultKey: "mod+k",
    category: "navigation",
    global: true,
  },
  {
    id: "openSearch",
    label: "Search",
    description: "Open search",
    defaultKey: "mod+shift+f",
    category: "navigation",
    global: true,
  },
  {
    id: "openCommands",
    label: "Commands",
    description: "Open command palette",
    defaultKey: "mod+shift+k",
    category: "navigation",
    global: true,
  },
  {
    id: "openSettings",
    label: "Settings",
    description: "Open settings",
    defaultKey: "mod+.",
    category: "view",
    global: true,
  },
  {
    id: "closeModal",
    label: "Close",
    description: "Close current modal or popover",
    defaultKey: "escape",
    category: "navigation",
    global: true,
  },
]

/**
 * Get shortcut action by ID.
 */
export function getShortcutAction(id: string): ShortcutAction | undefined {
  return SHORTCUT_ACTIONS.find((a) => a.id === id)
}

/**
 * Get all shortcuts grouped by category.
 */
export function getShortcutsByCategory(): Record<ShortcutAction["category"], ShortcutAction[]> {
  const result: Record<ShortcutAction["category"], ShortcutAction[]> = {
    navigation: [],
    editing: [],
    view: [],
  }

  for (const action of SHORTCUT_ACTIONS) {
    result[action.category].push(action)
  }

  return result
}

/**
 * Get the effective key binding for an action, considering user customizations.
 */
export function getEffectiveKeyBinding(
  actionId: string,
  customBindings: Record<string, string> = {}
): string | undefined {
  if (customBindings[actionId]) {
    return customBindings[actionId]
  }
  return getShortcutAction(actionId)?.defaultKey
}

/**
 * Detect conflicts in keyboard shortcuts.
 * Returns a map of key bindings to the action IDs that use them.
 */
export function detectConflicts(customBindings: Record<string, string> = {}): Map<string, string[]> {
  const keyToActions = new Map<string, string[]>()

  for (const action of SHORTCUT_ACTIONS) {
    const key = customBindings[action.id] || action.defaultKey
    const existing = keyToActions.get(key) || []
    keyToActions.set(key, [...existing, action.id])
  }

  // Filter to only return conflicts (more than one action per key)
  const conflicts = new Map<string, string[]>()
  for (const [key, actions] of keyToActions) {
    if (actions.length > 1) {
      conflicts.set(key, actions)
    }
  }

  return conflicts
}

/**
 * Check if the current platform is Mac.
 */
export function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
}

/**
 * Parse a key string like "mod+k" into keyboard event properties.
 * Returns null if the event doesn't match.
 */
export function parseKeyBinding(key: string): {
  key: string
  mod: boolean
  shift: boolean
  alt: boolean
} {
  const parts = key.toLowerCase().split("+")
  const actualKey = parts[parts.length - 1]

  return {
    key: actualKey,
    mod: parts.includes("mod"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt"),
  }
}

/**
 * Check if a keyboard event matches a key binding.
 */
export function matchesKeyBinding(event: KeyboardEvent, binding: string): boolean {
  const parsed = parseKeyBinding(binding)
  // Accept either metaKey OR ctrlKey for "mod" - cross-platform compatibility
  const modPressed = event.metaKey || event.ctrlKey

  // Handle special vim-style escape
  if (parsed.key === "[" && event.ctrlKey && event.key === "[") {
    return true
  }

  return (
    event.key.toLowerCase() === parsed.key &&
    modPressed === parsed.mod &&
    event.shiftKey === parsed.shift &&
    event.altKey === parsed.alt
  )
}

/**
 * Format a key binding for display.
 * Converts "mod+k" to "⌘K" on Mac or "Ctrl+K" elsewhere.
 */
export function formatKeyBinding(binding: string): string {
  const mac = isMac()
  const parts = binding.split("+")

  const formatted = parts.map((part) => {
    switch (part.toLowerCase()) {
      case "mod":
        return mac ? "⌘" : "Ctrl"
      case "shift":
        return mac ? "⇧" : "Shift"
      case "alt":
        return mac ? "⌥" : "Alt"
      case "escape":
        return mac ? "⎋" : "Esc"
      case ",":
        return ","
      default:
        return part.toUpperCase()
    }
  })

  return mac ? formatted.join("") : formatted.join("+")
}
