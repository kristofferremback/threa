import { useState, useCallback, useMemo, useRef, type RefObject, type ReactNode } from "react"
import { createPortal } from "react-dom"
import type { Editor } from "@tiptap/react"
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion"
import type { SuggestionListRef } from "./suggestion-list"

interface SuggestionState<T> {
  items: T[]
  clientRect: (() => DOMRect | null) | null
  command: ((item: T) => void) | null
}

export interface UseSuggestionConfig<T> {
  /** TipTap extension name — used to sync popupVisible in editor.storage */
  extensionName: string
  /** Get all available items (called via ref to avoid stale closures) */
  getItems: () => T[]
  /** Filter items by query string */
  filterItems: (items: T[], query: string) => T[]
  /** Render the suggestion list component */
  renderList: (props: {
    ref: RefObject<SuggestionListRef | null>
    items: T[]
    clientRect: (() => DOMRect | null) | null
    command: (item: T) => void
  }) => ReactNode
}

export interface UseSuggestionResult<T> {
  /** Configuration to pass to the TipTap extension */
  suggestionConfig: {
    items: (props: { query: string }) => T[]
    render: () => {
      onStart: (props: SuggestionProps<T>) => void
      onUpdate: (props: SuggestionProps<T>) => void
      onExit: (props: SuggestionProps<T>) => void
      onKeyDown: (props: SuggestionKeyDownProps) => boolean
    }
  }
  /** Call this in your component to render the suggestion popup */
  renderSuggestionList: () => ReactNode
  /** Whether the suggestion popup is currently active */
  isActive: boolean
  /** Imperatively close the suggestion popup */
  close: () => void
}

/**
 * Generic hook for managing TipTap suggestion state.
 * Handles the lifecycle callbacks and portal rendering.
 */
export function useSuggestion<T>(config: UseSuggestionConfig<T>): UseSuggestionResult<T> {
  const { extensionName, getItems, filterItems, renderList } = config
  const [state, setState] = useState<SuggestionState<T> | null>(null)
  const listRef = useRef<SuggestionListRef>(null)
  const editorRef = useRef<Editor | null>(null)

  // Use ref to avoid stale closure in TipTap callback
  const getItemsRef = useRef(getItems)
  getItemsRef.current = getItems

  const setPopupVisible = useCallback(
    (editor: Editor, visible: boolean) => {
      const storage = (editor.storage as unknown as Record<string, Record<string, unknown>>)[extensionName]
      if (storage) storage.popupVisible = visible
    },
    [extensionName]
  )

  // Stable callback that reads from ref - TipTap captures this at extension creation time
  const getSuggestionItems = useCallback(
    ({ query }: { query: string }) => filterItems(getItemsRef.current(), query),
    [filterItems]
  )

  const onStart = useCallback(
    (props: SuggestionProps<T>) => {
      editorRef.current = props.editor
      setPopupVisible(props.editor, props.items.length > 0)
      setState({
        items: props.items,
        clientRect: props.clientRect ?? null,
        command: props.command,
      })
    },
    [setPopupVisible]
  )

  const onUpdate = useCallback(
    (props: SuggestionProps<T>) => {
      setPopupVisible(props.editor, props.items.length > 0)
      setState({
        items: props.items,
        clientRect: props.clientRect ?? null,
        command: props.command,
      })
    },
    [setPopupVisible]
  )

  const onExit = useCallback(
    (props: SuggestionProps<T>) => {
      setPopupVisible(props.editor, false)
      setState(null)
    },
    [setPopupVisible]
  )

  // Imperative close for when Radix intercepts Escape before TipTap
  const close = useCallback(() => {
    if (editorRef.current) setPopupVisible(editorRef.current, false)
    setState(null)
  }, [setPopupVisible])

  const onKeyDown = useCallback(
    (props: SuggestionKeyDownProps) => {
      if (props.event.key === "Escape") {
        props.event.preventDefault()
        if (editorRef.current) setPopupVisible(editorRef.current, false)
        setState(null)
        return true
      }
      return listRef.current?.onKeyDown(props.event) ?? false
    },
    [setPopupVisible]
  )

  const suggestionConfig = useMemo(
    () => ({
      items: getSuggestionItems,
      render: () => ({
        onStart,
        onUpdate,
        onExit,
        onKeyDown,
      }),
    }),
    [getSuggestionItems, onStart, onUpdate, onExit, onKeyDown]
  )

  const renderSuggestionList = useCallback(() => {
    if (!state || !state.command) return null

    return createPortal(
      renderList({
        ref: listRef,
        items: state.items,
        clientRect: state.clientRect,
        command: state.command,
      }),
      document.body
    )
  }, [state, renderList])

  return {
    suggestionConfig,
    renderSuggestionList,
    isActive: state !== null,
    close,
  }
}
