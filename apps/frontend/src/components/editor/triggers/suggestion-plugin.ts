import type { Editor, Range } from "@tiptap/react"
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion"

/**
 * Re-export suggestion types for convenience.
 */
export type { SuggestionProps, SuggestionKeyDownProps }

/**
 * Simplified props passed to our suggestion handlers.
 */
export interface SuggestionCallbackProps<T> {
  editor: Editor
  range: Range
  query: string
  items: T[]
  clientRect: (() => DOMRect | null) | null
  command: (item: T) => void
}

/**
 * Create render callbacks for TipTap suggestion plugin.
 * This factory provides a simpler interface for managing suggestion state.
 */
export function createSuggestionRender<T>(handlers: {
  onStart: (props: SuggestionCallbackProps<T>) => void
  onUpdate: (props: SuggestionCallbackProps<T>) => void
  onExit: () => void
  onKeyDown: (event: KeyboardEvent) => boolean
}) {
  return () => ({
    onStart: (props: SuggestionProps<T>) => {
      handlers.onStart({
        editor: props.editor,
        range: props.range,
        query: props.query,
        items: props.items,
        clientRect: props.clientRect ?? null,
        command: props.command,
      })
    },

    onUpdate: (props: SuggestionProps<T>) => {
      handlers.onUpdate({
        editor: props.editor,
        range: props.range,
        query: props.query,
        items: props.items,
        clientRect: props.clientRect ?? null,
        command: props.command,
      })
    },

    onKeyDown: (props: SuggestionKeyDownProps) => {
      return handlers.onKeyDown(props.event)
    },

    onExit: () => {
      handlers.onExit()
    },
  })
}
