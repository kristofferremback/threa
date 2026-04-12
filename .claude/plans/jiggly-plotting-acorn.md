# User-Defined Keyboard Shortcuts

## Context

Keyboard shortcuts are currently hardcoded — the app-level shortcuts (quick switcher, search, etc.) support custom bindings in the preferences system but the UI says "coming soon", and editor formatting shortcuts (`Mod-b` for bold, etc.) are entirely hardcoded in the TipTap extension. Users should be able to rebind all shortcuts from the settings modal, with bindings persisting globally across devices via the existing preferences sync system. Critically, when a user binds an app shortcut to a key that was previously an editor shortcut (e.g., `mod+b` for sidebar toggle), the editor must yield that key to avoid double-firing.

## Plan

### Phase 1: Expand the shortcut registry

**File: `apps/frontend/src/lib/keyboard-shortcuts.ts`**

1. Add 5 editor formatting actions to `SHORTCUT_ACTIONS` with `category: "editing"` (no `global` flag — they only apply when the editor has focus):

| id | label | defaultKey |
|---|---|---|
| `formatBold` | Bold | `mod+b` |
| `formatItalic` | Italic | `mod+i` |
| `formatStrike` | Strikethrough | `mod+shift+s` |
| `formatCode` | Inline Code | `mod+e` |
| `formatCodeBlock` | Code Block | `mod+shift+c` |

2. Add utility functions:
   - `keyEventToBinding(event: KeyboardEvent): string | null` — converts a KeyboardEvent to normalized binding string (`"mod+shift+f"`), returns null for lone modifier presses. Used by the key capture UI.
   - `toProseMirrorKey(appBinding: string): string` — converts `"mod+shift+c"` to `"Mod-Shift-c"` for ProseMirror keymap compatibility.

3. Update `getEffectiveKeyBinding()` to handle a `"none"` sentinel value — returns `undefined` when the user has explicitly disabled a shortcut.

### Phase 2: Make editor shortcuts dynamic

The core challenge: TipTap's `addKeyboardShortcuts()` returns a static object at extension creation time. User bindings change at runtime. Solution: move formatting shortcuts to a ProseMirror plugin with a `handleKeyDown` that reads from a ref on every keystroke.

**File: `apps/frontend/src/components/editor/editor-behaviors.ts`**

1. Add `keyBindingsRef: { current: Record<string, string> }` to `EditorBehaviorsOptions` (follows existing `sendModeRef`/`onSubmitRef` pattern).

2. Remove the 5 formatting shortcuts (`Mod-b`, `Mod-i`, `Mod-Shift-s`, `Mod-e`, `Mod-Shift-c`) from `addKeyboardShortcuts()`. Keep all non-formatting shortcuts (Tab, Enter, Arrow keys, Mod-a, Mod-Enter) there since they are not user-configurable.

3. Add a new ProseMirror plugin in `addProseMirrorPlugins()` with a `handleKeyDown` that:
   - Reads `keyBindingsRef.current` to get effective bindings for each formatting action
   - Uses `matchesKeyBinding()` to check the event against each binding
   - Executes the corresponding editor command (`toggleBold`, `toggleItalic`, etc.) when matched
   - Returns `true` to consume the event, preventing it from bubbling

**File: `apps/frontend/src/components/editor/atom-aware-marks.ts`**

4. Override `addKeyboardShortcuts()` on each atom-aware mark extension (`AtomAwareBold`, `AtomAwareItalic`, `AtomAwareStrike`, `AtomAwareCode`) to return `{}`. This prevents the base TipTap Bold/Italic/etc. extensions from handling `Mod-b`/`Mod-i` independently — EditorBehaviors owns all formatting shortcuts now.

**File: `apps/frontend/src/components/editor/rich-editor.tsx`**

5. Create a `keyBindingsRef` and populate it reactively from preferences:
   - Use `usePreferences()` to get `customBindings`
   - Compute effective bindings for each `format*` action using `getEffectiveKeyBinding()`
   - **Filter out any editor binding that conflicts with an app-level global shortcut** (app shortcuts always win) — this is the conflict resolution: if `toggleSidebar` is bound to `mod+b`, `formatBold`'s `mod+b` is excluded so the editor never tries to handle it
   - Pass `keyBindingsRef` to `EditorBehaviors.configure()` (NOT as a useMemo dependency — ref avoids editor re-creation)

**File: `apps/frontend/src/components/editor/document-editor-modal.tsx`**

6. Same wiring as rich-editor.tsx: pass `keyBindingsRef` to `EditorBehaviors.configure()`.

### Phase 3: Dynamic toolbar shortcut hints

