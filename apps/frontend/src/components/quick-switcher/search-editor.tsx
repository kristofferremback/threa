import { useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from "react"
import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Placeholder from "@tiptap/extension-placeholder"
import { useMentionSuggestion, useChannelSuggestion } from "@/components/editor/triggers"
import { useFilterTypeSuggestion } from "@/components/editor/triggers/use-filter-type-suggestion"
import { useDateFilterSuggestion } from "@/components/editor/triggers/use-date-filter-suggestion"
import { FilterTypeExtension } from "@/components/editor/triggers/filter-type-extension"
import { DateFilterExtension } from "@/components/editor/triggers/date-filter-extension"
import { SearchMentionExtension } from "@/components/editor/triggers/search-mention-extension"
import { SearchChannelExtension } from "@/components/editor/triggers/search-channel-extension"
import { cn } from "@/lib/utils"

export interface SearchEditorProps {
  value: string
  onChange: (value: string) => void
  onSubmit?: () => void
  placeholder?: string
  className?: string
  autoFocus?: boolean
  disabled?: boolean
}

export interface SearchEditorRef {
  focus: () => void
  blur: () => void
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
  { value, onChange, onSubmit, placeholder = "Search...", className, autoFocus = false, disabled = false },
  ref
) {
  const isInternalUpdate = useRef(false)

  // Trigger suggestions - reuse existing hooks
  const { suggestionConfig: mentionConfig, renderMentionList } = useMentionSuggestion()
  const { suggestionConfig: channelConfig, renderChannelList } = useChannelSuggestion()
  const { suggestionConfig: filterTypeConfig, renderFilterTypeList } = useFilterTypeSuggestion()
  const { suggestionConfig: dateFilterConfig, renderDateFilterList } = useDateFilterSuggestion()

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
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault()
          onSubmit?.()
          return true
        }
        return false
      },
      handlePaste: (view, event) => {
        // Paste as plain text
        const text = event.clipboardData?.getData("text/plain")
        if (text) {
          event.preventDefault()
          // Normalize ? prefix - remove it since search mode is implied
          const normalized = text.trim().replace(/^\?/, "").trim()
          view.dispatch(view.state.tr.insertText(normalized))
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

  useImperativeHandle(ref, () => ({ focus, blur }), [focus, blur])

  return (
    <div className={cn("relative flex-1", className)}>
      <EditorContent editor={editor} />
      {renderMentionList()}
      {renderChannelList()}
      {renderFilterTypeList()}
      {renderDateFilterList()}
    </div>
  )
})

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
