import { useRef, useEffect, useLayoutEffect, useCallback, useImperativeHandle, forwardRef } from "react"
import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Placeholder from "@tiptap/extension-placeholder"
import { useChannelSuggestion } from "@/components/editor/triggers"
import { useSearchMentionSuggestion } from "@/components/editor/triggers/use-search-mention-suggestion"
import { useFilterTypeSuggestion } from "@/components/editor/triggers/use-filter-type-suggestion"
import { useDateFilterSuggestion } from "@/components/editor/triggers/use-date-filter-suggestion"
import { useFromFilterSuggestion } from "@/components/editor/triggers/use-from-filter-suggestion"
import { useWithFilterSuggestion } from "@/components/editor/triggers/use-with-filter-suggestion"
import { useInUserFilterSuggestion } from "@/components/editor/triggers/use-in-user-filter-suggestion"
import { useInChannelFilterSuggestion } from "@/components/editor/triggers/use-in-channel-filter-suggestion"
import { FilterTypeExtension } from "@/components/editor/triggers/filter-type-extension"
import { DateFilterExtension } from "@/components/editor/triggers/date-filter-extension"
import { FromFilterExtension } from "@/components/editor/triggers/from-filter-extension"
import { WithFilterExtension } from "@/components/editor/triggers/with-filter-extension"
import { InUserFilterExtension } from "@/components/editor/triggers/in-user-filter-extension"
import { InChannelFilterExtension } from "@/components/editor/triggers/in-channel-filter-extension"
import { SearchMentionExtension } from "@/components/editor/triggers/search-mention-extension"
import { SearchChannelExtension } from "@/components/editor/triggers/search-channel-extension"
import { cn, escapeHtml } from "@/lib/utils"

export interface SearchEditorProps {
  value: string
  onChange: (value: string) => void
  /** Called when text is pasted, with the normalized pasted text */
  onPaste?: (text: string) => void
  /** Called when Enter is pressed and no suggestion popover is open.
   *  withModifier is true if Cmd/Ctrl was held (for "open in new tab" behavior).
   */
  onSubmit?: (withModifier: boolean) => void
  onPopoverActiveChange?: (active: boolean) => void
  placeholder?: string
  className?: string
  autoFocus?: boolean
  disabled?: boolean
}

export interface SearchEditorRef {
  focus: () => void
  blur: () => void
  /** Imperatively close all open suggestion popovers */
  closePopovers: () => void
}

/**
 * TipTap-based editor for search queries.
 * Styled to look like a plain input with autocomplete support.
 *
 * Supports triggers:
 * - @ for user/persona mentions (search terms)
 * - # for channel references (search terms)
 * - is: for stream type filters
 * - after:/before: for date filters
 *
 * All triggers insert plain text - no styled nodes.
 * Visual badges are rendered separately from the parsed query.
 */