**File: `apps/frontend/src/components/editor/editor-toolbar.tsx`**

1. Accept an optional `shortcutOverrides` prop (or use `usePreferences` directly) to get effective bindings.
2. Replace hardcoded `shortcut="⌘B"` strings with `formatKeyBinding(getEffectiveKeyBinding("formatBold", customBindings))`. When a binding is `undefined` (disabled or conflicted away), omit the shortcut hint.

**File: `apps/frontend/src/components/editor/document-editor-modal.tsx`**

3. Same: replace 5 hardcoded shortcut strings with dynamic lookups.

### Phase 4: Preferences context enhancement

**File: `apps/frontend/src/contexts/preferences-context.tsx`**

1. Add `resetKeyboardShortcut(actionId: string)` — removes the key from the `keyboardShortcuts` map and persists the full replacement object (not a merge).

2. Fix the optimistic update in `onMutate`: when `input.keyboardShortcuts` is provided, **replace** the entire `keyboardShortcuts` object rather than spreading/merging, since callers (`updateKeyboardShortcut`, `resetKeyboardShortcut`) already provide the complete desired state.

### Phase 5: Rebinding UI

**File: `apps/frontend/src/components/settings/keyboard-settings.tsx`**

Replace the "Customization coming soon" card with interactive rebinding for every shortcut row.

1. **`ShortcutRow` component** — each row shows:
   - Left: action label + description
   - Right: clickable binding badge + reset button (visible only when custom binding differs from default)

2. **Key capture flow** — when the binding badge is clicked:
   - Badge enters "listening" state (visual change, text says "Press keys...")
   - A document-level `keydown` listener (with `capture: true`) intercepts the next key combination
   - `keyEventToBinding(event)` converts the event to a normalized string
   - Lone modifier presses are ignored
   - Escape cancels capture mode
   - On valid capture: check for conflicts via `detectConflicts()`. If conflict exists, show inline warning ("Already used by [action]. Override?"). On confirm, save the new binding and clear the conflicting action's binding. On cancel, revert.

3. **"Reset All Shortcuts" button** at the top that clears the entire `keyboardShortcuts` object.

4. Remove the "Customization coming soon" card.

### Phase 6: Testing

**Unit tests** (`keyboard-shortcuts.test.ts`):
- `keyEventToBinding()`: verify modifier combos, lone modifier rejection, special keys
- `toProseMirrorKey()`: verify format conversion
- `getEffectiveKeyBinding()` with `"none"` sentinel
- `detectConflicts()` with editor shortcuts included

**Editor integration tests**:
- Verify custom formatting binding triggers the correct command
- Verify disabled binding (`"none"`) does not trigger
- Verify app-level shortcut claiming an editor key causes the editor to yield

**Settings UI tests** (`keyboard-settings.test.tsx`):
- Key capture mode enters/exits correctly
- Conflict detection shown in UI
- Reset individual / reset all

## Critical Files

| File | Role |
|---|---|
| `apps/frontend/src/lib/keyboard-shortcuts.ts` | Shortcut registry, utilities |
| `apps/frontend/src/components/editor/editor-behaviors.ts` | TipTap extension with formatting shortcuts |
| `apps/frontend/src/components/editor/atom-aware-marks.ts` | Must suppress built-in mark shortcuts |
| `apps/frontend/src/components/editor/rich-editor.tsx` | Wires preferences → editor via ref |
| `apps/frontend/src/components/editor/document-editor-modal.tsx` | Same wiring for document editor |
| `apps/frontend/src/components/editor/editor-toolbar.tsx` | Dynamic shortcut hint display |
| `apps/frontend/src/contexts/preferences-context.tsx` | Reset support, optimistic update fix |
| `apps/frontend/src/components/settings/keyboard-settings.tsx` | Rebinding UI |
| `apps/frontend/src/hooks/use-keyboard-shortcuts.ts` | No structural changes needed |
| `packages/types/src/preferences.ts` | No changes needed (types already support this) |
| `apps/backend/src/features/user-preferences/handlers.ts` | No changes needed (validation already accepts arbitrary shortcuts) |

## Verification

1. `bun run typecheck` — no type errors
2. `bun run test` — all existing + new unit tests pass
3. Manual: open settings → keyboard tab → click a shortcut binding → press new key combo → verify it saves and syncs
4. Manual: rebind `mod+b` to sidebar toggle → open editor → press `Cmd+B` → verify sidebar toggles and text does NOT bold
5. Manual: verify toolbar tooltip shows updated shortcut hint
6. Manual: reset a shortcut → verify it reverts to default
