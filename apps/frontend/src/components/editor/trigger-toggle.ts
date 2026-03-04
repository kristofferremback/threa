export interface SuggestionPluginState {
  active: boolean
  range: {
    from: number
    to: number
  }
  query: string | null
  text: string | null
}

export interface TriggerSelection {
  from: number
  to: number
  empty: boolean
}

/**
 * Detects a second click on a trigger button while its empty suggestion is active.
 * In that state, the click should remove the inserted trigger character instead of inserting another one.
 */
export function shouldRemoveTriggerOnToggle(
  trigger: string,
  suggestionState: SuggestionPluginState | null | undefined,
  selection: TriggerSelection
): boolean {
  if (!trigger || !selection.empty) return false
  if (!suggestionState?.active) return false
  if (suggestionState.query !== "") return false
  if (suggestionState.text !== trigger) return false
  if (suggestionState.range.to !== selection.from) return false
  if (suggestionState.range.from !== selection.from - trigger.length) return false
  return true
}