export const SearchEditor = forwardRef<SearchEditorRef, SearchEditorProps>(function SearchEditor(
  {
    value,
    onChange,
    onPaste,
    onSubmit,
    onPopoverActiveChange,
    placeholder = "Search...",
    className,
    autoFocus = false,
    disabled = false,
  },
  ref
) {
  const isInternalUpdate = useRef(false)
  const isPopoverActiveRef = useRef(false)

  // Trigger suggestions - use search-specific hooks that exclude broadcast mentions
  const {
    suggestionConfig: mentionConfig,
    renderMentionList,
    isActive: mentionActive,
    close: closeMention,
  } = useSearchMentionSuggestion()
  const {
    suggestionConfig: channelConfig,
    renderChannelList,
    isActive: channelActive,
    close: closeChannel,
  } = useChannelSuggestion()
  const {
    suggestionConfig: filterTypeConfig,
    renderFilterTypeList,
    isActive: filterTypeActive,
    close: closeFilterType,
  } = useFilterTypeSuggestion()
  const {
    suggestionConfig: dateFilterConfig,
    renderDateFilterList,
    isActive: dateFilterActive,
    close: closeDateFilter,
  } = useDateFilterSuggestion()
  const {
    suggestionConfig: fromFilterConfig,
    renderFromFilterList,
    isActive: fromFilterActive,
    close: closeFromFilter,
  } = useFromFilterSuggestion()
  const {
    suggestionConfig: withFilterConfig,
    renderWithFilterList,
    isActive: withFilterActive,
    close: closeWithFilter,
  } = useWithFilterSuggestion()
  const {
    suggestionConfig: inUserFilterConfig,
    renderInUserFilterList,
    isActive: inUserFilterActive,
    close: closeInUserFilter,
  } = useInUserFilterSuggestion()
  const {
    suggestionConfig: inChannelFilterConfig,
    renderInChannelFilterList,
    isActive: inChannelFilterActive,
    close: closeInChannelFilter,
  } = useInChannelFilterSuggestion()

  // Track combined popover active state
  const isPopoverActive =
    mentionActive ||
    channelActive ||
    filterTypeActive ||
    dateFilterActive ||
    fromFilterActive ||
    withFilterActive ||
    inUserFilterActive ||
    inChannelFilterActive
  isPopoverActiveRef.current = isPopoverActive

  // Notify parent when popover state changes
  // IMPORTANT: Use useLayoutEffect (not useEffect) to notify SYNCHRONOUSLY
  // before the browser handles any keyboard events. With useEffect, there's a
  // race condition where keyboard events fire before the parent knows the popover is open.
  useLayoutEffect(() => {
    onPopoverActiveChange?.(isPopoverActive)
  }, [isPopoverActive, onPopoverActiveChange])

  // Create extensions for search editor
  // Uses plain-text inserting extensions (SearchMention, SearchChannel)
  // instead of node-based ones (Mention, Channel) since search queries are plain text
  const extensions = [
    // StarterKit with most features disabled - just basic text editing
    StarterKit.configure({
      heading: false,
      codeBlock: false,
      bold: false,
      italic: false,
      strike: false,
      code: false,
      blockquote: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      horizontalRule: false,
      dropcursor: false,
      gapcursor: false,
      hardBreak: false, // Prevent Shift+Enter from creating hard breaks
      paragraph: {
        HTMLAttributes: {
          class: "m-0 p-0",
        },
      },
    }),
    Placeholder.configure({
      placeholder,
      emptyEditorClass: "is-editor-empty",
    }),
    // @ mentions - insert "@slug " as plain text
    SearchMentionExtension.configure({
      suggestion: mentionConfig,
    }),
    // # channels - insert "#slug " as plain text
    SearchChannelExtension.configure({
      suggestion: channelConfig,
    }),
    // is: filter - insert "is:value " as plain text
    FilterTypeExtension.configure({
      suggestion: filterTypeConfig,
    }),
    // after:/before: date filters - insert "after:date " or "before:date " as plain text
    DateFilterExtension.configure({
      suggestion: dateFilterConfig,
    }),
    // from:@ filter - insert "from:@slug " as plain text
    FromFilterExtension.configure({
      suggestion: fromFilterConfig,
    }),
    // with:@ filter - insert "with:@slug " as plain text (stream member filter)
    WithFilterExtension.configure({
      suggestion: withFilterConfig,
    }),
    // in:@ filter - insert "in:@slug " as plain text (DM filter)
    InUserFilterExtension.configure({
      suggestion: inUserFilterConfig,
    }),
    // in:# filter - insert "in:#slug " as plain text (channel filter)
    InChannelFilterExtension.configure({
      suggestion: inChannelFilterConfig,
    }),
  ]

  const editor = useEditor({
    extensions,
    content: value ? `<p>${escapeHtml(value)}</p>` : "",
    editable: !disabled,
    onUpdate: ({ editor }) => {
      if (isInternalUpdate.current) return
      const text = editor.getText()
      onChange(text)
    },
    editorProps: {
      attributes: {
        class: cn(
          "flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none",
          "placeholder:text-muted-foreground",
          "disabled:cursor-not-allowed disabled:opacity-50"
        ),
        "aria-label": "Search query input",
      },
      handleKeyDown: (_view, event) => {
        // Enter to submit (unless a suggestion popover is open)
        // Check ref because this callback captures stale closure
        if (event.key === "Enter" && !event.shiftKey && !isPopoverActiveRef.current) {
          if (onSubmit) {
            event.preventDefault()
            const withModifier = event.metaKey || event.ctrlKey
            onSubmit(withModifier)
            return true
          }
          // No onSubmit handler - let event bubble to parent for handling
          return false
        }
        return false
      },
      handlePaste: (_view, event) => {
        // Paste as plain text with prefix normalization
        const text = event.clipboardData?.getData("text/plain")
        if (text && onPaste) {
          event.preventDefault()
          // Normalize multiple mode prefixes to one: "?? food" → "? food", "> > cmd" → "> cmd"
          // But keep the prefix so mode detection works (pasting "food" should switch to stream mode)
          const normalized = text
            .replace(/^([?>][\s?>]*)+/, (match) => {
              const prefix = match.trim()[0]
              return prefix ? `${prefix} ` : ""
            })
            .trimEnd()
          // Call onPaste with full normalized text (including any prefix)
          // Parent handles mode switching based on prefix
          onPaste(normalized)
          return true
        }
        return false
      },
    },
  })

  // Sync external value changes
  useEffect(() => {
    if (!editor || editor.isDestroyed) return

    const currentText = editor.getText()
    if (value !== currentText) {
      isInternalUpdate.current = true
      editor.commands.setContent(value ? `<p>${escapeHtml(value)}</p>` : "")
      isInternalUpdate.current = false
    }
  }, [value, editor])

  // Auto-focus on mount
  useEffect(() => {
    if (autoFocus && editor && !editor.isDestroyed) {
      editor.commands.focus("end")
    }
  }, [autoFocus, editor])

  // Expose focus/blur methods
  const focus = useCallback(() => {
    if (editor && !editor.isDestroyed) {
      editor.commands.focus("end")
    }
  }, [editor])

  const blur = useCallback(() => {
    if (editor && !editor.isDestroyed) {
      editor.view.dom.blur()
    }
  }, [editor])

  // Close all open suggestion popovers - called by parent when Escape is pressed
  // (Radix Dialog intercepts Escape before TipTap can see it)
  const closePopovers = useCallback(() => {
    closeMention()
    closeChannel()
    closeFilterType()
    closeDateFilter()
    closeFromFilter()
    closeWithFilter()
    closeInUserFilter()
    closeInChannelFilter()
  }, [
    closeMention,
    closeChannel,
    closeFilterType,
    closeDateFilter,
    closeFromFilter,
    closeWithFilter,
    closeInUserFilter,
    closeInChannelFilter,
  ])

  useImperativeHandle(ref, () => ({ focus, blur, closePopovers }), [focus, blur, closePopovers])

  return (
    <div className={cn("relative flex-1", className)}>
      <EditorContent editor={editor} />
      {renderMentionList()}
      {renderChannelList()}
      {renderFilterTypeList()}
      {renderDateFilterList()}
      {renderFromFilterList()}
      {renderWithFilterList()}
      {renderInUserFilterList()}
      {renderInChannelFilterList()}
    </div>
  )
})
